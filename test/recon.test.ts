import { describe, expect, it } from 'vitest';
import { lanczos3, reconstructRow, RECON_FACTOR } from '../src/recon';

describe('waveform Flat reconstructed (#257)', () => {
  it('Lanczos-3: 1 at 0, zero at the other integers and outside ±3', () => {
    expect(lanczos3(0)).toBe(1);
    for (const k of [1, 2, -1, -2]) expect(Math.abs(lanczos3(k))).toBeLessThan(1e-12);
    expect(lanczos3(3)).toBe(0);
    expect(lanczos3(4.2)).toBe(0);
  });

  it('a hard edge 0 → 100 % overshoots by about 9–11 % (Gibbs), a flat area stays exact', () => {
    const row = [...Array(16).fill(0), ...Array(16).fill(1)];
    const r = reconstructRow(row);
    expect(r).toHaveLength(row.length * RECON_FACTOR);
    const over = Math.max(...r) - 1, under = -Math.min(...r);
    // ideal sin(x)/x: 8.95 % Gibbs at a band-limited edge; a hard sampled step on the 4× grid: 11.1 %
    expect(over).toBeGreaterThan(0.08);
    expect(over).toBeLessThan(0.12);
    expect(under).toBeCloseTo(over, 6);
    // the samples themselves come back unchanged
    for (let i = 0; i < row.length; i++) expect(r[i * RECON_FACTOR]).toBe(row[i]);
    const flat = reconstructRow(Array(20).fill(0.42));
    for (const v of flat) expect(v).toBeCloseTo(0.42, 12);
  });
});
