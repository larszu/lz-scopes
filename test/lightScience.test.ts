import { describe, expect, it } from 'vitest';
import { cctDuv } from '../src/calib/colorimetry';
import {
  compareLights, deltaUvPrime, greenMagentaHint, gridStats, isothermXy, lightVector, mired, miredShift, planckXy, seriesStats, suggestGels, uvPrimeToXy, xyToUvPrime,
} from '../src/opple/lightScience';
import type { Reading } from '../src/opple/photometry';

const reading = (x: number, y: number, lux: number): Reading => {
  const Y = lux, X = (x * Y) / y, Z = ((1 - x - y) * Y) / y;
  return { model: 'lm3', lux, X, Y, Z, x, y, u: 0, v: 0, cct: 0, duv: 0, mode: 3, bands: [], wavelengths: [], raw: [], calibrated: true, battery: null, temperature: null, ts: 0 };
};

describe('CIE 1976 u′v′', () => {
  it('D65 (x 0.3127, y 0.3290) → u′ 0.1978, v′ 0.4683', () => {
    const [u, v] = xyToUvPrime(0.3127, 0.329);
    expect(u).toBeCloseTo(0.1978, 4);
    expect(v).toBeCloseTo(0.4683, 4);
  });
  it('round trip and distance', () => {
    const [x, y] = uvPrimeToXy(...xyToUvPrime(0.45, 0.41));
    expect(x).toBeCloseTo(0.45, 10); expect(y).toBeCloseTo(0.41, 10);
    expect(deltaUvPrime([0.3127, 0.329], [0.3127, 0.329])).toBe(0);
    expect(deltaUvPrime([0.3, 0.3], [0.31, 0.32])).toBeCloseTo(deltaUvPrime([0.31, 0.32], [0.3, 0.3]), 12);
  });
});

describe('Planck locus and isotherms', () => {
  it('Duv 0 lies on the locus, ±0.01 is found again by the exact search', () => {
    for (const T of [2700, 4000, 6500]) {
      expect(isothermXy(T, 0)[0]).toBeCloseTo(planckXy(T)[0], 10);
      const up = cctDuv(isothermXy(T, 0.01)), down = cctDuv(isothermXy(T, -0.01));
      expect(up.cct).toBeGreaterThan(T * 0.98); expect(up.cct).toBeLessThan(T * 1.02);
      expect(up.duv).toBeCloseTo(0.01, 4);
      expect(down.duv).toBeCloseTo(-0.01, 4);
    }
  });
});

describe('mired and gels', () => {
  it('mired = 10⁶/T; Wikipedia example: daylight film 5700 K under 3200 K needs ≈ −137 mired (CTB)', () => {
    expect(mired(3200)).toBeCloseTo(312.5, 6);
    expect(miredShift(3200, 5700)).toBeCloseTo(-137.06, 1);
    expect(suggestGels(3200, 5700, 'Lee')[0].gels.map((g) => g.name)).toEqual(['201 Full CT Blue']);
  });
  it('5600 K → 3200 K: CTO side, best fit within 5 mired', () => {
    const s = suggestGels(5600, 3200, 'Lee');
    expect(miredShift(5600, 3200)).toBeCloseTo(133.93, 1);
    expect(s[0].gels.every((g) => g.mired > 0)).toBe(true);
    expect(Math.abs(s[0].residual)).toBeLessThan(5);
    expect(s[0].resultK).toBeGreaterThan(3150); expect(s[0].resultK).toBeLessThan(3250);
  });
});

describe('vectorscope of the light', () => {
  it('no saturation at the reference, warm light lies on the +u′ side', () => {
    expect(lightVector([0.3127, 0.329], [0.3127, 0.329]).sat).toBe(0);
    const w = lightVector(planckXy(3200), planckXy(5600));
    expect(w.du).toBeGreaterThan(0);
    expect(w.sat).toBeCloseTo(13 * deltaUvPrime(planckXy(3200), planckXy(5600)), 12);
  });
});

describe('comparison and grid', () => {
  it('compares two lights: shift, stops, green/magenta', () => {
    const a = reading(...planckXy(5600), 800), b = reading(...isothermXy(3200, 0.005), 400);
    const c = compareLights(a, b);
    expect(c.stops).toBeCloseTo(-1, 10);
    expect(c.shift).toBeLessThan(-100);
    expect(c.dDuv).toBeGreaterThan(0.004);
    expect(greenMagentaHint(c.dDuv)).toContain('Minus Green');
  });
  it('grid uniformity = min/max', () => {
    const p = planckXy(4000);
    const st = gridStats([{ col: 0, row: 0, reading: reading(p[0], p[1], 100) }, { col: 1, row: 0, reading: reading(p[0], p[1], 80) }])!;
    expect(st.uniformity).toBeCloseTo(80, 10);
    expect(st.maxDuv).toBeLessThan(1e-9);
  });
  it('series statistics (sample standard deviation)', () => {
    const s = seriesStats([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s.mean).toBe(5);
    expect(s.sd).toBeCloseTo(2.138, 3);
  });
});
