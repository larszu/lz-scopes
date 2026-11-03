#!/usr/bin/env node
// Hardware check for a DeckLink/UltraStudio through a running bridge (#116):
//   node scripts/decklink/probe.mjs [--bridge http://127.0.0.1:4192] [--index 0] [--input sdi|hdmi] [--seconds 6] [--bits 8|10]
// Prints the device list, then streams decklink:<index> for a few seconds and reports frames/s,
// how many `info` messages arrived (more than one = the bridge restarted ffmpeg), timecode, VANC and errors.
import { WebSocket } from 'ws';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const http = arg('bridge', 'http://127.0.0.1:4192'), index = arg('index', '0'), input = arg('input', ''), seconds = Number(arg('seconds', '6')), bits = arg('bits', '10');

const st = await (await fetch(`${http}/api/decklink`)).json();
console.log('devices:', JSON.stringify(st));
const q = new URLSearchParams({ url: `decklink:${index}`, depth: '16', ...(bits === '8' ? { pixel: '8' } : {}), ...(input ? { input } : {}) });
const ws = new WebSocket(`${http.replace(/^http/, 'ws')}/stream?${q}`, { headers: { origin: http } });
let frames = 0, firstFrame = 0, tc = null, vanc = 0;
const msgs = [];
ws.on('message', (d, bin) => {
  if (bin) { if (!frames++) firstFrame = Date.now(); return; }
  const m = JSON.parse(String(d));
  if (m.type === 'tc') tc = m.tc; else if (m.type === 'vanc') vanc++; else msgs.push(m);
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
  }, null, 1));
  process.exit(info.length === 1 && frames > 0 ? 0 : 1);
}
