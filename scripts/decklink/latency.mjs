#!/usr/bin/env node
// Where does the time go between the DeckLink helper and the browser? (#116)
//   node scripts/decklink/latency.mjs [--index 0] [--seconds 6] [--width 960] [--depth 16] [--bare] [-- <extra ffmpeg args before -i>]
// --bare leaves out the bridge's input flags (HELPER_INPUT_FLAGS) to compare against plain ffmpeg.
// Runs lz-decklink --capture and the same ffmpeg conversion as server/helper-input.mjs, and reports
// per stage: process start → first FRAM, FRAM interval, and ffmpeg latency (frame written → frame out).
import { spawn } from 'node:child_process';
import { HELPER_INPUT_FLAGS, helperFormat, helperPath, HelperRecordParser } from '../../server/helper-input.mjs';
import { ffmpegCandidates } from '../../server/ffmpeg.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const index = arg('index', '0'), seconds = Number(arg('seconds', '6')), width = Number(arg('width', '960')), depth = Number(arg('depth', '16'));
const dd = process.argv.indexOf('--');
const extra = [...(process.argv.includes('--bare') ? [] : HELPER_INPUT_FLAGS), ...(dd > 0 ? process.argv.slice(dd + 1) : [])];
const t0 = performance.now();
const helper = spawn(helperPath('lz-decklink'), ['--capture', index, '--audio', '0'], { stdio: ['ignore', 'pipe', 'inherit'] });
const ffmpeg = ffmpegCandidates()[0];
let ff = null, outBytes = 0, got = 0, firstFram = null, lastFram = null, firstOut = null;
const intervals = [], lat = [], written = [];
const parser = new HelperRecordParser((tag, p) => {
  const now = performance.now();
  if (tag === 'INFO') {
    const info = JSON.parse(p.toString()); const f = helperFormat(info);
    const h = Math.round((width * f.height) / f.width / 2) * 2;
    outBytes = width * h * 4 * (depth / 8);
    ff?.kill('SIGKILL');
    ff = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...extra, ...f.input, '-map', '0:v:0', '-vf', `scale=${width}:${h}:flags=area:in_color_matrix=bt709:in_range=limited`, '-pix_fmt', depth === 16 ? 'rgba64le' : 'rgba', '-threads', '1', '-f', 'rawvideo', 'pipe:1'], { stdio: ['pipe', 'pipe', 'inherit'] });
    ff.stdout.on('data', (d) => {
      got += d.length;
      while (got >= outBytes) { got -= outBytes; const w = written.shift(); const n = performance.now(); if (w !== undefined) lat.push(n - w); if (firstOut === null) firstOut = n - t0; }
    });
  } else if (tag === 'FRAM' && ff) {
    if (firstFram === null) firstFram = now - t0;
    if (lastFram !== null) intervals.push(now - lastFram);
    lastFram = now; written.push(now); ff.stdin.write(Buffer.from(p));
  }
});
helper.stdout.on('data', (d) => parser.push(d));
const stat = (a) => { const s = [...a].sort((x, y) => x - y); const q = (f) => s[Math.min(s.length - 1, Math.floor(f * s.length))]; return s.length ? { n: s.length, min: +s[0].toFixed(1), median: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +s.at(-1).toFixed(1) } : null; };
setTimeout(() => {
  console.log(JSON.stringify({ firstFramMs: firstFram && +firstFram.toFixed(0), firstOutMs: firstOut && +firstOut.toFixed(0), framIntervalMs: stat(intervals), ffmpegLatencyMs: stat(lat.slice(5)), queued: written.length }, null, 1));
  helper.kill(); ff?.kill('SIGKILL'); process.exit(0);
}, seconds * 1000);
