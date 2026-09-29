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
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { basename, delimiter, dirname, extname, join, normalize, resolve } from 'node:path';
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
  if (url in TEST_PATTERNS) return null;
  if (url.startsWith('-')) return 'Ungültige Quelle';
  if (!ALLOWED.test(url)) return 'Nur rtsp://, rtsps://, rtmp://, rtp://, udp://, srt://, tcp://, http(s):// oder test:*';
  return null;
}

function inputArgs(url, transport) {
  if (url in TEST_PATTERNS) return ['-re', '-f', 'lavfi', '-i', TEST_PATTERNS[url]];
  const a = ['-fflags', 'nobuffer', '-flags', 'low_delay', '-analyzeduration', '1000000', '-probesize', '2000000'];
  if (/^rtsps?:/i.test(url)) a.push('-rtsp_transport', transport === 'udp' ? 'udp' : 'tcp', '-timeout', '5000000');
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
    '-pix_fmt', depth === 16 ? 'rgba64le' : 'rgba',
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
  if (DEV) { res.writeHead(404); return res.end('bridge only (dev mode) – UI via vite'); }
  let file = normalize(join(DIST, decodeURIComponent(path)));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) { res.writeHead(500); return res.end('dist fehlt – erst `npm run build`'); }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, path: '/stream', perMessageDeflate: false });
wss.on('connection', (ws, req) => {
  startStream(ws, new URL(req.url ?? '', 'http://x').searchParams).catch((e) => fail(ws, e.message));
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
