import { describe, expect, it } from 'vitest';
import { DEFAULT_CRT, PHOSPHORS, beamDensity, beamSigma, erfApprox, persistDecay } from '../src/crt';

// erf reference values: Abramowitz & Stegun Tab. 7.1 (erf 0.5 = 0.5204999, erf 1 = 0.8427008, erf 2 = 0.9953223)
describe('CRT beam (crt.ts)', () => {
  it('erf approximation (A&S 7.1.27) within 5·10⁻⁴', () => {
    expect(Math.abs(erfApprox(0.5) - 0.5204999)).toBeLessThan(5e-4);
    expect(Math.abs(erfApprox(1) - 0.8427008)).toBeLessThan(5e-4);
    expect(Math.abs(erfApprox(2) - 0.9953223)).toBeLessThan(5e-4);
    expect(erfApprox(-1)).toBeCloseTo(-erfApprox(1), 12);
  });
  const integral = (len: number, sigma: number) => {
    let s = 0; const h = 0.05, r = 6 * sigma;
    for (let x = -r; x <= len + r; x += h) for (let y = -r; y <= r; y += h) s += beamDensity(x, y, len, sigma) * h * h;
    return s;
  };
  it('each segment deposits the same energy (integral 1), so brightness ∝ 1 / segment length', () => {
    for (const len of [0, 0.5, 3, 20]) expect(integral(len, 0.8)).toBeCloseTo(1, 2);
    // on the line, away from the ends: density ∝ 1/len
    const d10 = beamDensity(5, 0, 10, 0.8), d20 = beamDensity(10, 0, 20, 0.8);
    expect(d10 / d20).toBeCloseTo(2, 3);
  });
  it('beam σ from FWHM: FWHM = 2√(2 ln 2) σ', () => {
    expect(beamSigma(2.3548, 1)).toBeCloseTo(1, 3);
    expect(beamSigma(2.3548, 2)).toBeCloseTo(2, 3);
  });
  it('persistence: exp(−Δt/τ), 0 = none, −1 = storage', () => {
    expect(persistDecay(30, 30)).toBeCloseTo(Math.exp(-1), 12);
    expect(persistDecay(16, 0)).toBe(0);
    expect(persistDecay(16, -1)).toBe(1);
  });
  it('phosphor defaults follow the persistence classes (P31 < P1 < P7)', () => {
    expect(PHOSPHORS.P31.tau).toBeLessThanOrEqual(1);
    expect(PHOSPHORS.P1.tau).toBeGreaterThanOrEqual(1); expect(PHOSPHORS.P1.tau).toBeLessThanOrEqual(100);
    expect(PHOSPHORS.P7.tau).toBeGreaterThan(PHOSPHORS.P1.tau);
    expect(DEFAULT_CRT.on).toBe(false);
  });
});
