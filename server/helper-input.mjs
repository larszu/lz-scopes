// Native capture helpers (DeckLink, NDI) → bridge. A helper is a separate executable
// that writes records to stdout (helper protocol, docs/frame-protocol.md):
//
//   4 × ASCII tag | uint32 LE payload length | payload
//   INFO  JSON {width, height, fpsNum, fpsDen, pixel, matrix?, range?, transfer?, primaries?, name?, timecode?}
//   FRAM  one picture in `pixel` layout, rows without padding (v210: 128-byte blocks per 48 px)
//   STAT  JSON {message, code?, params?}   (status text, e.g. "no input signal"; code: server/messages.mjs)
//   TIME  JSON {tc, df}          (optional, per frame: source timecode, e.g. DeckLink RP 188)
//   ERR   UTF-8 text, or JSON {message, code?, params?}   (fatal; the helper exits afterwards)
//
// The bridge feeds the frames into ffmpeg (rawvideo/v210 demuxer on stdin) and uses the
// same scale step as for streams, so matrix/range handling is identical.

import { spawn } from 'node:child_process';
import { PhaseTracker } from './phase.mjs';
import { FrameAssembler } from './frames.mjs';
import { BridgeError, bmsg, toMsg } from './messages.mjs';
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

/**
 * Splits the helper's stdout into records; never loses bytes across chunk borders.
 * Chunks are collected in a list and joined once per record: Windows pipes deliver a frame
 * in thousands of small chunks, and re-concatenating on every chunk cost O(n²) (NDI at 2 fps).
 */
export class HelperRecordParser {
  constructor(onRecord, maxPayload = 256 * 1024 * 1024) {
    this.onRecord = onRecord; this.max = maxPayload; this.buf = Buffer.alloc(0);
    /** @type {Buffer[]} */
    this.pending = []; this.pendingBytes = 0; this.need = 0;
  }
  push(chunk) {
    if (this.need) {
      this.pending.push(chunk); this.pendingBytes += chunk.length;
      if (this.pendingBytes < this.need) return;
      chunk = Buffer.concat(this.pending, this.pendingBytes); this.pending = []; this.pendingBytes = 0; this.need = 0;
    }
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= 8) {
      const tag = this.buf.toString('ascii', 0, 4);
      const len = this.buf.readUInt32LE(4);
      if (!/^[A-Z ]{3,4}$/.test(tag) || len > this.max) throw new BridgeError('helper.protocol', `Helper protocol broken (${JSON.stringify(tag)})`, { tag: JSON.stringify(tag) });
      if (this.buf.length < 8 + len) {
        // wait for the rest of this record without copying on every chunk
        this.pending = [this.buf]; this.pendingBytes = this.buf.length; this.need = 8 + len; this.buf = Buffer.alloc(0);
        return;
      }
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

/** Validated INFO record → ffmpeg input description, or { error: message object }. */
export function helperFormat(info) {
  const w = Number(info?.width), h = Number(info?.height);
  const px = HELPER_PIXELS[info?.pixel];
  if (!px) return { error: bmsg('helper.pixel', `Unknown pixel format from the helper: ${info?.pixel}`, { pixel: String(info?.pixel) }) };
  if (!(w >= 16 && w <= 8192 && h >= 16 && h <= 8192)) return { error: bmsg('helper.size', `Invalid picture size from the helper: ${w}×${h}`, { w, h }) };
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
      try { ok(JSON.parse(line ?? '')); } catch { ok({ ok: false, ...(err.trim() ? { error: err.trim().split('\n').pop() } : { error: 'Helper returned no list', code: 'helper.noList' }) }); }
    });
  });
}

