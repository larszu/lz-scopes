// lz-scopes bridge: decodes network streams (RTSP, RTMP, UDP, RTP, HTTP/HLS …) with
// ffmpeg and pushes raw RGBA frames to the browser over a WebSocket.
//
//   node server/index.mjs [--port 4192] [--host 127.0.0.1] [--dev]
//
// WebSocket: ws://host:port/stream?url=<input>&width=960&fps=25&depth=8|16&transport=tcp|udp[&audio=1][&video=0]
//   text  {type:"info", width, height, depth, fps, codec, transfer, primaries, matrix, range[, proto:2, audio]}
//   text  {type:"error"|"end", message}
//   binary one frame per message, width*height*4 samples (Uint8 or Uint16 LE)
//   with audio=1 (proto 2) every binary message starts with a 16-byte header, LZV1 = frame,
//   LZA1 = PCM (f32 interleaved); see docs/frame-protocol.md

import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { readTiff, toRgba } from './tiff.mjs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { basename, delimiter, dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { COMMANDS, controlAccess, validateCommand } from './control.mjs';
import { handleMeterSocket, meterInfo } from './meter.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
let DEV = args.includes('--dev');
/** Control API token (optional); with a token, clients outside 127.0.0.1 are allowed. */
let CONTROL_TOKEN = arg('control-token', process.env.LZS_CONTROL_TOKEN ?? '');
let DIST = resolve(fileURLToPath(new URL('../dist', import.meta.url)));

/**
 * Where ffmpeg lives: $FFMPEG, the bundled ffmpeg-static (desktop app; outside the
 * asar archive), then PATH plus the Homebrew prefixes – an app started from the
 * Finder does not inherit the shell's PATH.
 */
