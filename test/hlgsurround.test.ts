// HLG system gamma with the surround luminance of the room (#201, ITU-R BT.2390 §6.2).
// Reference values from the EBU R 167 calculator (github.com/ebu/r167, Apache-2.0), which
// implements the same formulas; the reference environment is 5 cd/m².
import { afterEach, describe, expect, it } from 'vitest';
import { HLG_SURROUND_REF, getHlgSurround, hlgGamma, hlgNits, hlgRefWhite, setHlgSurround } from '../src/color';

afterEach(() => setHlgSurround(HLG_SURROUND_REF));

describe('HLG system gamma', () => {
  it('peak luminance alone, as before (reference surround)', () => {
    expect(hlgGamma(1000)).toBeCloseTo(1.2, 10);
    expect(hlgGamma(2000)).toBeCloseTo(1.2 + 0.42 * Math.log10(2), 10);
    expect(hlgGamma(500)).toBeCloseTo(1.2 + 0.42 * Math.log10(0.5), 10);
    // outside 400…2000 the κ form, both meeting at 1000 cd/m²
    expect(hlgGamma(300)).toBeCloseTo(1.2 * Math.pow(1.111, Math.log2(0.3)), 10);
    expect(hlgGamma(4000)).toBeCloseTo(1.2 * Math.pow(1.111, Math.log2(4)), 10);
  });

  it('a brighter room means a smaller gamma, μ = 0.98 per doubling', () => {
    expect(hlgGamma(1000, 5)).toBeCloseTo(1.2, 10);
    expect(hlgGamma(1000, 10)).toBeCloseTo(1.2 * 0.98, 10);
    expect(hlgGamma(1000, 20)).toBeCloseTo(1.2 * 0.98 * 0.98, 10);
    expect(hlgGamma(1000, 2.5)).toBeCloseTo(1.2 / 0.98, 10);
    // and it multiplies with the peak term
    expect(hlgGamma(2000, 10)).toBeCloseTo((1.2 + 0.42 * Math.log10(2)) * 0.98, 10);
  });

  it('the global surround reaches every HLG calculation', () => {
    const nits1000 = hlgNits(0.75, 1000), white = hlgRefWhite(1000);
    setHlgSurround(50);
    expect(getHlgSurround()).toBe(50);
    expect(hlgGamma(1000)).toBeLessThan(1.2);
    // a smaller gamma lifts the mid tones: 75 % HLG is brighter than in the dark room
    expect(hlgNits(0.75, 1000)).toBeGreaterThan(nits1000);
    expect(hlgRefWhite(1000)).toBeGreaterThan(white);
  });

  it('nonsense values fall back to the reference environment', () => {
    setHlgSurround(0);
    expect(getHlgSurround()).toBe(5);
    setHlgSurround(Number.NaN);
    expect(getHlgSurround()).toBe(5);
    setHlgSurround(-3);
    expect(getHlgSurround()).toBe(5);
    // and it is capped, so one typo cannot turn the scale upside down
    setHlgSurround(1e9);
    expect(getHlgSurround()).toBe(1000);
  });
});
