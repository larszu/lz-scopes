import { describe, expect, it } from 'vitest';
import { deltaRows, ghostChannels, hasGhost, histOf, levelDeltas, sanitizeRef, signedPct, traceLevels } from '../src/ghost';

const KR = 0.2126, KB = 0.0722;
/** Deterministic pseudo-random numbers (mulberry32). */
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Synthetic camera picture: a grey ramp 5…85 % plus a white patch, with a little noise. */
function picture(w = 160, h = 90, f = (rgb: number[]) => rgb, seed = 1) {
  const r = rng(seed), out: number[][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = x > w * 0.9 && y < h * 0.3 ? 0.95 : 0.05 + 0.8 * (x / w);
    const n = () => (r() - 0.5) * 0.004;
    out.push(f([v + n(), v + n(), v + n()]));
  }
  return out;
}

describe('reference camera levels', () => {
  it('a known pedestal offset shows up as the same Δ in black, median and highlight of every channel', () => {
    const ref = traceLevels(picture(), KR, KB)!;
    const cur = traceLevels(picture(undefined, undefined, ([r, g, b]) => [r + 0.03, g + 0.03, b + 0.03], 2), KR, KB)!;
    const d = levelDeltas(cur, ref);
    for (const c of ['Y', 'R', 'G', 'B'] as const) {
      expect(d[c].black).toBeCloseTo(0.03, 2);
      expect(d[c].median).toBeCloseTo(0.03, 2);
      expect(d[c].peak).toBeCloseTo(0.03, 2);
    }
  });

  it('a red gain error moves R′ in proportion to the level and leaves G′/B′ alone', () => {
    const ref = traceLevels(picture(), KR, KB)!;
    const cur = traceLevels(picture(undefined, undefined, ([r, g, b]) => [r * 1.1, g, b]), KR, KB)!;
    const d = levelDeltas(cur, ref);
    // black ≈ 5 %, median ≈ 45 %, highlight ≈ 95 % → +0.5 / +4.5 / +9.5 points
    expect(d.R.black).toBeCloseTo(0.005, 2);
    expect(d.R.median).toBeCloseTo(0.045, 2);
    expect(d.R.peak).toBeCloseTo(0.095, 2);
    for (const c of ['G', 'B'] as const) for (const k of ['black', 'median', 'peak'] as const) expect(Math.abs(d[c][k])).toBeLessThan(1e-9);
    expect(d.Y.peak).toBeCloseTo(0.095 * KR, 3);
  });

  it('single hot or dead pixels do not move black or highlight (mean of the outer 1 %)', () => {
    const base = picture();
    const ref = traceLevels(base, KR, KB)!;
    const spoiled = base.map((v, i) => (i === 10 ? [0, 0, 0] : i === 20 ? [1.09, 1.09, 1.09] : v));
    const d = levelDeltas(traceLevels(spoiled, KR, KB)!, ref);
    expect(Math.abs(d.Y.black)).toBeLessThan(0.001);
    expect(Math.abs(d.Y.peak)).toBeLessThan(0.002);
  });

  it('too few samples give no levels', () => {
    expect(traceLevels([[0, 0, 0]], KR, KB)).toBeNull();
  });
});

describe('Δ box and settings', () => {
  it('formats signed percentage points', () => {
    expect(signedPct(0.0312)).toBe('+3.1');
    expect(signedPct(-0.004)).toBe('−0.4');
    expect(signedPct(0)).toBe('+0.0');
  });
  it('lists only Y′ for luma waveforms, all channels elsewhere', () => {
    const z = { black: 0, median: 0, peak: 0 };
    const d = { Y: z, R: z, G: z, B: z };
    expect(deltaRows(d, ghostChannels('wf-luma'), { black: 'b', median: 'm', peak: 'p' })).toHaveLength(2);
    expect(deltaRows(d, ghostChannels('parade'), { black: 'b', median: 'm', peak: 'p' })).toHaveLength(5);
    expect(hasGhost('vector') && hasGhost('diamond') && hasGhost('hist') && !hasGhost('cie')).toBe(true);
  });
  it('clamps stored settings', () => {
    expect(sanitizeRef({ opacity: 7 }).opacity).toBe(1);
    expect(sanitizeRef({ mode: 'x' as never }).mode).toBe('live');
    expect(sanitizeRef(undefined)).toEqual({ sourceId: '', mode: 'live', opacity: 0.6 });
  });
  it('reference histogram bins like the statistics', () => {
    const h = histOf([[0, 0, 0], [1, 1, 1], [0.5, 0.5, 0.5]], KR, KB);
    expect(h[0][0]).toBe(1); expect(h[0][255]).toBe(1); expect(h[3][128]).toBe(1);
  });
});