export function ffmpegCandidates(env = process.env) {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const list = [];
  if (env.FFMPEG) list.push(env.FFMPEG);
  try {
    const bundled = createRequire(import.meta.url)('ffmpeg-static');
    if (bundled) list.push(String(bundled).replace(`app.asar${process.platform === 'win32' ? '\\' : '/'}`, `app.asar.unpacked${process.platform === 'win32' ? '\\' : '/'}`));
  } catch { /* not installed */ }
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  if (process.platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin');
  if (process.platform === 'linux') dirs.push('/usr/bin', '/usr/local/bin');
  for (const d of dirs) list.push(join(d, exe));
  return [...new Set(list)].filter((f) => existsSync(f));
}

/** ffprobe next to each ffmpeg, then $FFPROBE. ffmpeg-static ships none – see parseFfmpegBanner. */
export function ffprobeCandidates(ffmpegs, env = process.env) {
  const list = [];
  if (env.FFPROBE) list.push(env.FFPROBE);
  for (const f of ffmpegs) {
    const name = basename(f);
    if (/^ffmpeg(\.exe)?$/.test(name)) list.push(join(dirname(f), name.replace('ffmpeg', 'ffprobe')));
  }
  return [...new Set(list)].filter((f) => existsSync(f));
}

// Only network inputs plus the built-in test pattern. No local files, no ffmpeg
// option injection: the URL is passed as a single argv element, never via a shell.
const ALLOWED = /^(rtsps?|rtmps?|rtp|udp|srt|http|https|tcp):\/\//i;
const TEST_PATTERNS = {
  'test:bars': 'smptehdbars=size=1920x1080:rate=25',
  'test:ramp': 'gradients=size=1920x1080:rate=25:c0=black:c1=white:x0=0:y0=0:x1=1919:y1=0:type=linear',
  'test:testsrc': 'testsrc2=size=1920x1080:rate=25',
  'test:colors': 'rgbtestsrc=size=1920x1080:rate=25',
};

/** Test tone for the lavfi patterns: 1 kHz stereo; lavfi's default amplitude 1/8 = −18.06 dBFS (EBU R 68). */
const TEST_TONE = 'sine=frequency=1000:sample_rate=48000,pan=stereo|c0=c0|c1=c0';

export function validateInput(url) {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return 'Keine Quelle angegeben';
  if (url in TEST_PATTERNS || url === 'resolve:') return null;
  if (/^device:(avfoundation|dshow|v4l2):[^\n\r]{1,200}$/.test(url)) return null;
  if (url.startsWith('-')) return 'Ungültige Quelle';
  if (!ALLOWED.test(url)) return 'Nur rtsp://, rtsps://, rtmp://, rtp://, udp://, srt://, tcp://, http(s)://, resolve: oder test:*';
  return null;
}

/** Local capture devices through ffmpeg (cards that show up as system video devices). */
/** Capture rate that worked for each device (probed once, see probe()). */
const deviceRates = new Map();
export const DEVICE_RATES = ['60', '50', '30', '25', '59.94', '29.97', '24'];

export function deviceArgs(url, rateOverride) {
  const [, fmt, name] = /^device:(avfoundation|dshow|v4l2):(.+)$/.exec(url) ?? [];
  if (!fmt) return null;
  // the device's own capture rate; the analysis rate is limited later by the fps filter
  const rate = ['-framerate', rateOverride ?? deviceRates.get(url) ?? '30'];
  if (fmt === 'avfoundation') return ['-f', 'avfoundation', ...rate, '-pixel_format', 'uyvy422', '-i', `${name}:none`];
  if (fmt === 'dshow') return ['-f', 'dshow', ...rate, '-rtbufsize', '256M', '-i', `video=${name}`];
  return ['-f', 'v4l2', ...rate, '-i', name];
}

function inputArgs(url, transport, { audio = false, video = true } = {}) {
  if (url in TEST_PATTERNS) {
    const a = [];
    if (video) a.push('-re', '-f', 'lavfi', '-i', TEST_PATTERNS[url]);
    if (audio) a.push('-re', '-f', 'lavfi', '-i', TEST_TONE);
    return a;
  }
  const dev = deviceArgs(url);
  if (dev) return dev;
  const a = ['-fflags', 'nobuffer', '-flags', 'low_delay', '-analyzeduration', '1000000', '-probesize', '2000000'];
  // low latency: no reorder queue, no demuxer delay (the probe already ran separately)
  if (/^rtsps?:/i.test(url)) a.push('-rtsp_transport', transport === 'udp' ? 'udp' : 'tcp', '-timeout', '5000000', '-reorder_queue_size', '0', '-max_delay', '0');
  else a.push('-rw_timeout', '5000000');
  return [...a, '-i', url];
}

/** First audio stream from ffmpeg's input banner: `Audio: aac (LC), 48000 Hz, stereo, fltp`. */
export function parseAudioBanner(stderr) {
  const line = stderr.split('\n').find((l) => /Stream #\d+:\d+.*: Audio: /.test(l));
  if (!line) return null;
  const m = /Audio: ([\w-]+)[^,]*,\s*(\d+) Hz,\s*([^,]+)/.exec(line);
  if (!m) return null;
  const layout = m[3].trim();
  const named = { mono: 1, stereo: 2, '2.1': 3, '3.0': 3, quad: 4, '4.0': 4, '5.0': 5, '5.0(side)': 5, '5.1': 6, '5.1(side)': 6, '6.1': 7, '7.1': 8 };
  const ch = named[layout] ?? Number(/(\d+) channels/.exec(layout)?.[1] ?? 0);
  return ch ? { codec: m[1], sampleRate: Number(m[2]), channels: ch, layout } : null;
}

/** Size and colour tags from ffmpeg's input banner (used when there is no ffprobe). */
export function parseFfmpegBanner(stderr) {
  const line = stderr.split('\n').find((l) => /Stream #\d+:\d+.*: Video: /.test(l));
  if (!line) {
    const audio = parseAudioBanner(stderr);
    return audio ? { width: 0, height: 0, fps: 0, audio } : null;
  }
  const size = /,\s*(\d{2,5})x(\d{2,5})\b/.exec(line);
  if (!size) return null;
  const codec = /Video: ([\w-]+)/.exec(line)?.[1];
  const fmt = /Video: [^,]+,\s*(\w+)(?:\(([^)]*)\))?/.exec(line);
  let range = 'unknown', matrix = 'unknown', primaries = 'unknown', transfer = 'unknown';
  for (const part of (fmt?.[2] ?? '').split(',').map((x) => x.trim())) {
    if (part === 'tv' || part === 'pc') range = part;
    else if (/^[\w-]+\/[\w-]+\/[\w-]+$/.test(part)) [matrix, primaries, transfer] = part.split('/');
    else if (/^(bt|smpte|arib|iec|gbr|ycgco|fcc)/.test(part)) matrix = primaries = transfer = part;
  }
  const fps = Number(/([\d.]+) fps/.exec(line)?.[1] ?? /([\d.]+) tbr/.exec(line)?.[1] ?? 0);
  return { width: Number(size[1]), height: Number(size[2]), codec, pixFmt: fmt?.[1], fps, transfer, primaries, matrix, range, audio: parseAudioBanner(stderr) };
}

function run(binary, a, timeoutMs) {
  return new Promise((ok) => {
    let p;
    try { p = spawn(binary, a, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch { return ok(null); }
    let out = '', err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => { err = (err + d).slice(-8000); });
    p.on('error', () => { clearTimeout(timer); ok(null); });
    p.on('close', (code) => { clearTimeout(timer); ok({ code, out, err }); });
  });
}

async function probe(url, transport) {
  if (url.startsWith('device:')) {
    // devices: find a capture rate the device accepts, read size/format from the banner
    const ffmpeg = ffmpegCandidates()[0];
    if (!ffmpeg) throw new Error('ffmpeg nicht gefunden');
    let last = '';
    for (const rate of [deviceRates.get(url), ...DEVICE_RATES].filter(Boolean)) {
      const r = await run(ffmpeg, ['-hide_banner', ...deviceArgs(url, rate), '-frames:v', '1', '-f', 'null', '-'], 15000);
      if (!r) continue;
      const info = r.code === 0 ? parseFfmpegBanner(r.err) : null;
      if (info) { deviceRates.set(url, rate); return { ...info, fps: Number(rate), audio: null }; }
      last = r.err.trim().split('\n').filter((l) => !/output file/i.test(l)).pop() ?? '';
    }
    throw new Error(last || 'Gerät nicht verfügbar');
  }
  if (url in TEST_PATTERNS) {
    return {
      width: 1920, height: 1080, codec: 'lavfi', fps: 25, transfer: 'bt709', primaries: 'bt709', matrix: 'bt709', range: 'tv',
      audio: { codec: 'lavfi', sampleRate: 48000, channels: 2, layout: 'stereo' },
    };
  }
  const ffmpegs = ffmpegCandidates();
  const probes = ffprobeCandidates(ffmpegs);
  if (!probes.length) {
    for (const ffmpeg of ffmpegs) {
      // Without an output ffmpeg prints the input banner and exits.
      const r = await run(ffmpeg, ['-hide_banner', ...inputArgs(url, transport)], 15000);
      if (!r) continue;
      const info = parseFfmpegBanner(r.err);
      if (info) return info;
      throw new Error(r.err.trim().split('\n').filter((l) => !/output file/i.test(l)).pop() || 'Quelle nicht erreichbar');
    }
    throw new Error('ffmpeg nicht gefunden');
  }
  const FFPROBE = probes[0];
  const a = ['-v', 'error', '-analyzeduration', '1000000', '-probesize', '2000000', '-show_entries',
    'stream=codec_type,width,height,codec_name,avg_frame_rate,r_frame_rate,color_transfer,color_primaries,color_space,color_range,pix_fmt,sample_rate,channels,channel_layout',
    '-of', 'json'];
  if (/^rtsps?:/i.test(url)) a.push('-rtsp_transport', transport === 'udp' ? 'udp' : 'tcp');
  a.push('-i', url);
  return new Promise((ok, fail) => {
    const p = spawn(FFPROBE, a, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); fail(new Error('Zeitüberschreitung beim Öffnen der Quelle')); }, 15000);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => { clearTimeout(timer); fail(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      try {
        const streams = JSON.parse(out).streams ?? [];
        const s = streams.find((x) => x.codec_type === 'video');
        const au = streams.find((x) => x.codec_type === 'audio' && Number(x.channels) > 0);
        if (!s && !au) throw new Error(err.trim() || `ffprobe beendet mit ${code}`);
        const audio = au ? { codec: au.codec_name, sampleRate: Number(au.sample_rate), channels: Number(au.channels), layout: au.channel_layout ?? '' } : null;
        if (!s) return ok({ width: 0, height: 0, fps: 0, audio });
        const rate = (r) => { const [n, d] = String(r ?? '0/1').split('/').map(Number); return d ? n / d : 0; };
        ok({
          width: s.width, height: s.height, codec: s.codec_name, pixFmt: s.pix_fmt,
          fps: Math.round((rate(s.avg_frame_rate) || rate(s.r_frame_rate)) * 100) / 100,
          transfer: s.color_transfer ?? 'unknown', primaries: s.color_primaries ?? 'unknown',
          matrix: s.color_space ?? 'unknown', range: s.color_range ?? 'unknown', audio,
        });
      } catch (e) { fail(new Error(err.trim().split('\n').pop() || e.message)); }
    });
  });
}

/**
 * Matrix and range for the Y'CbCr → R'G'B' conversion. swscale falls back to BT.601 for
 * untagged input, which skews every untagged HD camera stream – so decide explicitly:
 * tagged value first, otherwise BT.709 above SD and BT.601 for SD.
 */
export function decodeParams(info) {
  const m = String(info.matrix ?? '');
  const decodeMatrix = m.startsWith('bt2020') ? 'bt2020'
    : m === 'bt709' ? 'bt709'
      : m === 'smpte170m' || m === 'bt470bg' ? 'bt601'
        : m === 'smpte240m' ? 'smpte240m'
          : info.height > 576 ? 'bt709' : 'bt601';
  const decodeRange = info.range === 'pc' ? 'full' : 'limited';
  return { decodeMatrix, decodeRange };
}

/** Output size: fit into maxWidth keeping aspect, even dimensions. */
export function outputSize(w, h, maxWidth) {
  if (!w || !h) return { width: 960, height: 540 };
  const width = maxWidth > 0 && w > maxWidth ? maxWidth : w;
  const height = Math.round((h * width) / w);
  return { width: width & ~1, height: Math.max(2, height & ~1) };
}

/**
 * ffmpeg argument lists. `audio` = 'fd3' (one process, PCM on pipe:3), 'split' (video
 * process + separate audio process on pipe:1, fallback for Windows) or 'none'.
 * `video: false` = audio only (PCM on pipe:1).
 */
export function ffmpegArgs({ url, transport = 'tcp', vf = '', depth = 8, video = true, audio = 'none' }) {
  const test = url in TEST_PATTERNS;
  const head = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  const pcm = (map, target) => ['-map', map, '-vn', '-sn', '-dn', '-c:a', 'pcm_f32le', '-f', 'f32le', target];
  const vid = ['-map', '0:v:0', '-an', '-sn', '-dn', '-vf', vf, '-fps_mode', 'passthrough', '-pix_fmt', depth === 16 ? 'rgba64le' : 'rgba', '-f', 'rawvideo', 'pipe:1'];
  if (!video) return { main: [...head, ...inputArgs(url, transport, { audio: true, video: false }), ...pcm('0:a:0', 'pipe:1')], audio: null };
  if (audio === 'fd3') return { main: [...head, ...inputArgs(url, transport, { audio: true }), ...vid, ...pcm(test ? '1:a:0' : '0:a:0', 'pipe:3')], audio: null };
  if (audio === 'split') {
    return {
      main: [...head, ...inputArgs(url, transport), ...vid],
      audio: [...head, ...inputArgs(url, transport, { audio: true, video: false }), ...pcm('0:a:0', 'pipe:1')],
    };
  }
  return { main: [...head, ...inputArgs(url, transport), ...vid], audio: null };
}

/** 16-byte header of proto 2: 4 ASCII bytes, uint32, float64 (little endian). */
export function packetHeader(magic, count, value) {
  const b = Buffer.alloc(16);
  b.write(magic, 0, 'ascii'); b.writeUInt32LE(count >>> 0, 4); b.writeDoubleLE(value, 8);
  return b;
}

/** Splits a raw f32le stream into 20 ms packets with an LZA1 header; never drops. */
export class AudioPacketizer {
  constructor(sampleRate, channels, send) {
    this.frameBytes = channels * 4;
    this.packetFrames = Math.max(1, Math.round(sampleRate * 0.02));
    this.send = send; this.pending = []; this.bytes = 0; this.index = 0; this.packets = 0;
  }
  push(chunk) {
    this.pending.push(chunk); this.bytes += chunk.length;
    const want = this.packetFrames * this.frameBytes;
    while (this.bytes >= want) this.emit(want);
  }
  flush() { const b = this.bytes - (this.bytes % this.frameBytes); if (b > 0) this.emit(b); }
  emit(len) {
    const all = this.pending.length === 1 ? this.pending[0] : Buffer.concat(this.pending, this.bytes);
    const data = all.subarray(0, len), rest = all.subarray(len);
    this.pending = rest.length ? [rest] : []; this.bytes = rest.length;
    const n = len / this.frameBytes;
    this.send(Buffer.concat([packetHeader('LZA1', n, this.index), data]));
    this.index += n; this.packets++;
  }
}

async function startStream(ws, params) {
  const url = params.get('url') ?? '';
  const problem = validateInput(url);
  if (problem) return fail(ws, problem);
  if (url === 'resolve:') return startResolve(ws, params);
  const transport = params.get('transport') ?? 'tcp';
  const depth = params.get('depth') === '16' ? 16 : 8;
  const maxWidth = Math.min(3840, Math.max(0, Number(params.get('width') ?? 960) || 0));
  const fpsLimit = Math.min(60, Math.max(0, Number(params.get('fps') ?? 0) || 0));
  const wantAudio = params.get('audio') === '1';

  let info;
  try { info = await probe(url, transport); } catch (e) { return fail(ws, e.message); }
  if (ws.readyState !== ws.OPEN) return;
  const audioInfo = wantAudio && info.audio?.sampleRate && info.audio?.channels ? info.audio : null;
  const video = !!info.width && !(wantAudio && params.get('video') === '0');
  if (!video && !audioInfo) return fail(ws, wantAudio ? 'Weder Bild noch Ton in dieser Quelle' : 'Kein Videostream in dieser Quelle');
  const { width, height } = video ? outputSize(info.width, info.height, maxWidth) : { width: 0, height: 0 };
  const bytesPerFrame = width * height * 4 * (depth / 8);

  // The scale filter converts Y'CbCr → R'G'B' with the stream's own matrix/range but
  // leaves the transfer function untouched, so PQ/HLG code values arrive unchanged.
  const { decodeMatrix, decodeRange } = decodeParams(info);
  const vf = [`scale=${width}:${height}:flags=area:in_color_matrix=${decodeMatrix}:in_range=${decodeRange}`];
  if (fpsLimit) vf.push(`fps=${fpsLimit}`);
  const ffmpeg = ffmpegCandidates()[0];
  if (!ffmpeg) return fail(ws, 'ffmpeg nicht gefunden – installieren (brew install ffmpeg) oder FFMPEG setzen');

  const proto = wantAudio ? 2 : 1;
  const { audio: _probed, ...videoInfo } = info;
  const msg = { type: 'info', ...videoInfo, decodeMatrix, sourceWidth: info.width, sourceHeight: info.height, width, height, depth, fps: video ? (fpsLimit || info.fps) : 0 };
  if (proto === 2) {
    Object.assign(msg, {
      proto: 2,
      audio: audioInfo ? {
        sampleRate: audioInfo.sampleRate, channels: audioInfo.channels, format: 'f32le', layout: audioInfo.layout || '',
        codec: audioInfo.codec, sourceSampleRate: audioInfo.sampleRate, sourceChannels: audioInfo.channels,
      } : null,
    });
  }
  ws.send(JSON.stringify(msg));

  let sent = 0, dropped = 0, frameNo = 0, stderr = '', closed = false, split = process.env.LZS_AUDIO_SPLIT === '1';
  const procs = new Set();
  const packetizer = audioInfo ? new AudioPacketizer(audioInfo.sampleRate, audioInfo.channels, (buf) => { if (ws.readyState === ws.OPEN) ws.send(buf, { binary: true }); }) : null;

  let pending = [], pendingBytes = 0;
  const onVideo = (chunk) => {
    pending.push(chunk); pendingBytes += chunk.length;
    while (pendingBytes >= bytesPerFrame) {
      const all = pending.length === 1 ? pending[0] : Buffer.concat(pending, pendingBytes);
      const frame = all.subarray(0, bytesPerFrame);
      const rest = all.subarray(bytesPerFrame);
      pending = rest.length ? [rest] : []; pendingBytes = rest.length;
      // Drop instead of queueing when the browser falls behind: scopes want the newest frame.
      // This applies to video only – audio is never dropped.
      if (ws.bufferedAmount < bytesPerFrame * 2) {
        ws.send(proto === 2 ? Buffer.concat([packetHeader('LZV1', frameNo, NaN), frame]) : frame, { binary: true });
        sent++;
      } else dropped++;
      frameNo++;
    }
  };

  const finish = (code, text) => {
    if (closed) return;
    closed = true;
    packetizer?.flush();
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: code === 0 ? 'end' : 'error', message: text || `ffmpeg beendet (${code})` }));
      ws.close();
    }
  };

  const launch = (mode) => {
    const args = ffmpegArgs({ url, transport, vf: vf.join(','), depth, video, audio: audioInfo ? mode : 'none' });
    const fd3 = mode === 'fd3' && video && !!audioInfo;
    const t0 = Date.now();
    let audioBytes = 0;
    const onAudio = (c) => { audioBytes += c.length; packetizer.push(c); };
    const spawnOne = (a, withFd3) => {
      const p = spawn(ffmpeg, a, { stdio: withFd3 ? ['ignore', 'pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'], windowsHide: true });
      procs.add(p);
      p.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
      return p;
    };
    const main = spawnOne(args.main, fd3);
    main.stdout.on('data', video ? onVideo : onAudio);
    if (fd3) main.stdio[3].on('data', onAudio);
    let side = null;
    if (args.audio) {
      side = spawnOne(args.audio, false);
      side.stdout.on('data', onAudio);
      side.on('close', (code) => { procs.delete(side); if (code && !closed) stderr += `\nTon: ffmpeg beendet (${code})`; });
    }
    main.on('error', (e) => fail(ws, `ffmpeg nicht startbar: ${e.message}`));
    main.on('close', (code) => {
      procs.delete(main);
      // pipe:3 not usable (e.g. handle inheritance on Windows): retry with a second process
      if (fd3 && code !== 0 && !closed && ws.readyState === ws.OPEN && audioBytes === 0 && Date.now() - t0 < 8000
        && /pipe:3|bad file descriptor|invalid argument|error opening output/i.test(stderr)) {
        stderr = ''; split = true;
        return launch('split');
      }
      side?.kill('SIGKILL');
      finish(code, stderr.trim().split('\n').pop());
    });
  };
  launch(split ? 'split' : 'fd3');

  const stats = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return;
    const st = { type: 'stats', sent, dropped };
    if (packetizer) Object.assign(st, { audioSent: packetizer.packets, audioDropped: 0, audioGaps: 0, audioSplit: split });
    ws.send(JSON.stringify(st));
  }, 1000);
  ws.on('close', () => { clearInterval(stats); closed = true; for (const p of procs) p.kill('SIGKILL'); });
}

