#!/usr/bin/env node
// Holt die großen LUT-Dateien der OCIO-Sammlung von djieff/prism (MIT) nach vendor/luts/.
// Die kleinen liegen in test/fixtures/luts/ im Repo; diese hier sind je 1–7 MB und bleiben
// draußen. test/lutfiles.test.ts nimmt sie mit, sobald sie da sind, und kommt ohne sie aus.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'vendor', 'luts');
const base = 'https://raw.githubusercontent.com/djieff/prism/main/samples/LUTs';
const files = [
  'formats/csp/aces2065_to_acescg_33.csp',
  '3D/colorspace/aces2065_to_acescg_65.cube',
  '3D/display_view/acescg_to_displayp3_view.spi3d',
  '3D/channel_separation/cdl_slope_power_skew_33.cube',
  '3D/display_view/acescg_to_srgb_displayview_33.cube',
];

mkdirSync(out, { recursive: true });
let n = 0;
for (const f of files) {
  const name = f.split('/').pop();
  const target = join(out, name);
  if (existsSync(target)) { console.log(`vorhanden: ${name}`); continue; }
  const r = await fetch(`${base}/${f}`);
  if (!r.ok) { console.warn(`nicht geladen: ${f} (${r.status})`); continue; }
  writeFileSync(target, Buffer.from(await r.arrayBuffer()));
  console.log(`geladen: ${name}`);
  n++;
}
console.log(`${n} neu in vendor/luts/ (djieff/prism, MIT)`);
