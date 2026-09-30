import { describe, expect, it } from 'vitest';
import { RGC, rgc, rgcCompressDist, rgcScale } from '../src/rgc';

// Parameters: alwan src/alwan/api/alwan_aces_ff.c l. 426–434 (ACES 1.3 RGC defaults, MIT).
describe('ACES 1.3 reference gamut compression', () => {
  it('scale puts the curve through (limit, 1): a channel at the limit distance lands exactly on the gamut edge', () => {
    for (const [lim, thr] of [[RGC.limC, RGC.thrC], [RGC.limM, RGC.thrM], [RGC.limY, RGC.thrY]]) {
      expect(rgcCompressDist(lim, thr, rgcScale(lim, thr, RGC.power), RGC.power)).toBeCloseTo(1, 9);
    }
  });
  it('leaves values below the threshold untouched and is monotonic above', () => {
    expect(rgc([0.5, 0.4, 0.3])).toEqual([0.5, 0.4, 0.3]);
    // cyan distance 1.147 (R = ach·(1 − 1.147) < 0) → R = 0
    const out = rgc([1 - RGC.limC, 1, 0.5]);
    expect(out[0]).toBeCloseTo(0, 9);
    expect(out[1]).toBe(1);
    const s = rgcScale(RGC.limC, RGC.thrC, RGC.power);
    expect(rgcCompressDist(0.9, RGC.thrC, s, RGC.power)).toBeLessThan(rgcCompressDist(1.0, RGC.thrC, s, RGC.power));
  });
});