/**
 * DaVinci Resolve as input: server/resolve_helper.py exports the current (graded)
 * frame as 16-bit TIFF through Resolve's scripting API; we read it and send frames.
 */
function pythonCandidates() {
  const list = [process.env.LZ_PYTHON, process.platform === 'win32' ? 'python' : '/usr/bin/python3', 'python3'].filter(Boolean);
  return [...new Set(list)];
}

async function startResolve(ws, params) {
  const depth = params.get('depth') === '8' ? 8 : 16;
  const maxWidth = Math.min(3840, Math.max(0, Number(params.get('width') ?? 960) || 0));
  const fps = Math.min(30, Math.max(1, Number(params.get('fps')) || 10));
  const dir = await mkdtemp(join(tmpdir(), 'lz-scopes-resolve-'));
  const helper = fileURLToPath(new URL('./resolve_helper.py', import.meta.url)).replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);
  let py = null;
  for (const bin of pythonCandidates()) {
    py = spawn(bin, ['-u', helper, dir, String(fps)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const ok = await new Promise((r) => { py.once('error', () => r(false)); py.once('spawn', () => r(true)); });
    if (ok) break;
    py = null;
  }
  if (!py) return fail(ws, 'Python 3 nicht gefunden (für die Resolve-Anbindung nötig)');
  let sentInfo = false, busy = false, sent = 0, lastWait = '', stderr = '';
  py.stderr.on('data', (d) => { stderr = (stderr + d).slice(-1500); });
  const lines = createInterface({ input: py.stdout });
  lines.on('line', async (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.error) return fail(ws, msg.error);
    if (msg.wait) { if (msg.wait !== lastWait && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'stats', sent, dropped: 0, message: msg.wait })); lastWait = msg.wait; return; }
    if (busy || ws.readyState !== ws.OPEN || ws.bufferedAmount > 32 * 1024 * 1024) return;
    busy = true;
    try {
      const img = readTiff(await readFile(msg.path));
      const out = toRgba(img, maxWidth, depth);
      if (!sentInfo) {
        ws.send(JSON.stringify({
          type: 'info', width: out.width, height: out.height, depth, fps, codec: `Resolve · ${msg.project} / ${msg.timeline}`,
          pixFmt: `tiff ${img.bits} bit`, sourceWidth: img.width, sourceHeight: img.height,
          transfer: 'unknown', primaries: 'unknown', matrix: 'unknown', range: 'pc', decodeMatrix: img.height > 576 ? 'bt709' : 'bt601',
        }));
        sentInfo = true;
      }
      ws.send(Buffer.from(out.data.buffer, out.data.byteOffset, out.data.byteLength), { binary: true });
      sent++;
    } catch (e) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'stats', sent, dropped: 0, message: e.message }));
    } finally { busy = false; }
  });
  py.on('close', (code) => { if (ws.readyState === ws.OPEN) fail(ws, stderr.trim().split('\n').pop() || `Resolve-Anbindung beendet (${code})`); rm(dir, { recursive: true, force: true }).catch(() => {}); });
  ws.on('close', () => { py.kill(); });
}

