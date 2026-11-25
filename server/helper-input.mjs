// Native capture helpers (DeckLink, AJA, NDI) → bridge. A helper is a separate executable
// that writes records to stdout (helper protocol, docs/frame-protocol.md):
//
//   4 × ASCII tag | uint32 LE payload length | payload
//   INFO  JSON {width, height, fpsNum, fpsDen, pixel, matrix?, range?, transfer?, primaries?, name?, timecode?, sourceWidth?, sourceHeight?}
//   FRAM  one picture in `pixel` layout, rows without padding (v210: 128-byte blocks per 48 px)
//   STAT  JSON {message, code?, params?}   (status text, e.g. "no input signal"; code: server/messages.mjs)
//   TIME  JSON {tc, df}          (optional, per frame: source timecode, e.g. DeckLink RP 188)
//   FPTS  int64 LE               (optional, before FRAM: stream time of the picture in 1/48000 s)
//   AUDI  int64 LE + s32le       (optional: time of the first sample in 1/48000 s, then interleaved
//                                 samples; channels/rate from INFO.audio {sampleRate, channels, format:"s32le"})
//   ERR   UTF-8 text, or JSON {message, code?, params?}   (fatal; the helper exits afterwards)
//
// The bridge feeds the frames into ffmpeg (rawvideo/v210 demuxer on stdin) and uses the
// same scale step as for streams, so matrix/range handling is identical.

import { spawn } from 'node:child_process';
import { PhaseTracker } from './phase.mjs';
import { FrameAssembler } from './frames.mjs';
import { BridgeError, bmsg, toMsg } from './messages.mjs';
import { AudioPacketizer, packetHeader } from './proto2.mjs';
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
 * ffmpeg options before the helper input. Without them the v210 decoder runs frame threads, and
 * frame threading delays decoding by one frame per thread (libavcodec/pthread_frame.c, see
 * docs/research/low-latency.md): 405 ms at 1080p25 on a 10-core Mac, 6 ms with these
 * (scripts/decklink/latency.mjs, UltraStudio Recorder 3G, 03.11.2026). Slice threads stay.
 */
export const HELPER_INPUT_FLAGS = ['-flags', 'low_delay', '-thread_type', 'slice'];

/**
 * Decides which helper pictures go into ffmpeg. Two jobs:
 * - at most `max` pictures inside ffmpeg at once. Only Node's own write buffer was limited before;
 *   ffmpeg's internal queues (demuxer, filter, encoder) then filled up whenever scaling took longer
 *   than a frame, and the delay crept up to 0.5–0.7 s before frames were dropped (feedback 11/2026).
 *   Counting pictures in and out keeps the newest-picture-wins rule end to end.
 * - the frame rate cap: pictures are thinned out here instead of with ffmpeg's fps= filter, so
 *   ffmpeg does less work and every picture written comes out again (needed for the count and the PTS).
 * A stall (no output for `stallMs`, e.g. ffmpeg restarted or swallowed a picture) resets the count.
 */