/** STAT/ERR payload: JSON {message, code?, params?} or plain text → message object. */
export function helperText(payload) {
  const text = payload.toString('utf8');
  try {
    const j = JSON.parse(text);
    if (j && typeof j === 'object' && typeof j.message === 'string') return { message: j.message, ...(j.code ? { code: j.code } : {}), ...(j.params ? { params: j.params } : {}) };
  } catch { /* plain text */ }
  return { message: text };
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
  // frame phase against the ST 2059-1 grid (server/phase.mjs), when the bridge passes a clock
  let phase = null, lastFps = 0, lastDf = false;
  let ff = null, fmt = null, outBytes = 0, asm = null, sent = 0, dropped = 0, closed = false, stderr = '', status = '';

  const stopFf = () => { if (ff) { ff.stdin.destroy(); ff.kill('SIGKILL'); ff = null; } };
  const sendFrame = (frame) => {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount < outBytes * 2) { ws.send(frame, { binary: true }); sent++; } else dropped++;
  };
  // whole frames only (frames.mjs)
  const onOut = (chunk) => asm?.push(chunk);
  const startFf = (info) => {
    stopFf();
    const f = helperFormat(info);
    if (f.error) return ctx.fail(ws, f.error);
    fmt = f;
    lastFps = f.fps;
    phase = ctx.now && f.fps > 0 ? new PhaseTracker(Math.round(Number(info.fpsNum)), Math.round(Number(info.fpsDen) || 1)) : null;
    const { width, height } = ctx.outputSize(f.width, f.height, maxWidth);
    outBytes = width * height * 4 * (depth / 8); asm = new FrameAssembler(outBytes, sendFrame);
    const tags = { matrix: info.matrix ?? 'unknown', range: info.range ?? 'unknown', height: f.height };
    const { decodeMatrix, decodeRange } = ctx.applyDecodeOverride(ctx.decodeParams(tags), opts);
    // interlaced signal (helper INFO): DeckLink delivers both fields woven in one frame; scale field by field
    const vf = [`scale=${width}:${height}:flags=area:in_color_matrix=${decodeMatrix}:in_range=${decodeRange}${info.interlaced ? ':interl=1' : ''}`];
    if (fpsLimit) vf.push(`fps=${fpsLimit}`);
    ff = spawn(ctx.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...f.input, '-vf', vf.join(','), '-pix_fmt', depth === 16 ? 'rgba64le' : 'rgba', '-threads', '1', '-f', 'rawvideo', 'pipe:1'],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    ff.stdin.on('error', () => {});
    ff.stderr.on('data', (d) => { stderr = (stderr + d).slice(-1500); });
    ff.stdout.on('data', onOut);
    const self = ff;
    ff.on('close', (code) => { if (self === ff && code && !closed) ctx.fail(ws, stderr.trim().split('\n').pop() || bmsg('ffmpeg.exit', `ffmpeg exited (${code})`, { code })); });
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({
        type: 'info', width, height, depth, fps: fpsLimit || f.fps, sourceWidth: f.width, sourceHeight: f.height,
        codec: `${label}${info.name ? ` · ${info.name}` : ''}`, pixFmt: info.pixel, decodeMatrix,
        transfer: info.transfer ?? 'unknown', primaries: info.primaries ?? 'unknown', matrix: info.matrix ?? 'unknown', range: info.range ?? 'unknown',
        ...(info.timecode ? { timecode: info.timecode } : {}),
        ...(info.interlaced ? { interlaced: true } : {}),
      }));
    }
  };
  const parser = new HelperRecordParser((tag, payload) => {
    if (closed) return;
    if (tag === 'INFO') {
      let info;
      try { info = JSON.parse(payload.toString('utf8')); } catch { return ctx.fail(ws, bmsg('helper.info', 'Helper: INFO is not JSON')); }
      startFf(info);
    } else if (tag === 'TIME') {
      let tcm;
      try { tcm = JSON.parse(payload.toString('utf8')); } catch { return; }
      lastDf = !!tcm.df;
      if (typeof tcm.tc === 'string' && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'tc', tc: tcm.tc, kind: label.toLowerCase(), fps: lastFps || null, df: lastDf }));
    } else if (tag === 'FRAM') {
      if (phase && ctx.now) { const n = ctx.now(); phase.add(n.seconds, n.ref); }
      if (!ff || !fmt) return;
      if (payload.length !== fmt.bytes) { status = bmsg('helper.frameSize', `Picture size does not match (${payload.length} instead of ${fmt.bytes} bytes)`, { got: payload.length, want: fmt.bytes }); return; }
      // newest picture wins: skip when ffmpeg is still busy with the previous ones
      if (ff.stdin.writableLength > fmt.bytes * 2) { dropped++; return; }
      ff.stdin.write(Buffer.from(payload));
    } else if (tag === 'STAT') {
      status = helperText(payload);
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'stats', sent, dropped, ...toMsg(status) }));
    } else if (tag === 'ERR') {
      ctx.fail(ws, helperText(payload));
    }
  });
  helper.stdout.on('data', (d) => { try { parser.push(d); } catch (e) { ctx.fail(ws, e); helper.kill('SIGKILL'); } });
  helper.stderr.on('data', (d) => { stderr = (stderr + d).slice(-1500); });
  helper.on('error', (e) => ctx.fail(ws, bmsg('helper.spawn', `${label} helper cannot be started: ${e.message}`, { label, reason: e.message })));
  helper.on('close', (code) => {
    const finish = () => {
      stopFf();
      if (!closed && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: code === 0 ? 'end' : 'error', ...toMsg(stderr.trim().split('\n').pop() || bmsg('helper.exit', `${label} helper exited (${code})`, { label, code })) }));
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
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'stats', sent, dropped, ...(status ? toMsg(status) : {}), ...(phase?.report() ? { phase: phase.report() } : {}) }));
  }, 1000);
  ws.on('close', () => { closed = true; clearInterval(stats); stopFf(); helper.kill('SIGTERM'); });
}