/** Video capture devices known to ffmpeg on this machine, as device: URLs. */
export function parseDeviceList(stderr, fmt) {
  const out = [];
  if (fmt === 'avfoundation') {
    let video = false;
    for (const l of stderr.split('\n')) {
      if (/video devices:/i.test(l)) { video = true; continue; }
      if (/audio devices:/i.test(l)) video = false;
      const m = /\]\s\[(\d+)\]\s(.+)$/.exec(l);
      if (video && m && !/^Capture screen/i.test(m[2])) out.push({ name: m[2].trim(), url: `device:avfoundation:${m[2].trim()}` });
    }
  } else if (fmt === 'dshow') {
    for (const l of stderr.split('\n')) {
      const m = /"([^"]+)"\s*\(video\)/.exec(l);
      if (m) out.push({ name: m[1], url: `device:dshow:${m[1]}` });
    }
  }
  return out;
}

async function listDevices() {
  const ffmpeg = ffmpegCandidates()[0];
  if (!ffmpeg) return [];
  if (process.platform === 'linux') {
    const { readdir } = await import('node:fs/promises');
    return (await readdir('/dev').catch(() => [])).filter((f) => /^video\d+$/.test(f)).map((f) => ({ name: f, url: `device:v4l2:/dev/${f}` }));
  }
  const fmt = process.platform === 'win32' ? 'dshow' : 'avfoundation';
  const r = await run(ffmpeg, ['-hide_banner', '-f', fmt, '-list_devices', 'true', '-i', fmt === 'dshow' ? 'dummy' : ''], 10000);
  return r ? parseDeviceList(r.err, fmt) : [];
}

