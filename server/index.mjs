// lz-scopes bridge: decodes network streams (RTSP, RTMP, UDP, RTP, HTTP/HLS …) with
// ffmpeg and pushes raw RGBA frames to the browser over a WebSocket.
//
//   node server/index.mjs [--port 4190] [--host 127.0.0.1] [--dev]
//
// WebSocket: ws://host:port/stream?url=<input>&width=960&fps=25&depth=8|16&transport=tcp|udp
//   text  {type:"info", width, height, depth, fps, codec, transfer, primaries, matrix, range}
//   text  {type:"error"|"end", message}
//   binary one frame per message, width*height*4 samples (Uint8 or Uint16 LE)

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

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
let DEV = args.includes('--dev');
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

function inputArgs(url, transport) {
  if (url in TEST_PATTERNS) return ['-re', '-f', 'lavfi', '-i', TEST_PATTERNS[url]];
  const dev = deviceArgs(url);
  if (dev) return dev;
  const a = ['-fflags', 'nobuffer', '-flags', 'low_delay', '-analyzeduration', '1000000', '-probesize', '2000000'];
  // low latency: no reorder queue, no demuxer delay (the probe already ran separately)
  if (/^rtsps?:/i.test(url)) a.push('-rtsp_transport', transport === 'udp' ? 'udp' : 'tcp', '-timeout', '5000000', '-reorder_queue_size', '0', '-max_delay', '0');
  else a.push('-rw_timeout', '5000000');
  return [...a, '-i', url];
}

/** Size and colour tags from ffmpeg's input banner (used when there is no ffprobe). */
export function parseFfmpegBanner(stderr) {
  const line = stderr.split('\n').find((l) => /Stream #\d+:\d+.*: Video: /.test(l));
  if (!line) return null;
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
  return { width: Number(size[1]), height: Number(size[2]), codec, pixFmt: fmt?.[1], fps, transfer, primaries, matrix, range };
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
      if (info) { deviceRates.set(url, rate); return { ...info, fps: Number(rate) }; }
      last = r.err.trim().split('\n').filter((l) => !/output file/i.test(l)).pop() ?? '';
    }
    throw new Error(last || 'Gerät nicht verfügbar');
  }
  if (url in TEST_PATTERNS) {
    return { width: 1920, height: 1080, codec: 'lavfi', fps: 25, transfer: 'bt709', primaries: 'bt709', matrix: 'bt709', range: 'tv' };
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
  const a = ['-v', 'error', '-analyzeduration', '1000000', '-probesize', '2000000', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height,codec_name,avg_frame_rate,r_frame_rate,color_transfer,color_primaries,color_space,color_range,pix_fmt',
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
        const s = JSON.parse(out).streams?.[0];
        if (!s) throw new Error(err.trim() || `ffprobe beendet mit ${code}`);
        const rate = (r) => { const [n, d] = String(r ?? '0/1').split('/').map(Number); return d ? n / d : 0; };
        ok({
          width: s.width, height: s.height, codec: s.codec_name, pixFmt: s.pix_fmt,
          fps: Math.round((rate(s.avg_frame_rate) || rate(s.r_frame_rate)) * 100) / 100,
          transfer: s.color_transfer ?? 'unknown', primaries: s.color_primaries ?? 'unknown',
          matrix: s.color_space ?? 'unknown', range: s.color_range ?? 'unknown',
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

async function startStream(ws, params) {
  const url = params.get('url') ?? '';
  const problem = validateInput(url);
  if (problem) return fail(ws, problem);
  if (url === 'resolve:') return startResolve(ws, params);
  const transport = params.get('transport') ?? 'tcp';
  const depth = params.get('depth') === '16' ? 16 : 8;
  const maxWidth = Math.min(3840, Math.max(0, Number(params.get('width') ?? 960) || 0));
  const fpsLimit = Math.min(60, Math.max(0, Number(params.get('fps') ?? 0) || 0));

  let info;
  try { info = await probe(url, transport); } catch (e) { return fail(ws, e.message); }
  if (ws.readyState !== ws.OPEN) return;
  const { width, height } = outputSize(info.width, info.height, maxWidth);
  const bytesPerFrame = width * height * 4 * (depth / 8);

  // The scale filter converts Y'CbCr → R'G'B' with the stream's own matrix/range but
  // leaves the transfer function untouched, so PQ/HLG code values arrive unchanged.
  const { decodeMatrix, decodeRange } = decodeParams(info);
  const vf = [`scale=${width}:${height}:flags=area:in_color_matrix=${decodeMatrix}:in_range=${decodeRange}`];
  if (fpsLimit) vf.push(`fps=${fpsLimit}`);
  const ffmpeg = ffmpegCandidates()[0];
  if (!ffmpeg) return fail(ws, 'ffmpeg nicht gefunden – installieren (brew install ffmpeg) oder FFMPEG setzen');
  const ff = spawn(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-nostdin',
    ...inputArgs(url, transport),
    '-an', '-sn', '-dn', '-map', '0:v:0',
    '-vf', vf.join(','),
    '-fps_mode', 'passthrough', '-pix_fmt', depth === 16 ? 'rgba64le' : 'rgba',
    '-f', 'rawvideo', 'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  ws.send(JSON.stringify({ type: 'info', ...info, decodeMatrix, sourceWidth: info.width, sourceHeight: info.height, width, height, depth, fps: fpsLimit || info.fps }));

  let pending = [], pendingBytes = 0, sent = 0, dropped = 0, stderr = '';
  ff.stdout.on('data', (chunk) => {
    pending.push(chunk); pendingBytes += chunk.length;
    while (pendingBytes >= bytesPerFrame) {
      const all = pending.length === 1 ? pending[0] : Buffer.concat(pending, pendingBytes);
      const frame = all.subarray(0, bytesPerFrame);
      const rest = all.subarray(bytesPerFrame);
      pending = rest.length ? [rest] : []; pendingBytes = rest.length;
      // Drop instead of queueing when the browser falls behind: scopes want the newest frame.
      if (ws.bufferedAmount < bytesPerFrame * 2) { ws.send(frame, { binary: true }); sent++; } else dropped++;
    }
  });
  ff.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
  ff.on('error', (e) => fail(ws, `ffmpeg nicht startbar: ${e.message}`));
  ff.on('close', (code) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: code === 0 ? 'end' : 'error', message: stderr.trim().split('\n').pop() || `ffmpeg beendet (${code})` }));
      ws.close();
    }
  });
  const stats = setInterval(() => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'stats', sent, dropped }));
  }, 1000);
  ws.on('close', () => { clearInterval(stats); ff.kill('SIGKILL'); });
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

server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url ?? '', 'http://x').pathname;
  const target = path === '/stream' ? wss : path === '/out' ? outWss : null;
  if (!target) return socket.destroy();
  target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
});

/**
 * Start the bridge. Used by the CLI below and by the desktop app (electron/main.cjs),
 * which passes port 0 for a free port and its own dist folder.
 */
export function startBridge({ port = 4190, host = '127.0.0.1', dist, dev = false } = {}) {
  if (dist) DIST = resolve(dist);
  DEV = dev;
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => ok({ port: server.address().port, close: () => server.close() }));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(arg('port', process.env.PORT ?? 4190)), host = arg('host', process.env.HOST ?? '127.0.0.1');
  startBridge({ port, host, dev: DEV }).then(({ port: p }) => {
    console.log(`lz-scopes bridge on http://${host}:${p}${DEV ? ' (dev)' : ''} · ffmpeg: ${ffmpegCandidates()[0] ?? 'nicht gefunden'}`);
  });
}