export class FrameGate {
  constructor({ max = 2, fps = 0, limit = 0, stallMs = 1000, now = () => Date.now() } = {}) {
    this.max = max; this.ratio = limit > 0 && fps > limit ? limit / fps : 1; this.stallMs = stallMs; this.now = now;
    this.inFlight = 0; this.acc = 0; this.last = now();
  }
  /** A picture arrives from the helper: 'write' it to ffmpeg, skip it for the 'rate' cap, or drop it ('busy'). */
  offer() {
    if (this.ratio < 1) {
      this.acc += this.ratio;
      if (this.acc < 1 - 1e-9) return 'rate';
      this.acc -= 1;
    }
    if (this.inFlight >= this.max) {
      if (this.now() - this.last < this.stallMs) return 'busy';
      this.inFlight = 0;
    }
    if (this.inFlight === 0) this.last = this.now();
    this.inFlight++;
    return 'write';
  }
  /** ffmpeg delivered a picture. */
  done() { if (this.inFlight > 0) this.inFlight--; this.last = this.now(); }
}

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
export function startHelperStream(ws, { bin, args, env, label, params, ctx, audio = false }) {
  const depth = params.get('depth') === '8' ? 8 : 16;
  // frame protocol 2 (picture + sound) when the client asks for sound and the helper can deliver it
  const wantSound = !!audio && params.get('audio') === '1';
  // pts=1: picture headers with PTS even without sound (fixed playout delay in the client, #244)
  const proto = wantSound || params.get('pts') === '1' ? 2 : 1;
  /** latency=fixed: more pictures in flight, nothing dropped for speed – the client buffers anyway */
  const fixedLatency = params.get('latency') === 'fixed';
  /** format=yuv&pack=v210: the client takes packed Y′CbCr; a v210 helper at native width then goes out unconverted (#258) */
  const wantYuv = params.get('format') === 'yuv' && depth === 16 && params.get('pack') === 'v210';
  /** v210 passthrough active: pictures go to the client as they come, without ffmpeg */
  let pack = false;
  let frameNo = 0, nextPts = NaN, aud = null;
  /** PTS (s) of the pictures handed to ffmpeg, in order; ffmpeg keeps the order (without fps= it keeps every picture) */
  let ptsQueue = [];
  let gate = new FrameGate();
  const maxWidth = Math.min(3840, Math.max(0, Number(params.get('width') ?? 960) || 0));
  const fpsLimit = Math.min(60, Math.max(0, Number(params.get('fps') ?? 0) || 0));
  const opts = ctx.deviceOptions(params);
  const helper = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, ...(env ? { env } : {}) });
  // frame phase against the ST 2059-1 grid (server/phase.mjs), when the bridge passes a clock
  let phase = null, lastFps = 0, lastDf = false;
  let ff = null, fmt = null, outBytes = 0, asm = null, sent = 0, dropped = 0, closed = false, stderr = '', status = '';
  /** helper's own counters (NDI: received, ndiDropped, skipped, queue, connections per second) */
  let helperStats = null, helperDropped = 0, losing = false;
  // local recording (server/recorder.mjs): encoded second output of this ffmpeg; toggling restarts it
  let lastInfo = null;
  const recorder = ctx.recorder?.({
    restart: () => { if (lastInfo && !closed) startFf(lastInfo); },
    media: () => ({ width: fmt?.width ?? 0, height: fmt?.height ?? 0, fps: fmt?.fps ?? 0, codec: label, audioMap: null }),
  }) ?? null;
  ws.on('message', (data, isBinary) => {
    if (isBinary || !recorder) return;
    let m;
    try { m = JSON.parse(String(data)); } catch { return; }
    recorder.handle(m).catch((e) => recorder.error(e));
  });

  const stopFf = () => {
    pack = false;
    if (!ff) return;
    const old = ff;
    ff = null;
    if (old.recording) {
      // let the recording close its segment: end of input, then ffmpeg exits by itself
      old.stdout.removeAllListeners('data');
      old.stdin.end();
      setTimeout(() => { if (old.exitCode === null && old.signalCode === null) old.kill('SIGKILL'); }, 5000).unref();
    } else { old.stdin.destroy(); old.kill('SIGKILL'); }
  };
  const sendFrame = (frame) => {
    if (ws.readyState !== ws.OPEN) return;
    gate.done();
    const pts = ptsQueue.length ? ptsQueue.shift() : NaN;
    const no = frameNo++;
    if (ws.bufferedAmount < outBytes * (fixedLatency ? 6 : 2)) { ws.send(proto === 2 ? Buffer.concat([packetHeader('LZV1', no, pts), frame]) : frame, { binary: true }); sent++; } else dropped++;
  };
  /** INFO.audio → packetizer (new one when the format changes), or null. */
  const audioFormat = (info) => {
    const a = info?.audio;
    const ok = wantSound && a && a.format === 's32le' && [2, 8, 16, 32].includes(Number(a.channels)) && Number(a.sampleRate) === 48000;
    if (!ok) { aud = null; return null; }
    if (!aud || aud.channels !== Number(a.channels)) {
      const channels = Number(a.channels);
      aud = {
        channels, expected: null, lastAnchor: -Infinity,
        pk: new AudioPacketizer(48000, channels, (b) => { if (ws.readyState === ws.OPEN) ws.send(b, { binary: true }); }),
      };
    }
    return { sampleRate: 48000, channels: aud.channels, format: 'f32le', layout: '', codec: 'pcm_s32le', sourceSampleRate: 48000, sourceChannels: aud.channels };
  };
  /** AUDI: s32 → f32, gaps from the packet times, PTS anchors (first packet, gap, every 5 s). */
  const onAudio = (payload) => {
    if (!aud || payload.length < 8) return;
    const t = Number(payload.readBigInt64LE(0));
    const data = payload.subarray(8);
    const n = Math.floor(data.length / (aud.channels * 4));
    if (!n) return;
    const pk = aud.pk;
    let anchor = aud.expected === null || t - aud.lastAnchor >= 5 * 48000;
    if (aud.expected !== null && t !== aud.expected) {
      // lost sound: send what is pending, then jump the sample index (a jump = a gap, docs/frame-protocol.md)
      pk.flush();
      if (t > aud.expected) pk.index += t - aud.expected;
      anchor = true;
    }
    if (anchor && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'apts', index: pk.index + pk.bytes / pk.frameBytes, pts: t / 48000 }));
      aud.lastAnchor = t;
    }
    aud.expected = t + n;
    const len = n * aud.channels;
    const s32 = new Int32Array(data.buffer.slice(data.byteOffset, data.byteOffset + len * 4)); // copy: payload offset need not be aligned
    const f32 = new Float32Array(len);
    for (let i = 0; i < len; i++) f32[i] = s32[i] / 2147483648;
    pk.push(Buffer.from(f32.buffer));
  };
  // whole frames only (frames.mjs)
  const onOut = (chunk) => asm?.push(chunk);
  // INFO fields that change the ffmpeg command; a new mode name alone (p ↔ PsF) only updates the card
  const ffKey = (i) => JSON.stringify([i.width, i.height, i.fpsNum, i.fpsDen, i.pixel, i.matrix, i.range, i.interlaced, i.audio?.channels ?? 0]);
  const startFf = (info) => {
    stopFf();
    const f = helperFormat(info);
    if (f.error) return ctx.fail(ws, f.error);
    fmt = f;
    lastInfo = info;
    lastFps = f.fps;
    ptsQueue = [];
    gate = new FrameGate({ fps: f.fps, limit: fpsLimit, max: fixedLatency ? 6 : 2 });
    phase = ctx.now && f.fps > 0 ? new PhaseTracker(Math.round(Number(info.fpsNum)), Math.round(Number(info.fpsDen) || 1)) : null;
    // v210 passthrough (#258): Y′CbCr wanted, native width, no recording (that needs ffmpeg) –
    // the client unpacks it (src/v210.ts); about a third of 16-bit RGBA and no ffmpeg cost
    if (wantYuv && info.pixel === 'v210' && (maxWidth === 0 || maxWidth >= f.width) && !recorder?.active && !recorder?.ringActive) {
      pack = true;
      outBytes = f.bytes;
      gate = new FrameGate({ fps: f.fps, limit: fpsLimit, max: Infinity });
      const { decodeMatrix, decodeRange } = ctx.applyDecodeOverride(ctx.decodeParams({ matrix: info.matrix ?? 'unknown', range: info.range ?? 'unknown', height: f.height }), opts);
      const range = decodeRange === 'full' ? 'full' : 'limited';
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'info', width: f.width, height: f.height, depth: 16, fps: fpsLimit || f.fps, sourceWidth: Number(info.sourceWidth) || f.width, sourceHeight: Number(info.sourceHeight) || f.height,
          codec: `${label}${info.name ? ` · ${info.name}` : ''}`, pixFmt: info.pixel, decodeMatrix,
          transfer: info.transfer ?? 'unknown', primaries: info.primaries ?? 'unknown', matrix: info.matrix ?? 'unknown', range: info.range ?? 'unknown',
          format: 'yuv', yuvRange: range, bits: 10, pack: 'v210',
          ...(info.timecode ? { timecode: info.timecode } : {}),
          ...(info.interlaced ? { interlaced: true } : {}),
          ...(proto === 2 ? { proto: 2, audio: audioFormat(info) } : {}),
        }));
      }
      return;
    }
    const { width, height } = ctx.outputSize(f.width, f.height, maxWidth);
    outBytes = width * height * 4 * (depth / 8); asm = new FrameAssembler(outBytes, sendFrame);
    const tags = { matrix: info.matrix ?? 'unknown', range: info.range ?? 'unknown', height: f.height };
    const { decodeMatrix, decodeRange } = ctx.applyDecodeOverride(ctx.decodeParams(tags), opts);
    // interlaced signal (helper INFO): DeckLink delivers both fields woven in one frame; scale field by field
    const vf = [`scale=${width}:${height}:flags=area:in_color_matrix=${decodeMatrix}:in_range=${decodeRange}${info.interlaced ? ':interl=1' : ''}`];
    // the frame rate cap is applied before ffmpeg (FrameGate), not with fps=
    const rec = recorder?.outputs(3) ?? { args: [], pipes: 0, sessions: [] };
    ff = spawn(ctx.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...HELPER_INPUT_FLAGS, ...f.input, '-map', '0:v:0', '-vf', vf.join(','), '-pix_fmt', depth === 16 ? 'rgba64le' : 'rgba', '-threads', '1', '-f', 'rawvideo', 'pipe:1', ...rec.args],
      { stdio: ['pipe', 'pipe', 'pipe', ...Array(rec.pipes).fill('pipe')], windowsHide: true });
    ff.recording = rec.sessions.length > 0;
    if (rec.sessions.length) recorder.attach(ff, rec);
    ff.stdin.on('error', () => {});
    ff.stderr.on('data', (d) => { stderr = (stderr + d).slice(-1500); });
    ff.stdout.on('data', onOut);
    const self = ff;
    ff.on('close', (code) => { if (self === ff && !self.ending && code && !closed) ctx.fail(ws, stderr.trim().split('\n').pop() || bmsg('ffmpeg.exit', `ffmpeg exited (${code})`, { code })); });
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({
        // the helper may have reduced the picture already (NDI --width): report the signal's size
        type: 'info', width, height, depth, fps: fpsLimit || f.fps, sourceWidth: Number(info.sourceWidth) || f.width, sourceHeight: Number(info.sourceHeight) || f.height,
        codec: `${label}${info.name ? ` · ${info.name}` : ''}`, pixFmt: info.pixel, decodeMatrix,
        transfer: info.transfer ?? 'unknown', primaries: info.primaries ?? 'unknown', matrix: info.matrix ?? 'unknown', range: info.range ?? 'unknown',
        ...(info.timecode ? { timecode: info.timecode } : {}),
        ...(info.interlaced ? { interlaced: true } : {}),
        ...(proto === 2 ? { proto: 2, audio: audioFormat(info) } : {}),
      }));
    }
  };
  const parser = new HelperRecordParser((tag, payload) => {
    if (closed) return;
    if (tag === 'INFO') {
      let info;
      try { info = JSON.parse(payload.toString('utf8')); } catch { return ctx.fail(ws, bmsg('helper.info', 'Helper: INFO is not JSON')); }
      if ((ff || pack) && lastInfo && ffKey(info) === ffKey(lastInfo)) { lastInfo = info; return; }
      startFf(info);
    } else if (tag === 'TIME') {
      let tcm;
      try { tcm = JSON.parse(payload.toString('utf8')); } catch { return; }
      lastDf = !!tcm.df;
      if (typeof tcm.tc === 'string' && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'tc', tc: tcm.tc, kind: label.toLowerCase(), fps: lastFps || null, df: lastDf }));
    } else if (tag === 'AUDI') {
      onAudio(payload);
    } else if (tag === 'FPTS') {
      if (payload.length === 8) nextPts = Number(payload.readBigInt64LE(0)) / 48000;
    } else if (tag === 'VANC') {
      // SDI ancillary packets (DeckLink, AJA; #160): forwarded as they are, decoded in the browser (src/vanc.ts)
      let v;
      try { v = JSON.parse(payload.toString('utf8')); } catch { return; }
      if (Array.isArray(v.packets) && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'vanc', packets: v.packets.slice(0, 64) }));
    } else if (tag === 'FRAM') {
      if (phase && ctx.now) { const n = ctx.now(); phase.add(n.seconds, n.ref); }
      // pictures again: a "no input signal" from the lock-up phase no longer applies
      if (status && (status.code === 'decklink.noSignal' || status.code === 'aja.noSignal')) status = '';
      if ((!ff && !pack) || !fmt) return;
      if (payload.length !== fmt.bytes) { status = bmsg('helper.frameSize', `Picture size does not match (${payload.length} instead of ${fmt.bytes} bytes)`, { got: payload.length, want: fmt.bytes }); return; }
      // newest picture wins: skip when ffmpeg is still busy with the previous ones
      const pts = nextPts; nextPts = NaN;
      if (pack) {
        if (gate.offer() === 'rate') return;
        ptsQueue = [pts];
        sendFrame(Buffer.from(payload));
        return;
      }
      if (ff.stdin.writableLength > fmt.bytes * (fixedLatency ? 4 : 2)) { dropped++; return; }
      const go = gate.offer();
      if (go === 'rate') return;
      if (go === 'busy') { dropped++; return; }
      if (proto === 2) { ptsQueue.push(pts); if (ptsQueue.length > 64) ptsQueue.shift(); }
      ff.stdin.write(Buffer.from(payload));
    } else if (tag === 'STAT') {
      const m = helperText(payload);
      // DeckLink/AJA helper: pictures replaced by newer ones while the pipe was full, or dropped by the
      // card's AutoCirculate ring (aja.dropped) – counted, no status text
      if (m.code === 'decklink.skipped' || m.code === 'aja.skipped' || m.code === 'aja.dropped') { helperDropped += Number(m.params?.n) || 0; return; }
      if (m.code === 'st2110.stats') {
        // ST 2110 receiver counters once a second (server/st2110/receiver.mjs): broken frames count as dropped
        const c = m.params ?? {};
        ctx.onStats?.(c);
        const broken = Math.max(0, (Number(c.broken) || 0) - (helperStats?.broken ?? 0));
        helperStats = { packets: c.packets, frames: c.frames, broken: c.broken, lost: c.timing?.lost ?? 0, secondaryUsed: c.secondaryUsed ?? 0 };
        helperDropped += broken;
        const was = losing;
        losing = broken > 0;
        if (broken > 0) status = bmsg('st2110.broken', `ST 2110: ${broken} incomplete frames in the last second (${c.timing?.lost ?? 0} packets lost so far)`, { n: broken, lost: Number(c.timing?.lost) || 0 });
        else if (was) status = bmsg('st2110.recovered', 'ST 2110: complete frames again');
        else return;
      } else if (m.code === 'ndi.stats') {
        // NDI counters once a second: losses go into `dropped`; text only while pictures get lost
        const c = m.params ?? {};
        helperStats = c;
        const lost = (Number(c.ndiDropped) || 0) + (Number(c.skipped) || 0);
        helperDropped += lost;
        const was = losing;
        losing = lost > 0 || c.connections === 0;
        if (c.connections === 0) status = bmsg('ndi.noConnection', 'NDI source not connected');
        else if (lost > 0) status = bmsg('ndi.dropping', `NDI: ${lost} pictures lost in the last second (network ${c.ndiDropped}, helper ${c.skipped})`, { lost, ndi: Number(c.ndiDropped) || 0, helper: Number(c.skipped) || 0 });
        else if (was) status = bmsg('ndi.recovered', `NDI: no losses again (${c.fps} fps)`, { fps: Number(c.fps) || 0 });
        else return;
      } else status = m;
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'stats', sent, dropped: dropped + helperDropped, ...toMsg(status), ...(helperStats ? { helper: helperStats } : {}) }));
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
    recorder?.ended('end');
    // let ffmpeg convert what it already has, then end
    if (!ff || closed) return finish();
    const self = ff;
    const timer = setTimeout(finish, self.recording ? 5000 : 2000);
    self.ending = true;
    self.on('close', () => { clearTimeout(timer); ff = null; finish(); });
    self.stdin.end();
  });
  const stats = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'stats', sent, dropped: dropped + helperDropped, ...(status ? toMsg(status) : {}), ...(helperStats ? { helper: helperStats } : {}), ...(phase?.report() ? { phase: phase.report() } : {}), ...(recorder?.active ? { rec: recorder.status() } : {}), ...(recorder?.ringActive ? { ring: recorder.ringStatus() } : {}) }));
  }, 1000);
  ws.on('close', () => { closed = true; clearInterval(stats); recorder?.ended('closed'); stopFf(); helper.kill('SIGTERM'); });
}