function fail(ws, message) {
  if (ws.readyState === ws.OPEN) { ws.send(JSON.stringify({ type: 'error', message })); ws.close(); }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    return res.end(JSON.stringify({ ok: true, name: 'lz-scopes-bridge', patterns: Object.keys(TEST_PATTERNS) }));
  }
  const mj = /^\/out\/([\w-]+)\.mjpeg$/.exec(path);
  if (mj) return serveMjpeg(mj[1], res);
  if (path === '/api/devices') {
    listDevices().then((list) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(list)); });
    return;
  }
  if (path === '/api/control' || path === '/api/control/commands') return handleControlHttp(req, res, path);
  if (path === '/api/meter') {
    // colour meter (ArgyllCMS spotread, server/meter.mjs): local app only
    const problem = controlAccess({ remote: req.socket.remoteAddress, origin: req.headers.origin, host: req.headers.host });
    if (problem) { res.writeHead(problem.status, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: problem.error })); }
    meterInfo().then((info) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(info)); });
    return;
  }
  if (path === '/api/outputs') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    return res.end(JSON.stringify([...outputs.entries()].map(([name, o]) => ({ name, url: `/out/${name}.mjpeg`, viewers: o.clients.size, target: o.target || null }))));
  }
  if (DEV) { res.writeHead(404); return res.end('bridge only (dev mode) – UI via vite'); }
  let file = normalize(join(DIST, decodeURIComponent(path)));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) { res.writeHead(500); return res.end('dist fehlt – erst `npm run build`'); }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
