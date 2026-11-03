#!/usr/bin/env node
// Hardware check for a DeckLink/UltraStudio through a running bridge (#116):
//   node scripts/decklink/probe.mjs [--bridge http://127.0.0.1:4192] [--index 0] [--input sdi|hdmi] [--seconds 6] [--bits 8|10] [--no-audio]
// Prints the device list, then streams decklink:<index> for a few seconds and reports frames/s,
// how many `info` messages arrived (more than one = the bridge restarted ffmpeg), timecode, VANC, errors and,
// with sound (frame protocol 2), samples/s, gaps in the sample index, peak level per channel and the PTS anchor.
import { WebSocket } from 'ws';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const http = arg('bridge', 'http://127.0.0.1:4192'), index = arg('index', '0'), input = arg('input', ''), seconds = Number(arg('seconds', '6')), bits = arg('bits', '10');

const st = await (await fetch(`${http}/api/decklink`)).json();
console.log('devices:', JSON.stringify(st));
const withAudio = !process.argv.includes('--no-audio');
const q = new URLSearchParams({ url: `decklink:${index}`, depth: arg('depth', '16'), ...(bits === '8' ? { pixel: '8' } : {}), ...(input ? { input } : {}), ...(withAudio ? { audio: '1' } : {}) });
const ws = new WebSocket(`${http.replace(/^http/, 'ws')}/stream?${q}`, { headers: { origin: http } });
let frames = 0, firstFrame = 0, tc = null, vanc = 0, proto = 1, channels = 0;
let samples = 0, nextIndex = null, gaps = 0, peaks = [], firstPts = null, framePts = [];
const msgs = [];
ws.on('message', (d, bin) => {
  if (bin) {
    if (proto === 2) {
      const magic = d.toString('ascii', 0, 4), count = d.readUInt32LE(4), v = d.readDoubleLE(8);
      if (magic === 'LZA1') {
        if (nextIndex !== null && v !== nextIndex) gaps++;
        nextIndex = v + count; samples += count;
        const f = new Float32Array(d.buffer.slice(d.byteOffset + 16, d.byteOffset + 16 + count * channels * 4));
        for (let i = 0; i < f.length; i++) { const c = i % channels; peaks[c] = Math.max(peaks[c] ?? 0, Math.abs(f[i])); }
        return;
      }
      if (framePts.length < 3) framePts.push(v);
    }
    if (!frames++) firstFrame = Date.now();
    return;
  }
  const m = JSON.parse(String(d));
  if (m.type === 'info') { proto = m.proto ?? 1; channels = m.audio?.channels ?? 0; }
  if (m.type === 'apts' && firstPts === null) firstPts = m;
  if (m.type === 'tc') tc = m.tc; else if (m.type === 'vanc' || m.type === 'apts') vanc += m.type === 'vanc' ? 1 : 0; else msgs.push(m);
});
const start = Date.now();
ws.on('close', () => report('closed'));
setTimeout(() => report('done'), seconds * 1000);
function report(why) {
  const info = msgs.filter((m) => m.type === 'info');
  const secs = firstFrame ? (Date.now() - firstFrame) / 1000 : 0;
  console.log(JSON.stringify({
    why, frames, fps: secs ? Math.round((frames / secs) * 10) / 10 : 0, firstFrameAfterMs: firstFrame ? firstFrame - start : null,
    infoCount: info.length, info: info[0] ?? null, lastTimecode: tc, vancMessages: vanc,
    lastStats: msgs.filter((m) => m.type === 'stats').pop() ?? null, errors: msgs.filter((m) => m.type === 'error' || m.type === 'end'),
    audio: proto === 2 ? { channels, samplesPerSecond: secs ? Math.round(samples / secs) : 0, gaps, firstAnchor: firstPts, firstFramePts: framePts,
      peakDbfs: peaks.map((p) => (p > 0 ? Math.round(20 * Math.log10(p) * 10) / 10 : null)) } : null,
  }, null, 1));
  process.exit(info.length === 1 && frames > 0 && (!withAudio || (channels > 0 && samples > 0 && gaps === 0)) ? 0 : 1);
}
