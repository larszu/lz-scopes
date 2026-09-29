// Native capture helpers (DeckLink, NDI) → bridge. A helper is a separate executable
// that writes records to stdout (helper protocol, docs/frame-protocol.md):
//
//   4 × ASCII tag | uint32 LE payload length | payload
//   INFO  JSON {width, height, fpsNum, fpsDen, pixel, matrix?, range?, transfer?, primaries?, name?, timecode?}
//   FRAM  one picture in `pixel` layout, rows without padding (v210: 128-byte blocks per 48 px)
//   STAT  JSON {message}         (status text, e.g. "kein Signal")
//   ERR   UTF-8 text             (fatal; the helper exits afterwards)
//
// The bridge feeds the frames into ffmpeg (rawvideo/v210 demuxer on stdin) and uses the
// same scale step as for streams, so matrix/range handling is identical.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Pixel layouts a helper may send, with the ffmpeg input they need and bytes per frame. */
export const HELPER_PIXELS = {
  uyvy422: { args: ['-f', 'rawvideo', '-pix_fmt', 'uyvy422'], bytes: (w, h) => w * h * 2 },
  // DeckLink bmdFormat10BitYUV = v210: 6 px per 16 bytes, rows padded to 48 px (128 bytes)
  v210: { args: ['-f', 'v210'], bytes: (w, h) => Math.ceil(w / 48) * 128 * h },
  // NDI P216: 16-bit Y plane, then interleaved 16-bit CbCr (4:2:2)
  p216le: { args: ['-f', 'rawvideo', '-pix_fmt', 'p216le'], bytes: (w, h) => w * h * 4 },
  rgb48le: { args: ['-f', 'rawvideo', '-pix_fmt', 'rgb48le'], bytes: (w, h) => w * h * 6 },
  bgra: { args: ['-f', 'rawvideo', '-pix_fmt', 'bgra'], bytes: (w, h) => w * h * 4 },
  bgr0: { args: ['-f', 'rawvideo', '-pix_fmt', 'bgr0'], bytes: (w, h) => w * h * 4 },
  rgba: { args: ['-f', 'rawvideo', '-pix_fmt', 'rgba'], bytes: (w, h) => w * h * 4 },
  rgb0: { args: ['-f', 'rawvideo', '-pix_fmt', 'rgb0'], bytes: (w, h) => w * h * 4 },
  nv12: { args: ['-f', 'rawvideo', '-pix_fmt', 'nv12'], bytes: (w, h) => w * h * 3 / 2 },
  yuv420p: { args: ['-f', 'rawvideo', '-pix_fmt', 'yuv420p'], bytes: (w, h) => w * h * 3 / 2 },
};

/** Splits the helper's stdout into records; never loses bytes across chunk borders. */
export class HelperRecordParser {
  constructor(onRecord, maxPayload = 256 * 1024 * 1024) {
    this.onRecord = onRecord; this.max = maxPayload; this.buf = Buffer.alloc(0);
  }
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= 8) {
      const tag = this.buf.toString('ascii', 0, 4);
      const len = this.buf.readUInt32LE(4);
      if (!/^[A-Z ]{3,4}$/.test(tag) || len > this.max) throw new Error(`Helfer-Protokoll gestört (${JSON.stringify(tag)})`);
      if (this.buf.length < 8 + len) return;
      const payload = this.buf.subarray(8, 8 + len);
      this.buf = this.buf.subarray(8 + len);
      this.onRecord(tag.trim(), payload);
    }
  }
}