wss.on('connection', (ws, req) => {
  startStream(ws, new URL(req.url ?? '', 'http://x').searchParams).catch((e) => fail(ws, e.message));
});

// ---- outputs: the UI sends JPEG frames of an output window; served as MJPEG and optionally pushed
/** @type {Map<string, { frame: Buffer | null, clients: Set<import('node:http').ServerResponse>, ff: import('node:child_process').ChildProcess | null, target: string }>} */
const outputs = new Map();
const outWss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 16 * 1024 * 1024 });

/** Container format for a push target, or null if the URL is not allowed. */
export function pushFormat(target) {
  if (!/^(rtmps?|srt|rtsp|udp):\/\//i.test(target) || target.length > 2048) return null;
  return /^rtmp/i.test(target) ? 'flv' : /^rtsp/i.test(target) ? 'rtsp' : 'mpegts';
}

outWss.on('connection', (ws, req) => {
  const q = new URL(req.url ?? '', 'http://x').searchParams;
  const name = (q.get('name') ?? '').replace(/[^\w-]/g, '').slice(0, 40) || 'out';
  const fps = Math.min(60, Math.max(1, Number(q.get('fps')) || 25));
  const target = q.get('target') ?? '';
  const out = outputs.get(name) ?? { frame: null, clients: new Set(), ff: null, target: '' };
  outputs.set(name, out);
  const msg = (type, message) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type, message }));
  if (target) {
    const fmt = pushFormat(target);
    const ffmpeg = ffmpegCandidates()[0];
    if (!fmt) msg('error', 'Push-Ziel nur rtmp(s)://, srt://, rtsp://, udp://');
    else if (!ffmpeg) msg('error', 'ffmpeg nicht gefunden');
    else {
      out.ff = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', 'pipe:0',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-g', String(fps * 2), '-f', fmt, target],
      { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
      out.target = target;
      let err = '';
      out.ff.stderr.on('data', (d) => { err = (err + d).slice(-1000); });
      out.ff.on('close', (code) => { if (code) msg('error', `Push beendet: ${err.trim().split('\n').pop() ?? code}`); out.ff = null; });
      out.ff.stdin.on('error', () => {});
    }
  }
  msg('live', `/out/${name}.mjpeg${target ? ` → ${target}` : ''}`);
  ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    const frame = Buffer.from(data);
    out.frame = frame;
    for (const res of out.clients) {
      if (res.writableLength > frame.length * 2) continue; // slow viewer: skip
      res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
      res.write(frame); res.write('\r\n');
    }
    if (out.ff?.stdin.writable && out.ff.stdin.writableLength < frame.length * 3) out.ff.stdin.write(frame);
  });
  ws.on('close', () => {
    out.ff?.stdin.end(); out.ff?.kill('SIGTERM'); out.ff = null;
    for (const res of out.clients) res.end();
    outputs.delete(name);
  });
});

