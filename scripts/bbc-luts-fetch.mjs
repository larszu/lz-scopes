#!/usr/bin/env node
// Holt die Type-I-Primär-LUTs der BBC (bbc/bbc_hdr_television_production_luts, Apache 2.0) nach
// vendor/luts/bbc/. Je Datei rund 1 MB (33³); sie bleiben außerhalb des Repos.
// Mit --fixture schreibt das Skript außerdem die Stichprobe test/fixtures/bbc-luts/*.json:
// jeder vierte Gitterpunkt (9³ Knoten) von LUT 1a und 7a, Werte unverändert aus der Datei.
// BBC_LUT_DIR=<Ordner> legt die Dateien woanders ab.
// Stand fest auf einem Commit, damit Test und App dieselben Dateien meinen (src/lutLibrary.ts).

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.BBC_LUT_DIR ? resolve(process.env.BBC_LUT_DIR) : join(root, 'vendor', 'luts', 'bbc');
const COMMIT = 'dd2744578d64f1a0d0b9f2eb58276ffa10cc4895';
const DIR = 'LUT_files/CUBE_LUT_files/BBC_LUT_Release_v1-8_Grouped_2026-09-16/Primary_Conversions_Post-Production_Type_I_Nominal_Range';
const base = `https://raw.githubusercontent.com/bbc/bbc_hdr_television_production_luts/${COMMIT}/${DIR}`;
const files = [
  '1a_PQ1000_HLG_Type1_Transcode_nocomp-v1-8-cicp.cube',
  '2a_PQ4000_HLG_Type1_Transcode_nocomp-v1-8-cicp.cube',
  '3a_BT709_HLG_Type1_Display_DirectMapping_nocomp-v1-8-cicp.cube',
  '5a_BT709_HLG_Type1_Display_UpMapping_nocomp-v1-8-cicp.cube',
  '7a_HLG_PQ1000_Type1_Transcode_nocomp-v1-8-cicp.cube',
  '8a_HLG_BT709_Type1_Display_DownMapping_CAM_nocomp-v1-8-cicp.cube',
];
const FIXTURE = { '1a': files[0], '7a': files[4] };
const STEP = 4;

mkdirSync(out, { recursive: true });
let n = 0;
for (const f of files) {
  const target = join(out, f);
  if (existsSync(target)) { console.log(`vorhanden: ${f}`); continue; }
  const r = await fetch(`${base}/${f}`);
  if (!r.ok) { console.warn(`nicht geladen: ${f} (${r.status})`); continue; }
  writeFileSync(target, Buffer.from(await r.arrayBuffer()));
  console.log(`geladen: ${f}`);
  n++;
}
console.log(`${n} neu in vendor/luts/bbc/ (BBC, Apache 2.0, Commit ${COMMIT.slice(0, 7)})`);

if (process.argv.includes('--fixture')) {
  const fx = join(root, 'test', 'fixtures', 'bbc-luts');
  mkdirSync(fx, { recursive: true });
  for (const [id, f] of Object.entries(FIXTURE)) {
    const text = readFileSync(join(out, f), 'utf8');
    const size = Number(/^LUT_3D_SIZE\s+(\d+)/m.exec(text)?.[1]);
    // data rows: three numbers, red fastest (Adobe Cube spec)
    const rows = text.split(/\r?\n/).filter((l) => /^\s*-?[\d.]+(e-?\d+)?\s+-?[\d.]+(e-?\d+)?\s+-?[\d.]+(e-?\d+)?\s*$/i.test(l));
    if (rows.length !== size ** 3) throw new Error(`${f}: ${rows.length} Zeilen statt ${size ** 3}`);
    const nodes = [];
    for (let b = 0; b < size; b += STEP) for (let g = 0; g < size; g += STEP) for (let r = 0; r < size; r += STEP) {
      nodes.push([r, g, b, ...rows[r + g * size + b * size * size].trim().split(/\s+/).map(Number)]);
    }
    writeFileSync(join(fx, `${id}.json`), JSON.stringify({
      source: `https://github.com/bbc/bbc_hdr_television_production_luts/blob/${COMMIT}/${DIR}/${f}`,
      licence: 'Apache-2.0, © British Broadcasting Corporation (BBC) MMXXVI; see LICENSE in this folder',
      note: `every ${STEP}th grid node of the ${size}³ cube; [r, g, b index, R', G', B' output] as in the file`,
      size, nodes,
    }) + '\n');
    console.log(`Stichprobe: test/fixtures/bbc-luts/${id}.json (${nodes.length} Knoten)`);
  }
}
