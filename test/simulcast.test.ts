import { describe, expect, it } from 'vitest';
import { deltaEITP } from '../src/color';
import { compileChain } from '../src/chain';
import type { Source } from '../src/sources';
import { rgbDecoder } from '../src/ycbcr';
import { deviationColour, simulcastMap, stageIctcp } from '../src/simulcast';

describe('simulcast map: ΔE ITP after ITU-R BT.2124', () => {
  it('Annex 4: 58 % PQ BT.709 blue [296, 201, 582] → ITP [0.3554, 0.1346, −0.1613]', () => {
    const ic = stageIctcp([296 / 1023, 201 / 1023, 582 / 1023], { transfer: 'pq', gamut: '2020', lw: 1000 });
    expect(ic[0]).toBeCloseTo(0.3554, 3);
    expect(ic[1] / 2).toBeCloseTo(0.1346, 3); // T = 0.5 · Ct
    expect(ic[2]).toBeCloseTo(-0.1613, 3);
    // Annex 4 §2: against the measured ITP [0.3568, 0.1321, −0.1629] → 2.363
    expect(deltaEITP([0.3554, 0.1346 * 2, -0.1613], [0.3568, 0.1321 * 2, -0.1629])).toBeCloseTo(2.363, 3);
  });
  it('SDR 100 % white and HDR reference white (58 % PQ ≈ 203 cd/m²) are the same light', () => {
    const sdr = stageIctcp([1, 1, 1], { transfer: 'sdr', gamut: '709', lw: 1000 });
    const pq = stageIctcp([0.5807, 0.5807, 0.5807], { transfer: 'pq', gamut: '2020', lw: 1000 });
    expect(deltaEITP(sdr, pq)).toBeLessThan(1);
  });
});

/** Fake PQ/BT.2020 source with a CST to SDR Rec.709 (tone mapping clip at reference white). */
function pqSource(tonemap: 'clip' | 'bt2390'): Source {
  return { settings: { chain: { cst: { on: true, gamut: '709', transfer: 'sdr', tonemap } } }, transfer: 'pq', gamut: '2020', hlgLw: 1000, colorspace: '2020' } as unknown as Source;
}

/** A PQ grey ramp 0 … 1000 cd/m² (left → right), RGBA 8 bit. */
function ramp(w = 64, h = 8) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = Math.round(((x + 0.5) / w) * 0.7518 * 255); // 0.7518 PQ ≈ 1000 cd/m²
    px.set([v, v, v, 255], (y * w + x) * 4);
  }
  return { px, w, h, decode: rgbDecoder(255) };
}

describe('simulcast map on a synthetic HDR ramp', () => {
  const src = pqSource('clip');
  const A = compileChain(src, 'signal'), B = compileChain(src, 'cst');
  const sp = (c: typeof A) => ({ apply: c.apply, space: { transfer: c.view.transfer, gamut: c.view.gamut, lw: c.view.lw } });
  it('the same stage on both sides: 0 everywhere', () => {
    const m = simulcastMap(ramp(), sp(A), sp(A), { cells: 64 * 8 });
    expect(m.stats.max).toBeLessThan(1e-9);
  });
  it('clip to SDR: below reference white not noticeable, above it the highlights deviate', () => {
    const m = simulcastMap(ramp(), sp(A), sp(B), { cells: 64 * 8 });
    expect(m.w).toBe(64);
    // left third ≈ 0 … 30 cd/m² well under 203, right end ≈ 1000 cd/m² clipped to 203
    expect(m.d[5]).toBeLessThan(1);
    expect(m.d[63]).toBeGreaterThan(20);
    expect(m.stats.overJnd).toBeGreaterThan(0.1);
    expect(m.stats.overJnd).toBeLessThan(0.9);
    expect(m.stats.p95).toBeGreaterThan(m.stats.mean);
  });
  it('colours: ≤ 1 transparent, above the scale white', () => {
    expect(deviationColour(0.5, 10)[3]).toBe(0);
    expect(deviationColour(20, 10)).toEqual([255, 255, 255, 230]);
    expect(deviationColour(3, 10)[3]).toBeGreaterThan(0);
  });
});