function serveMjpeg(name, res) {
  const out = outputs.get(name);
  if (!out) { res.writeHead(404); return res.end('keine Ausgabe mit diesem Namen'); }
  res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame', 'cache-control': 'no-cache', 'access-control-allow-origin': '*' });
  out.clients.add(res);
  res.on('close', () => out.clients.delete(res));
}

// ---- control API: HTTP POST /api/control and WebSocket /control (Companion, curl).
// The main window of the UI connects as /control?role=app, executes the commands and
// reports its state; the bridge only validates, forwards and relays.
/** @type {Set<import('ws').WebSocket>} */
const appClients = new Set();
/** @type {Set<import('ws').WebSocket>} */
const controlClients = new Set();
/** @type {Map<string, (reply: { ok: boolean, error?: string, result?: unknown }) => void>} */
const pending = new Map();
let appState = null, seq = 0;
const meterWss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 4 * 1024 * 1024 });
const ctlWss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 256 * 1024 });

const presentedToken = (req) => {
  const auth = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
  return auth ?? new URL(req.url ?? '', 'http://x').searchParams.get('token');
};
const accessProblem = (req) => controlAccess({
  remote: req.socket.remoteAddress, token: CONTROL_TOKEN, presented: presentedToken(req),
  origin: req.headers.origin, host: req.headers.host,
});

/** Forward a validated command to the main window; resolves with its reply. */
export function sendToApp(command, timeoutMs = 4000) {
  const app = [...appClients].pop();
  if (!app) return Promise.resolve({ ok: false, status: 503, error: 'Kein LZ-Scopes-Hauptfenster verbunden' });
  const id = `c${++seq}`;
  return new Promise((ok) => {
    const timer = setTimeout(() => { pending.delete(id); ok({ ok: false, status: 504, error: 'Hauptfenster antwortet nicht' }); }, timeoutMs);
    pending.set(id, (reply) => { clearTimeout(timer); ok(reply); });
    app.send(JSON.stringify({ type: 'command', id, command }));
  });
}

