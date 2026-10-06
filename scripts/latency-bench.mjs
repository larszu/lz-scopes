// Latency bench for the part of the chain before the app (low-latency mode, #16 follow-up):
// stamped test source (scripts/latency-source.mjs) → x264 → mediamtx (RTSP) → ffmpeg as the
// bridge runs it → raw frames on a pipe. Reads the stamp (server/stamp.mjs) from every
// frame when it leaves ffmpeg and prints mean / sd / min / max of "stamp → out of ffmpeg"
// for each variant of the pull arguments. No browser, no WebSocket: only what ffmpeg adds.
//
//   brew install mediamtx ffmpeg
//   node scripts/latency-bench.mjs [--seconds 8] [--runs 3] [--size 1280x720] [--fps 25] [--codec h264|hevc] [--bframes 0] [--only name,name]
//
// Every variant runs `runs` times in turn (A B C A B C …) so drift of the machine spreads
// over all of them. The first second of every run is discarded (connect, key frame).

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStamp, stampAge } from '../server/stamp.mjs';
import { startLatencySource } from './latency-source.mjs';
import { startOwnRtp } from '../server/rtsp.mjs';

const freePort = () => new Promise((ok, fail) => {
  const s = createServer();
  s.once('error', fail);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function startMediamtx(bin = 'mediamtx') {
  const rtsp = await freePort(), rtp = 20000 + 2 * Math.floor(Math.random() * 10000), rtcp = rtp + 1; // RTP even, RTCP = RTP + 1
  const dir = mkdtempSync(join(tmpdir(), 'lzs-mtx-'));
  const cfg = join(dir, 'mediamtx.yml');
  writeFileSync(cfg, ['logLevel: warn', `rtspAddress: 127.0.0.1:${rtsp}`, 'rtspTransports: [tcp, udp]', `rtpAddress: :${rtp}`, `rtcpAddress: :${rtcp}`,
    'rtmp: no', 'hls: no', 'webrtc: no', 'srt: no', 'moq: no', 'api: no', 'metrics: no', 'pprof: no', 'playback: no', 'paths:', '  all_others:'].join('\n'));
  const proc = spawn(bin, [cfg], { cwd: dir, stdio: ['ignore', 'ignore', 'inherit'] });
  // wait until the RTSP port is taken (mediamtx generates certificates first)
  for (let i = 0; i < 150; i++) {
    const busy = await new Promise((ok) => { const s = createServer(); s.once('error', () => ok(true)); s.listen(rtsp, '127.0.0.1', () => s.close(() => ok(false))); });
    if (busy) break;
    await sleep(100);
  }
  return { rtsp, stop: () => { proc.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); } };
}

/** Pull `url` with `args` (input options, then the output chain) and collect stamp ages at the pipe. */
export async function pull(ffmpeg, url, { input = [], vf = 'scale=960:540:flags=area', width = 960, height = 540, seconds = 8, output = [], own = null }) {
  const q = ['-hide_banner', '-loglevel', 'error'];
  const raw = ['-fps_mode', 'passthrough', '-pix_fmt', 'rgba', ...output, '-f', 'rawvideo', 'pipe:1'];
  // own: the bridge's RTSP client (server/rtsp.mjs) → Matroska on stdin instead of ffmpeg's RTSP input
  let rtp = null;
  if (own) { try { rtp = await startOwnRtp(url, { transport: own }); } catch (e) { return { ages: [], err: e.message }; } }
  const a = [...q, ...(rtp ? rtp.inputArgs : [...input, '-nostdin', '-i', url]), '-map', '0:v:0', '-an', '-vf', vf, ...raw];
  const p = spawn(ffmpeg, a, { stdio: [rtp ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  if (rtp) { rtp.attach(p.stdin); p.on('close', () => rtp.stop()); }
  const size = width * height * 4, ages = [];
  let buf = Buffer.alloc(0), t0 = 0, err = '';
  p.stderr.on('data', (d) => { err += d; });
  p.stdout.on('data', (c) => {
    buf = buf.length ? Buffer.concat([buf, c]) : c;
    while (buf.length >= size) {
      const now = Date.now();
      const st = readStamp(new Uint8Array(buf.buffer, buf.byteOffset, size), width, height, 255);
      buf = buf.subarray(size);
      if (!st) continue;
      if (!t0) t0 = now;
      if (now - t0 > 1000) ages.push(stampAge(st.ms, now));
    }
  });
  return new Promise((ok) => {
    setTimeout(() => p.kill('SIGKILL'), seconds * 1000 + 3000);
    p.on('close', () => ok({ ages, err: err.trim().split('\n').slice(-2).join(' ') }));
  });
}

export function summarise(v) {
  if (!v.length) return null;
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length);
  const sorted = [...v].sort((a, b) => a - b);
  return { n: v.length, mean, sd, min: sorted[0], p50: sorted[Math.floor(v.length / 2)], max: sorted[v.length - 1] };
}

// Input options of the bridge (server/index.mjs inputArgs)
const BRIDGE = ['-fflags', 'nobuffer', '-flags', 'low_delay', '-analyzeduration', '1000000', '-probesize', '2000000', '-rtsp_transport', 'tcp', '-reorder_queue_size', '0', '-max_delay', '0'];
const PLAIN = ['-rtsp_transport', 'tcp'];

const ENC1 = ['-threads', '1']; // rawvideo encoder without frame threads (server/index.mjs ffmpegArgs)
export const VARIANTS = {
  'ffmpeg-default': { input: PLAIN },
  'bridge-before': { input: BRIDGE },
  'bridge': { input: BRIDGE, output: ENC1 },
  'own-rtp-tcp': { own: 'tcp', output: ENC1 },
  'own-rtp-udp': { own: 'udp', output: ENC1 },
  'bridge+dec-threads1': { input: [...BRIDGE, '-threads', '1'], output: ENC1 },
  'bridge+udp': { input: BRIDGE.map((x) => (x === 'tcp' ? 'udp' : x)), output: ENC1 },
  'bridge+showinfo': { input: BRIDGE, vf: 'showinfo=checksum=0,scale=960:540:flags=area', output: ENC1 },
  'bridge+640': { input: BRIDGE, vf: 'scale=640:360:flags=area', width: 640, height: 360, output: ENC1 },
  'bridge+fast_bilinear': { input: BRIDGE, vf: 'scale=960:540:flags=fast_bilinear', output: ENC1 },
  'bridge+videotoolbox': { input: ['-hwaccel', 'videotoolbox', ...BRIDGE], output: ENC1 },
  'bridge+probe32': { input: [...BRIDGE.slice(0, 4), '-analyzeduration', '0', '-probesize', '32', ...BRIDGE.slice(8)], output: ENC1 },
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const seconds = Number(opt('seconds', 8)), runs = Number(opt('runs', 3)), fps = Number(opt('fps', 25));
  const [w, h] = opt('size', '1280x720').split('x').map(Number);
  const ffmpeg = process.env.FFMPEG ?? 'ffmpeg';
  const only = opt('only', '')?.split(',').filter(Boolean);
  const names = Object.keys(VARIANTS).filter((n) => !only?.length || only.includes(n));
  const mtx = await startMediamtx(process.env.MEDIAMTX ?? 'mediamtx');
  const url = `rtsp://127.0.0.1:${mtx.rtsp}/bench`;
  const src = startLatencySource(url, { width: w, height: h, fps, ffmpeg, codec: opt('codec', 'h264'), bframes: Number(opt('bframes', 0)) });
  await sleep(2000);
  const all = Object.fromEntries(names.map((n) => [n, []]));
  const perRun = Object.fromEntries(names.map((n) => [n, []]));
  try {
    for (let r = 0; r < runs; r++) {
      for (const n of names) {
        const res = await pull(ffmpeg, url, { ...VARIANTS[n], seconds });
        if (!res.ages.length) console.error(`${n}: keine gestempelten Bilder ${res.err}`);
        all[n].push(...res.ages);
        perRun[n].push(summarise(res.ages)?.mean ?? NaN);
      }
    }
  } finally { src.stop(); mtx.stop(); }
  const f = (x) => (Number.isFinite(x) ? x.toFixed(0) : '–');
  console.log(`\n${w}×${h} @ ${fps} fps, ${opt('codec', 'h264')}, B-frames ${opt('bframes', 0)}, ${runs} × ${seconds} s, stamp → out of ffmpeg (ms)\n`);
  console.log('| variant | mean | sd | min | p50 | max | run means | frames |\n|---|---|---|---|---|---|---|---|');
  for (const n of names) {
    const s = summarise(all[n]);
    console.log(`| ${n} | ${f(s?.mean)} | ${f(s?.sd)} | ${f(s?.min)} | ${f(s?.p50)} | ${f(s?.max)} | ${perRun[n].map(f).join(' / ')} | ${s?.n ?? 0} |`);
  }
}
