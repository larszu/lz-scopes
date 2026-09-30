import { describe, expect, it } from 'vitest';
import {
  FALSE_COLOR_PRESETS, HDR_PREVIEW_GLSL, bandRange, bt2446a, bt2446aKnee, hdrToSdr, hlgInverseOetf, hlgGamma, pqEncode, pqDecode,
} from '../src/color';
import { DIAMOND_SCALE, diamondPoint, plotRect } from '../src/graticule';
import { computeStats } from '../src/sources';

const sdrSignal = (l: number) => Math.pow(l, 1 / 2.4); // BT.1886 inverse, 100 cd/m² peak

describe('HDR → SDR preview', () => {
  it('BT.2446 Method A: knee continuous at 0.7399 and 0.9909, 1 → 1', () => {
    // the published 4-digit coefficients leave a step of 5·10⁻⁴ at 0.7399
    expect(bt2446aKnee(0.7399)).toBeCloseTo(-1.151 * 0.7399 ** 2 + 2.7811 * 0.7399 - 0.6302, 2);
    expect(bt2446aKnee(0.9909 - 1e-9)).toBeCloseTo(0.5 * 0.9909 + 0.5, 3);
    expect(bt2446aKnee(1)).toBe(1);
  });

  it('BT.2446 Method A: 1000 cd/m² white → SDR 100 %, neutrals stay neutral, monotonic', () => {
    const w = bt2446a([1, 1, 1]);
    w.forEach((v) => expect(v).toBeCloseTo(1, 3));
    expect(bt2446a([0, 0, 0])).toEqual([0, 0, 0]);
    let last = -1;
    for (let nits = 1; nits <= 1000; nits *= 1.5) {
      const [r, g, b] = bt2446a([nits / 1000, nits / 1000, nits / 1000]);
      expect(r).toBeCloseTo(g, 6); expect(b).toBeCloseTo(g, 6);
      expect(g).toBeGreaterThan(last); last = g;
    }
  });

  it('BT.2408 hybrid-linear: ×0.5 below the knee, reference white at 86–95 % SDR, peak → 100 %', () => {
    // 20 cd/m² (lin 20/203) → 10 cd/m² SDR: linear part of the down-mapper (BT.2408-8 § 5.2)
    expect(hdrToSdr([20 / 203, 20 / 203, 20 / 203], 'bt2408', 1000)[1]).toBeCloseTo(0.1, 4);
    // HDR Reference White 203 cd/m²: BT.2408-8 § 7.1.3 (SDR output 86 … 95 %)
    const ref = sdrSignal(hdrToSdr([1, 1, 1], 'bt2408', 1000)[1]);
    expect(ref).toBeGreaterThan(0.86); expect(ref).toBeLessThan(0.95);
    expect(hdrToSdr([1000 / 203, 1000 / 203, 1000 / 203], 'bt2408', 1000)[0]).toBeCloseTo(1, 4);
    let last = -1;
    for (let nits = 0.5; nits <= 1000; nits *= 1.3) {
      const v = hdrToSdr([nits / 203, nits / 203, nits / 203], 'bt2408', 1000)[0];
      expect(v).toBeGreaterThan(last); last = v;
    }
  });

  it('HLG 75 % on a 1000 cd/m² display (= 203 cd/m²) maps like PQ reference white', () => {
    const lw = 1000, nits = lw * Math.pow(hlgInverseOetf(0.75), hlgGamma(lw));
    expect(nits).toBeCloseTo(203, -1);
    const a = hdrToSdr([nits / 203, nits / 203, nits / 203], 'bt2446a', lw)[1];
    const b = hdrToSdr([1, 1, 1], 'bt2446a', 1000)[1];
    expect(a).toBeCloseTo(b, 2);
  });

  it('sources above 1000 cd/m² are first brought to 1000 with the EETF (Method A)', () => {
    expect(hdrToSdr([4000 / 203, 4000 / 203, 4000 / 203], 'bt2446a', 4000)[1]).toBeCloseTo(1, 3);
    expect(hdrToSdr([10 / 203, 10 / 203, 10 / 203], 'bt2446a', 4000)[1]).toBeCloseTo(hdrToSdr([10 / 203, 10 / 203, 10 / 203], 'bt2446a', 1000)[1], 3);
  });

  it('GLSL twin carries the same constants', () => {
    for (const c of ['0.7399', '1.151', '2.7811', '0.6302', '0.9909', '1.8814', '1.4746', '101.5', '0.2627', '0.0593']) expect(HDR_PREVIEW_GLSL).toContain(c);
  });
});

