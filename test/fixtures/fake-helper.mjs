#!/usr/bin/env node
// Stand-in for a native capture helper (DeckLink/NDI) in tests: speaks the helper
// protocol (server/helper-input.mjs) and sends flat v210 frames with a known level.
//   fake-helper.mjs --list            → one JSON line
//   fake-helper.mjs --capture <y10> <frames>   (each frame preceded by a TIME record)
//   fake-helper.mjs --psf <y10> <frames>       (as --capture, plus an INFO per frame whose mode name flips p ↔ PsF)
//   fake-helper.mjs --reference <n>            → one JSON line in the shape of lz-decklink --reference
//   fake-helper.mjs --audio                    → 5 frames with FPTS and 2-channel sound (AUDI), one sound packet missing
//   fake-helper.mjs --ndi-stats                → three lz-ndi counter records (fine, losses, fine)
const [mode, a1, a2] = process.argv.slice(2);
if (mode === '--reference') {
  process.stdout.write(`${JSON.stringify({ ok: true, index: Number(a1), name: 'Fake DeckLink 8K Pro', hasReference: true, fullFrameOffset: false, referenceLocked: true,
    referenceMode: { name: '1080i50', width: 1920, height: 1080, fpsNum: 25000, fpsDen: 1000, field: 'interlaced' }, referencePsF: false,
    inputLocked: true, inputMode: { name: '1080i50', width: 1920, height: 1080, fpsNum: 25000, fpsDen: 1000, field: 'interlaced' }, timingOffsetPixels: 12,
    outputReference: { locked: true, notSupported: false } })}\n`);
  process.exit(0);
}
if (mode === '--list') {
  process.stdout.write(`${JSON.stringify({ ok: true, devices: [{ index: 0, name: 'Fake UltraStudio', formatDetection: true }] })}\n`);
  process.exit(0);
}
const rec = (tag, body) => {
  const b = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  const h = Buffer.alloc(8); h.write(tag.padEnd(4, ' '), 0, 'ascii'); h.writeUInt32LE(b.length, 4);
  process.stdout.write(Buffer.concat([h, b]));
};
if (mode === '--vanc') {
  // one VANC record in the shape lz-decklink sends (#160): ST 352 1080p50 3G-A, PQ, Rec.2020
  rec('VANC', { packets: [{ did: 0x41, sdid: 0x01, line: 10, stream: 0, data: '89e92001' }] });
  rec('VANC', 'not json');
  setTimeout(() => process.exit(0), 100);
} else if (mode === '--audio') {
  // lz-decklink with --audio: INFO.audio, FPTS before every frame, AUDI (int64 time + s32le). The
  // third sound packet is missing (time jumps by 1920 samples): the bridge must show the gap.
  const w = 96, h = 54, row = Math.ceil(w / 48) * 128, frame = Buffer.alloc(row * h);
  rec('INFO', { width: w, height: h, fpsNum: 25, fpsDen: 1, pixel: 'v210', matrix: 'bt709', range: 'tv', name: '1080p25', audio: { sampleRate: 48000, channels: 2, format: 's32le' } });
  const audi = (t) => {
    const b = Buffer.alloc(8 + 1920 * 2 * 4);
    b.writeBigInt64LE(BigInt(t), 0);
    for (let i = 0; i < 1920; i++) { b.writeInt32LE(1 << 30, 8 + i * 8); b.writeInt32LE(-(1 << 29), 12 + i * 8); } // L +0.5, R -0.25
    rec('AUDI', b);
  };
  let k = 0;
  const t = setInterval(() => {
    if (k !== 2) audi(k * 1920);
    const pts = Buffer.alloc(8); pts.writeBigInt64LE(BigInt(k * 1920)); rec('FPTS', pts); rec('FRAM', frame);
    if (++k >= 5) { clearInterval(t); setTimeout(() => process.exit(0), 300); }
  }, 40);
} else if (mode === '--ndi-stats') {
  const st = (p) => rec('STAT', { code: 'ndi.stats', message: 'NDI counters', params: { fps: 25, received: 25, queue: 0, connections: 1, ...p } });
  st({ ndiDropped: 0, skipped: 0 }); st({ ndiDropped: 3, skipped: 2 }); st({ ndiDropped: 0, skipped: 0 });
  setTimeout(() => process.exit(0), 100);
} else {
const w = 96, h = 54, y = Number(a1 ?? 940), c = 512, n = Number(a2 ?? 3);
// v210: 6 pixels in 4 little-endian 32-bit words (Cb Y Cr | Y Cb Y | Cr Y Cb | Y Cr Y)
const words = [c | (y << 10) | (c << 20), y | (c << 10) | (y << 20), c | (y << 10) | (c << 20), y | (c << 10) | (y << 20)];
const row = Math.ceil(w / 48) * 128;
const frame = Buffer.alloc(row * h);
for (let i = 0; i < frame.length; i += 4) frame.writeUInt32LE(words[(i / 4) % 4] >>> 0, i);
const info = { width: w, height: h, fpsNum: 25, fpsDen: 1, pixel: 'v210', matrix: 'bt709', range: 'tv', name: 'Fake 1080i50', timecode: '10:00:00:00' };
rec('INFO', info);
rec('STAT', { message: 'Signal erkannt' });
let k = 0;
// --psf: the mode name flips p ↔ PsF on every frame like an UltraStudio Recorder 3G with format detection
const t = setInterval(() => { if (mode === '--psf') rec('INFO', { ...info, name: k % 2 ? '1080p25' : '1080PsF25' }); rec('TIME', { tc: `10:00:00:${String(k).padStart(2, '0')}`, df: false }); rec('FRAM', frame); if (++k >= n) { clearInterval(t); setTimeout(() => process.exit(0), 300); } }, 40);
}