async function runControl(raw) {
  const v = validateCommand(raw);
  if (!v.ok) return { status: 400, body: { ok: false, error: v.error } };
  const reply = await sendToApp(v.command);
  return { status: reply.ok ? 200 : reply.status ?? 422, body: { ok: reply.ok, ...(reply.error ? { error: reply.error } : {}), ...(reply.result !== undefined ? { result: reply.result } : {}), state: appState } };
}

function handleControlHttp(req, res, path) {
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const problem = accessProblem(req);
  if (problem) return send(problem.status, { ok: false, error: problem.error });
  if (path === '/api/control/commands') return send(200, COMMANDS);
  if (req.method === 'GET') return send(200, { ok: true, connected: appClients.size > 0, state: appState });
  if (req.method !== 'POST') return send(405, { ok: false, error: 'GET oder POST' });
  // JSON only: a foreign web page cannot send that without a CORS preflight, which we never allow
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return send(415, { ok: false, error: 'Content-Type: application/json' });
  let body = '';
  req.on('data', (d) => { body += d; if (body.length > 64 * 1024) req.destroy(); });
  req.on('end', async () => {
    let raw;
    try { raw = JSON.parse(body); } catch { return send(400, { ok: false, error: 'Kein gültiges JSON' }); }
    const r = await runControl(raw);
    send(r.status, r.body);
  });
}

ctlWss.on('connection', (ws, req) => {
  const role = new URL(req.url ?? '', 'http://x').searchParams.get('role');
  if (role === 'app') {
    appClients.add(ws);
    broadcast({ type: 'connected', connected: true });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let m;
      try { m = JSON.parse(String(data)); } catch { return; }
      if (m.type === 'state') { appState = m.state; broadcast({ type: 'state', state: appState }); }
      else if (m.type === 'result' && pending.has(m.id)) { const done = pending.get(m.id); pending.delete(m.id); done(m); }
    });
    ws.on('close', () => {
      appClients.delete(ws);
      if (!appClients.size) { appState = null; broadcast({ type: 'connected', connected: false }); }
    });
    return;
  }
  controlClients.add(ws);
  ws.send(JSON.stringify({ type: 'hello', name: 'lz-scopes', connected: appClients.size > 0, state: appState, commands: Object.keys(COMMANDS) }));
  ws.on('message', async (data, isBinary) => {
    if (isBinary) return;
    let raw;
    try { raw = JSON.parse(String(data)); } catch { return ws.send(JSON.stringify({ type: 'result', ok: false, error: 'Kein gültiges JSON' })); }
    const r = await runControl(raw);
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'result', id: raw?.id ?? null, ...r.body, state: undefined }));
  });
  ws.on('close', () => controlClients.delete(ws));
});

function broadcast(msg) {
  const text = JSON.stringify(msg);
  for (const c of controlClients) if (c.readyState === c.OPEN) c.send(text);
}

server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url ?? '', 'http://x').pathname;
  if (path === '/control') {
    // the main window is always local and same-origin; it needs no token
    const isApp = new URL(req.url ?? '', 'http://x').searchParams.get('role') === 'app';
    const problem = isApp ? controlAccess({ remote: req.socket.remoteAddress, origin: req.headers.origin, host: req.headers.host }) : accessProblem(req);
    if (problem) {
      socket.end(`HTTP/1.1 ${problem.status} ${problem.status === 401 ? 'Unauthorized' : 'Forbidden'}\r\n\r\n`);
      return;
    }
    return ctlWss.handleUpgrade(req, socket, head, (ws) => ctlWss.emit('connection', ws, req));
  }
  if (path === '/meter') {
    // spotread drives measuring hardware: only the local app (same origin, loopback)
    const problem = controlAccess({ remote: req.socket.remoteAddress, origin: req.headers.origin, host: req.headers.host });
    if (problem) { socket.end(`HTTP/1.1 ${problem.status} Forbidden\r\n\r\n`); return; }
    return meterWss.handleUpgrade(req, socket, head, (ws) => handleMeterSocket(ws));
  }
  const target = path === '/stream' ? wss : path === '/out' ? outWss : null;
  if (!target) return socket.destroy();
  target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
});

/**
 * Start the bridge. Used by the CLI below and by the desktop app (electron/main.cjs),
 * which passes port 0 for a free port and its own dist folder.
 */
export function startBridge({ port = 4192, host = '127.0.0.1', dist, dev = false, controlToken } = {}) {
  if (dist) DIST = resolve(dist);
  if (controlToken !== undefined) CONTROL_TOKEN = controlToken;
  DEV = dev;
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => ok({ port: server.address().port, close: () => server.close() }));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(arg('port', process.env.PORT ?? 4192)), host = arg('host', process.env.HOST ?? '127.0.0.1');
  startBridge({ port, host, dev: DEV }).then(({ port: p }) => {
    console.log(`lz-scopes bridge on http://${host}:${p}${DEV ? ' (dev)' : ''} · ffmpeg: ${ffmpegCandidates()[0] ?? 'nicht gefunden'}`);
  });
}