describe('false-colour presets RED / Sony', () => {
  const bandAt = (preset: string, pct: number) => {
    let hit: string | undefined;
    for (const b of FALSE_COLOR_PRESETS[preset]) if (pct >= b.from && pct < b.to) hit = b.label;
    return hit;
  };
  it('RED video mode (docs.red.com): 18 % grey green at IRE 41–48, clip red at 99–100', () => {
    expect(bandAt('RED Video', 41)).toMatch(/^Grün/);
    expect(bandAt('RED Video', 48.9)).toMatch(/^Grün/);
    expect(bandAt('RED Video', 49)).toBeUndefined();
    expect(bandAt('RED Video', 65)).toMatch(/^Rosa/);
    expect(bandAt('RED Video', 99.5)).toMatch(/^Rot/);
    expect(bandAt('RED Video', 100)).toMatch(/^Rot/);
    expect(bandRange(FALSE_COLOR_PRESETS['RED Video'][3])).toBe('41–48');
  });
  it('Sony Monitor & Control palettes', () => {
    expect(bandAt('Sony S-Log3', 41)).toBe('Grün'); // S-Log3 18 % grey = 41 %
    expect(bandAt('Sony S-Log3', 95)).toBe('Rot');
    expect(bandAt('Sony S-Log3', 92)).toBe('Gelb');
    expect(bandAt('Sony SDR', 45)).toBe('Grün');
    expect(bandAt('Sony SDR', 105)).toBe('Rot');
    expect(bandAt('Sony SDR', -3)).toBe('Schwarz');
  });
  it('every preset fits the shader (≤ 12 bands) and has no overlapping bands', () => {
    for (const [name, bands] of Object.entries(FALSE_COLOR_PRESETS)) {
      expect(bands.length, name).toBeLessThanOrEqual(12);
      const sorted = [...bands].sort((a, b) => a.from - b.from);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i].from, name).toBeGreaterThanOrEqual(sorted[i - 1].to);
    }
  });
});

describe('Tektronix diamond', () => {
  const r = plotRect('diamond', 400, 600);
  // back from plot position to (a − g, a + g)
  const uv = (x: number, y: number, upper: boolean) => {
    const u = (x - r.x - r.w / 2) / (r.w / 2) / DIAMOND_SCALE[0];
    const v = ((r.y + r.h / 2 - y) / (r.h / 2) / DIAMOND_SCALE[1]) * (upper ? 1 : -1);
    return [u, v];
  };
  const inside = (u: number, v: number) => Math.abs(u) <= v + 1e-9 && v <= 2 - Math.abs(u) + 1e-9;
  it('plot is twice as high as wide, diamonds are squares turned by 45°', () => {
    expect(r.h / r.w).toBeCloseTo(2, 6);
    const [bx, by] = diamondPoint(r, 1, 0, true), [cx, cy] = diamondPoint(r, 1, 1, true), [ox, oy] = diamondPoint(r, 0, 0, true);
    expect(Math.hypot(bx - ox, by - oy)).toBeCloseTo(Math.hypot(cx - bx, cy - by), 6);
  });
  it('every legal R′G′B′ lies inside both diamonds; out-of-gamut values outside', () => {
    for (const a of [0, 0.3, 1]) for (const g of [0, 0.5, 1]) {
      for (const upper of [true, false]) {
        const [x, y] = diamondPoint(r, a, g, upper);
        expect(inside(...(uv(x, y, upper) as [number, number]))).toBe(true);
      }
    }
    const [x, y] = diamondPoint(r, 1.1, 0.5, true);
    expect(inside(...(uv(x, y, true) as [number, number]))).toBe(false);
    const [x2, y2] = diamondPoint(r, -0.05, 0.2, false);
    expect(inside(...(uv(x2, y2, false) as [number, number]))).toBe(false);
  });
});

describe('MaxCLL / MaxFALL (CTA-861.3)', () => {
  it('per frame: brightest max(R,G,B) and average of max(R,G,B) in cd/m²', () => {
    // two pixels, 16 bit PQ: a 1000 cd/m² red and a 100 cd/m² grey
    const code = (nits: number) => Math.round(pqEncode(nits) * 65535);
    const px = new Uint16Array([code(1000), 0, 0, 65535, code(100), code(100), code(100), 65535]);
    const s = computeStats(px, 2, 1, 1, 65535, 0.2627, 0.0593, null, undefined, undefined, pqDecode);
    expect(s.cll!.max).toBeCloseTo(1000, -1);
    expect(s.cll!.avg).toBeCloseTo(550, -1);
    expect(computeStats(px, 2, 1, 1, 65535, 0.2627, 0.0593).cll).toBeUndefined();
  });
});