/** Builds one record (used by tests and the fake helper). */
export function helperRecord(tag, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
  const head = Buffer.alloc(8);
  head.write(tag.padEnd(4, ' '), 0, 'ascii'); head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** Validated INFO record → ffmpeg input description, or an error text. */
export function helperFormat(info) {
  const w = Number(info?.width), h = Number(info?.height);
  const px = HELPER_PIXELS[info?.pixel];
  if (!px) return { error: `Unbekanntes Pixelformat vom Helfer: ${info?.pixel}` };
  if (!(w >= 16 && w <= 8192 && h >= 16 && h <= 8192)) return { error: `Ungültige Bildgröße vom Helfer: ${w}×${h}` };
  const num = Math.round(Number(info.fpsNum) || 0), den = Math.round(Number(info.fpsDen) || 1);
  const rate = num > 0 && den > 0 ? `${num}/${den}` : '25';
  return { width: w, height: h, rate, fps: num > 0 && den > 0 ? Math.round((num / den) * 1000) / 1000 : 0, bytes: px.bytes(w, h), input: [...px.args, '-video_size', `${w}x${h}`, '-framerate', rate, '-i', 'pipe:0'] };
}

/**
 * Where a helper binary lives: $LZS_<NAME>_HELPER, then helpers/bin/ of the repo (the
 * build script puts it there; in the desktop app outside the asar archive).
 */
export function helperPath(name, env = process.env) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const key = `LZS_${name.replace(/^lz-/, '').toUpperCase()}_HELPER`;
  const here = dirname(fileURLToPath(import.meta.url));
  const list = [env[key], join(here, '..', 'helpers', 'bin', exe)].filter(Boolean)
    .map((f) => f.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'));
  return list.find((f) => existsSync(f)) ?? null;
}

/** Runs `helper --list` and returns its JSON line ({ ok, devices|sources, error }). */
export function helperList(bin, extra = [], timeoutMs = 8000) {
  return new Promise((ok) => {
    let out = '', err = '';
    let p;
    try { p = spawn(bin, ['--list', ...extra], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch (e) { return ok({ ok: false, error: e.message }); }
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    p.on('error', (e) => { clearTimeout(timer); ok({ ok: false, error: e.message }); });
    p.on('close', () => {
      clearTimeout(timer);
      const line = out.split('\n').map((l) => l.trim()).filter(Boolean).pop();
      try { ok(JSON.parse(line ?? '')); } catch { ok({ ok: false, error: err.trim().split('\n').pop() || 'Helfer lieferte keine Liste' }); }
    });
  });
}

/**
 * Stream from a helper to a WebSocket in frame protocol 1. `ctx` supplies what lives in
 * server/index.mjs: ffmpeg path, decodeParams, outputSize, fail().
 */
export function startHelperStream(ws, { bin, args, label, params, ctx }) {
  const depth = params.get('depth') === '8' ? 8 : 16;
  const maxWidth = Math.min(3840, Math.max(0, Number(params.get('width') ?? 960) || 0));
  const fpsLimit = Math.min(60, Math.max(0, Number(params.get('fps') ?? 0) || 0));
  const opts = ctx.deviceOptions(params);
  const helper = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let ff = null, fmt = null, outBytes = 0, pending = [], pendingBytes = 0, sent = 0, dropped = 0, closed = false, stderr = '', status = '';

  const stopFf = () => { if (ff) { ff.stdin.destroy(); ff.kill('SIGKILL'); ff = null; } };
  const onOut = (chunk) => {
    pending.push(chunk); pendingBytes += chunk.length;
    while (pendingBytes >= outBytes) {
      const all = pending.length === 1 ? pending[0] : Buffer.concat(pending, pendingBytes);
      const frame = all.subarray(0, outBytes), rest = all.subarray(outBytes);
      pending = rest.length ? [rest] : []; pendingBytes = rest.length;
      if (ws.readyState !== ws.OPEN) return;
      if (ws.bufferedAmount < outBytes * 2) { ws.send(frame, { binary: true }); sent++; } else dropped++;
    }
  };
  const startFf = (info) => {
    stopFf();
    const f = helperFormat(info);
    if (f.error) return ctx.fail(ws, f.error);
    fmt = f;
    const { width, height } = ctx.outputSize(f.width, f.height, maxWidth);
    outBytes = width * height * 4 * (depth / 8); pending = []; pendingBytes = 0;
    const tags = { matrix: info.matrix ?? 'unknown', range: info.range ?? 'unknown', height: f.height };
    const { decodeMatrix, decodeRange } = ctx.applyDecodeOverride(ctx.decodeParams(tags), opts);
    const vf = [`scale=${width}:${height}:flags=area:in_color_matrix=${decodeMatrix}:in_range=${decodeRange}`];
    if (fpsLimit) vf.push(`fps=${fpsLimit}`);
    ff = spawn(ctx.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...f.input, '-vf', vf.join(','), '-pix_fmt', depth === 16 ? 'rgba64le' : 'rgba', '-f', 'rawvideo', 'pipe:1'],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    ff.stdin.on('error', () => {});
    ff.stderr.on('data', (d) => { stderr = (stderr + d).slice(-1500); });
    ff.stdout.on('data', onOut);
    const self = ff;
    ff.on('close', (code) => { if (self === ff && code && !closed) ctx.fail(ws, stderr.trim().split('\n').pop() || `ffmpeg beendet (${code})`); });
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({
        type: 'info', width, height, depth, fps: fpsLimit || f.fps, sourceWidth: f.width, sourceHeight: f.height,
        codec: `${label}${info.name ? ` · ${info.name}` : ''}`, pixFmt: info.pixel, decodeMatrix,
        transfer: info.transfer ?? 'unknown', primaries: info.primaries ?? 'unknown', matrix: info.matrix ?? 'unknown', range: info.range ?? 'unknown',
        ...(info.timecode ? { timecode: info.timecode } : {}),
      }));
    }
  };
  const parser = new HelperRecordParser((tag, payload) => {
    if (closed) return;
    if (tag === 'INFO') {
      let info;
      try { info = JSON.parse(payload.toString('utf8')); } catch { return ctx.fail(ws, 'Helfer: INFO kein JSON'); }
      startFf(info);
    } else if (tag === 'FRAM') {
      if (!ff || !fmt) return;
      if (payload.length !== fmt.bytes) { status = `Bildgröße passt nicht (${payload.length} statt ${fmt.bytes} Byte)`; return; }
      // newest picture wins: skip when ffmpeg is still busy with the previous ones
      if (ff.stdin.writableLength > fmt.bytes * 2) { dropped++; return; }
      ff.stdin.write(Buffer.from(payload));
    } else if (tag === 'STAT') {
      try { status = JSON.parse(payload.toString('utf8')).message ?? ''; } catch { status = payload.toString('utf8'); }
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'stats', sent, dropped, message: status }));
    } else if (tag === 'ERR') {
      ctx.fail(ws, payload.toString('utf8'));
    }
  });
  helper.stdout.on('data', (d) => { try { parser.push(d); } catch (e) { ctx.fail(ws, e.message); helper.kill('SIGKILL'); } });
  helper.stderr.on('data', (d) => { stderr = (stderr + d).slice(-1500); });
  helper.on('error', (e) => ctx.fail(ws, `${label}-Helfer nicht startbar: ${e.message}`));
  helper.on('close', (code) => {
    const finish = () => {
      stopFf();
      if (!closed && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: code === 0 ? 'end' : 'error', message: stderr.trim().split('\n').pop() || `${label}-Helfer beendet (${code})` }));
        ws.close();
      }
    };
    // let ffmpeg convert what it already has, then end
    if (!ff || closed) return finish();
    const self = ff;
    const timer = setTimeout(finish, 2000);
    self.removeAllListeners('close');
    self.on('close', () => { clearTimeout(timer); ff = null; finish(); });
    self.stdin.end();
  });
  const stats = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'stats', sent, dropped, ...(status ? { message: status } : {}) }));
  }, 1000);
  ws.on('close', () => { closed = true; clearInterval(stats); stopFf(); helper.kill('SIGTERM'); });
}
