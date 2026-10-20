import { describe, expect, it } from 'vitest';
import { foldFrequency, gridFrequencyAt, matchesAlias, measureMoire, riskOf, simulateGrid, wallGridFrequency } from '../src/led/moire';
import { homography } from '../src/led/analysis';
import type { WallConfig } from '../src/led/wall';

describe('moiré meter: sampling (Imatest Nyquist/aliasing)', () => {
  it('3/2 Nyquist (0.75 cycles/px) is recorded at 0.25 cycles/px', () => {
    const a = foldFrequency([0.75, 0]);
    expect(Math.abs(a[0])).toBeCloseTo(0.25, 9);
  });
  it('risk classes: Nyquist 0.5, Bayer red/blue 0.25', () => {
    expect(riskOf(0.6)).toBe('alias');
    expect(riskOf(0.3)).toBe('colour');
    expect(riskOf(0.2)).toBe('resolved');
  });
});

describe('moiré meter: geometry from the homography', () => {
  it('100 wall px over 110 picture px = 0.909 cycles/px, alias period 11 px', () => {
    const H = homography([[0, 0], [100, 0], [100, 100], [0, 100]], [[10, 10], [120, 10], [120, 120], [10, 120]]);
    const g = gridFrequencyAt(H, 50, 50);
    expect(g.fCol).toBeCloseTo(100 / 110, 6);
    expect(g.risk).toBe('alias');
    expect(g.aliasPeriod).toBeCloseTo(11, 4);
  });
  it('a recording wider than the analysis picture lowers the frequency per recorded pixel', () => {
    const H = homography([[0, 0], [100, 0], [100, 100], [0, 100]], [[0, 0], [100, 0], [100, 100], [0, 100]]);
    expect(gridFrequencyAt(H, 50, 50, 0.25).f).toBeCloseTo(0.25, 6); // analysis 960 of a 3840 recording
  });
  it('perspective: the far side of the wall decides', () => {
    const wall = { cabW: 100, cabH: 100, cols: 2, rows: 1 } as WallConfig;
    const r = wallGridFrequency(wall, [[0, 0], [400, 60], [400, 140], [0, 200]]);
    expect(r.worst.f).toBeGreaterThan(r.centre.f);
  });
});

describe('moiré meter: 2D FFT of a synthetic camera picture', () => {
  it('finds the alias of an LED grid at 1.1 px pitch (0.909 → 0.091 cycles/px)', () => {
    const f = simulateGrid({ width: 256, height: 256, pitch: 1.1 });
    const m = measureMoire(f, 128, 128, 256);
    expect(m.size).toBe(256);
    expect(m.luma.f).toBeCloseTo(1 - 1 / 1.1, 2);
    expect(m.luma.pct).toBeGreaterThan(1);
    expect(matchesAlias(m.luma, foldFrequency([1 / 1.1, 0]), 2 / 256)).toBe(true);
  });
  it('a rotated grid aliases into a rotated pattern', () => {
    const ang = (5 * Math.PI) / 180, p = 1.05;
    const f = simulateGrid({ width: 256, height: 256, pitch: p, angle: ang });
    const m = measureMoire(f, 128, 128, 256);
    const a = foldFrequency([Math.cos(ang) / p, Math.sin(ang) / p]);
    const b = foldFrequency([-Math.sin(ang) / p, Math.cos(ang) / p]);
    expect(matchesAlias(m.luma, a, 2 / 256) || matchesAlias(m.luma, b, 2 / 256)).toBe(true);
  });
  it('a resolved grid (pitch 6 px) shows its own frequency, a flat field almost nothing', () => {
    const m = measureMoire(simulateGrid({ width: 128, height: 128, pitch: 6 }), 64, 64, 128);
    expect(m.luma.f).toBeCloseTo(1 / 6, 1);
    const flat = simulateGrid({ width: 128, height: 128, pitch: 1, blur: 1 });
    expect(measureMoire(flat, 64, 64, 128).luma.pct).toBeLessThan(1e-6);
  });
  it('colour moiré shows in R−B', () => {
    const f = simulateGrid({ width: 128, height: 128, pitch: 1.1, rgb: [1, 0.5, 0] });
    expect(measureMoire(f, 64, 64, 128).chroma.pct).toBeGreaterThan(1);
  });
});
