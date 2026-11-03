#!/usr/bin/env node
// Stand-in for lz-decklink with a live signal (e2e, no hardware): --list reports one UltraStudio,
// --capture sends 1080p25 v210 grey with FPTS/TIME and, with --audio n, n channels of a 1 kHz tone
// at −20 dBFS on channel 1 (others silent), like an SDI camera with embedded sound, plus RP 188 timecode
// and the VANC packets an UltraStudio Recorder 3G captured from a camera (decklink-vanc-recorder3g.json,
// 4 times a second). Runs until killed.
const args = process.argv.slice(2);
if (args[0] === '--list') {
  process.stdout.write(`${JSON.stringify({ ok: true, devices: [{ index: 0, name: 'Fake UltraStudio Recorder 3G', formatDetection: true, capture: true, inputs: ['sdi', 'hdmi'], input: 'sdi' }] })}\n`);
  process.exit(0);
}
const ai = args.indexOf('--audio'), ch = ai > 0 ? [16, 8, 2].find((c) => c <= Number(args[ai + 1])) ?? 0 : 0;
import { readFileSync } from 'node:fs';
const vanc = JSON.parse(readFileSync(new URL('./decklink-vanc-recorder3g.json', import.meta.url), 'utf8'));
const rec = (tag, body) => {
  const b = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  const h = Buffer.alloc(8); h.write(tag.padEnd(4, ' '), 0, 'ascii'); h.writeUInt32LE(b.length, 4);
  process.stdout.write(Buffer.concat([h, b]));
};
const w = 1920, h = 1080, row = Math.ceil(w / 48) * 128, frame = Buffer.alloc(row * h);
const words = [512 | (502 << 10) | (512 << 20), 502 | (512 << 10) | (502 << 20), 512 | (502 << 10) | (512 << 20), 502 | (512 << 10) | (502 << 20)];
for (let i = 0; i < frame.length; i += 4) frame.writeUInt32LE(words[(i / 4) % 4] >>> 0, i);
rec('INFO', { width: w, height: h, fpsNum: 25000, fpsDen: 1000, pixel: 'v210', matrix: 'bt709', range: 'tv', transfer: 'unknown', primaries: 'bt709', interlaced: false, name: '1080p25', ...(ch ? { audio: { sampleRate: 48000, channels: ch, format: 's32le' } } : {}) });
let k = 0;
const t0 = Date.now();
const tick = () => {
  const t = k * 1920;
  if (ch) {
    const b = Buffer.alloc(8 + 1920 * ch * 4);
    b.writeBigInt64LE(BigInt(t), 0);
    for (let i = 0; i < 1920; i++) b.writeInt32LE(Math.round(Math.sin((2 * Math.PI * 1000 * (t + i)) / 48000) * 0.1 * 2147483647), 8 + i * ch * 4);
    rec('AUDI', b);
  }
  const f = k % 25, sec = Math.floor(k / 25);
  rec('TIME', { tc: `10:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}:${String(f).padStart(2, '0')}`, df: false });
  if (k % 6 === 0) rec('VANC', vanc);
  const p = Buffer.alloc(8); p.writeBigInt64LE(BigInt(t)); rec('FPTS', p);
  rec('FRAM', frame);
  k++;
  setTimeout(tick, Math.max(0, t0 + k * 40 - Date.now()));
};
tick();
process.stdout.on('error', () => process.exit(0));
