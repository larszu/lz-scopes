#!/usr/bin/env node
// Checks the simulator consoles of the iOS workflow for RTSP direct (#90): every console must
// show both auto streams (RTSP 1 = H.264 via WebCodecs, RTSP 2 = HEVC via VideoToolbox) live in
// the WebView with at least 25 frames, and the middle of the 75 % white bar of the SMPTE bars
// (RP 219) at R′G′B′ ≈ 191 – i.e. decoded and converted with the right matrix and range.
// Lines come from openAutoStreams() in src/native/ios.ts.
// Usage: node scripts/ios-rtsp-check.mjs ios-shots/*-console.txt

import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) { console.error('no console files'); process.exit(1); }
let failed = false;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const name of ['RTSP 1', 'RTSP 2']) {
    const re = new RegExp(`rtsp-direct frames: ${name} (\\w+) n=(\\d+) (\\d+)x(\\d+)(?: bar75=(\\d+),(\\d+),(\\d+))?`, 'g');
    const lines = [...text.matchAll(re)];
    const best = lines.map((m) => ({ status: m[1], n: Number(m[2]), size: `${m[3]}x${m[4]}`, bar: m[5] ? [m[5], m[6], m[7]].map(Number) : null }))
      .filter((x) => x.status === 'live').sort((a, b) => b.n - a.n)[0];
    const ok = !!best && best.n >= 25 && !!best.bar && best.bar.every((v) => Math.abs(v - 191) <= 8);
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${f} · ${name}: ${best ? `${best.status} n=${best.n} ${best.size} bar75=${best.bar?.join(',') ?? '–'}` : 'no live line'}`);
    if (!ok) failed = true;
  }
  for (const l of text.split('\n').filter((x) => /rtsp-direct: (live|error)/.test(x))) console.log(`     ${l.trim()}`);
}
process.exit(failed ? 1 : 0);
