import { describe, expect, it } from 'vitest';
import { RGC, rgc, rgcCompressDist, rgcScale } from '../src/rgc';
import { lightLevels, pixelNits } from '../src/hdrmeta';
import { rgbDecoder } from '../src/ycbcr';
import { diamondPoint } from '../src/graticule';
import { FALSE_COLOR_PRESETS, pqEncode } from '../src/color';

describe('ACES 1.3 RGC (alwan aces_ff, MIT)', () => {
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

describe('MaxCLL / MaxFALL', () => {
  it('PQ: 1000 cd/m² pixel → MaxCLL 1000, FALL is the mean of the per-pixel maxima', () => {
    const v = pqEncode(1000), g = pqEncode(100);
    const px = new Float32Array([v, 0, 0, 1, g, g, g, 1]);
    const l = lightLevels(px, 2, 1, 1, rgbDecoder(1), 'pq')!;
    expect(l.maxCll).toBeCloseTo(1000, 3);
    expect(l.fall).toBeCloseTo(550, 3);
  });
  it('SDR BT.1886: 100 % = 100 cd/m²; HLG 75 % on a 1000 cd/m² display = 203 cd/m² (EBU R 167)', () => {
    expect(pixelNits([1, 1, 1], 'sdr')![0]).toBeCloseTo(100, 9);
    expect(Math.round(pixelNits([0.75, 0.75, 0.75], 'hlg', 1000)![1])).toBe(203);
    expect(pixelNits([0.5, 0.5, 0.5], 'slog3')).toBeNull();
  });
});

describe('double diamond', () => {
  const r = { x: 0, y: 0, w: 200, h: 200 };
  it('black in the centre, white at the tips, pure primaries at the side corners', () => {
    expect(diamondPoint(r, 0, 0, true)).toEqual([100, 100]);
    expect(diamondPoint(r, 1, 1, true)[1]).toBeCloseTo(10, 9); // top tip (0.9 of the half height)
    expect(diamondPoint(r, 1, 1, false)[1]).toBeCloseTo(190, 9);
    const [bx] = diamondPoint(r, 1, 0, true), [gx] = diamondPoint(r, 0, 1, true);
    expect(bx).toBeGreaterThan(100); expect(gx).toBeLessThan(100);
  });
});

describe('false-colour presets', () => {
  it('RED video mode (docs.red.com): 9 zones, green 41–48 IRE, red 99–100', () => {
    const red = FALSE_COLOR_PRESETS.RED;
    expect(red).toHaveLength(9);
    expect(red.find((b) => b.label.startsWith('Grün'))).toMatchObject({ from: 40.5, to: 48.5 });
    expect(red[red.length - 1].from).toBe(98.5);
  });
  it('ARRI (ALEXA Mini LF manual p83): 18 % grey 38–42 %, one stop over 52–56 %', () => {
    const a = FALSE_COLOR_PRESETS.ARRI;
    expect(a.find((b) => b.label === '18 % Grau')).toMatchObject({ from: 38, to: 42 });
    expect(a.find((b) => b.label === 'Grau +1 Blende')).toMatchObject({ from: 52, to: 56 });
  });
});
