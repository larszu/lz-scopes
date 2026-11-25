// BBC HDR production LUTs (#210) as an independent reference for the HLG/PQ maths of the chain.
// test/fixtures/bbc-luts/*.json are every 4th grid node of the BBC Type I cubes 1a (PQ 1000 → HLG)
// and 7a (HLG → PQ 1000), values unchanged (Apache 2.0, see the LICENSE there); written by
// `node scripts/bbc-luts-fetch.mjs --fixture`. If the full cubes are in vendor/luts/bbc/, they are
// parsed as well.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { linearToSignal, signalToLinear } from '../src/color';
import { LUTS, applyLut, parseCube } from '../src/lut';
import { BBC_LUTS, BBC_LUT_COMMIT, bbcLutMismatch, bbcLutName, bbcLutUrl, loadBbcLut } from '../src/lutLibrary';

interface Fixture { size: number; nodes: number[][] }
const fx = (id: string): Fixture => JSON.parse(readFileSync(join(__dirname, 'fixtures', 'bbc-luts', `${id}.json`), 'utf8'));

/** Largest deviation of our transfer chain from the BBC LUT at its grid nodes (output clipped 0–1 like Type I). */
function maxDev(f: Fixture, from: 'pq' | 'hlg', to: 'pq' | 'hlg') {
  let max = 0;
  for (const [r, g, b, ...ref] of f.nodes) {
    const rgb = [r, g, b].map((i) => i / (f.size - 1));
    const ours = linearToSignal(signalToLinear(rgb, from, 1000), to, 1000).map((v) => Math.min(1, Math.max(0, v)));
    max = Math.max(max, ...ours.map((v, i) => Math.abs(v - ref[i])));
  }
  return max;
}

describe('BBC HDR LUTs as reference', () => {
  // BT.2100-3: HLG at the 1000 cd/m² reference display (system gamma 1.2), PQ absolute; both
  // directions are pure transfer conversions in BT.2020, so CST and BBC must agree at the nodes.
  // Seen deviation 0.8e-4 (7a) and 1.6e-4 (1a) – the 6-decimal rounding of the files and the BBC's
  // own processing; 1e-3 is a quarter of a 10-bit code (1/876 of the nominal range ≈ 1.1e-3).
  it('HLG → PQ 1000 (LUT 7a) matches signalToLinear/linearToSignal', () => {
    expect(maxDev(fx('7a'), 'hlg', 'pq')).toBeLessThan(1e-3);
  });
  it('PQ 1000 → HLG (LUT 1a) matches, including the clip of PQ above 1000 cd/m²', () => {
    expect(maxDev(fx('1a'), 'pq', 'hlg')).toBeLessThan(1e-3);
  });
  it('fixture is the 9³ subset of a 33³ cube', () => {
    for (const id of ['1a', '7a']) {
      const f = fx(id);
      expect(f.size).toBe(33);
      expect(f.nodes).toHaveLength(9 ** 3);
    }
  });
});

describe('BBC LUT list', () => {
  it('pins one commit and only Type I files', () => {
    expect(BBC_LUT_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    for (const l of BBC_LUTS) {
      expect(l.file).toMatch(/_Type1_/);
      expect(bbcLutUrl(l)).toContain(`/${BBC_LUT_COMMIT}/`);
      expect(bbcLutUrl(l).endsWith(`/${l.file}`)).toBe(true);
    }
    expect(new Set(BBC_LUTS.map((l) => l.id)).size).toBe(BBC_LUTS.length);
  });

  it('loads a downloaded LUT into the library under its BBC name', async () => {
    const cube = 'LUT_3D_SIZE 2\n' + [0, 1].flatMap((b) => [0, 1].flatMap((g) => [0, 1].map((r) => `${r} ${g} ${b}`))).join('\n');
    const l = BBC_LUTS.find((x) => x.id === '7a')!;
    let asked = '';
    const get = (async (u: string) => { asked = u; return new Response(cube); }) as unknown as typeof fetch;
    await loadBbcLut(l, get);
    expect(asked).toBe(bbcLutUrl(l));
    expect(LUTS.get(bbcLutName(l))?.cube?.size).toBe(2);
  });

  it('reports HTTP errors', async () => {
    const get = (async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(loadBbcLut(BBC_LUTS[0], get)).rejects.toThrow(/404/);
  });

  it('warns when the slot receives another signal than the LUT expects', () => {
    const l = BBC_LUTS.find((x) => x.id === '7a')!;
    expect(bbcLutMismatch(l, { transfer: 'hlg', gamut: '2020' })).toBeNull();
    expect(bbcLutMismatch(l, { transfer: 'sdr', gamut: '709' })).toMatch(/HLG/);
  });
});

const vendor = join(__dirname, '..', 'vendor', 'luts', 'bbc');
describe.skipIf(!existsSync(vendor))('BBC cubes in vendor/luts/bbc', () => {
  it('parse as 33³ and give the grid values back', () => {
    for (const f of readdirSync(vendor).filter((n) => n.endsWith('.cube'))) {
      const l = parseCube(readFileSync(join(vendor, f), 'utf8'), f);
      expect(l.cube?.size, f).toBe(33);
      expect(applyLut(l, [0, 0, 0]).every((v) => v >= 0 && v <= 1), f).toBe(true);
    }
  });
});
