import { describe, expect, it } from 'vitest';
import { hsl, hlsPoint, hlsRedAngle } from '../src/graticule';
import { ycbcr } from '../src/color';

const deg = (r: number) => (r * 180) / Math.PI;

describe('HLS vectorscope', () => {
  it('HSL of the primaries and secondaries: 60° steps, full saturation', () => {
    const hues: [number[], number][] = [[[1, 0, 0], 0], [[1, 1, 0], 1 / 6], [[0, 1, 0], 2 / 6], [[0, 1, 1], 3 / 6], [[0, 0, 1], 4 / 6], [[1, 0, 1], 5 / 6]];
    for (const [rgb, h] of hues) { const q = hsl(rgb[0], rgb[1], rgb[2]); expect(q.h).toBeCloseTo(h, 6); expect(q.s).toBeCloseTo(1, 6); }
  });
  it('75 % bars sit on the 100 % ring (HSL saturation ignores brightness), grey in the centre', () => {
    expect(hsl(0.75, 0.75, 0).s).toBeCloseTo(1, 6);
    expect(hsl(0, 0.75, 0.75).s).toBeCloseTo(1, 6);
    expect(hsl(0.5, 0.5, 0.5).s).toBe(0);
    // pastel red: d = 0.4, L = 0.6 → S = d / (1 − |2L − 1|) = 0.5
    expect(hsl(0.8, 0.4, 0.4).s).toBeCloseTo(0.4 / (1 - Math.abs(2 * 0.6 - 1)), 6);
  });
  it('red lies where the YUV vectorscope puts it for the matrix', () => {
    for (const cs of ['709', '601', '2020'] as const) {
      const { cb, cr } = ycbcr(1, 0, 0, cs);
      expect(hlsRedAngle(cs)).toBeCloseTo(Math.atan2(cr, cb), 6);
    }
    expect(deg(hlsRedAngle('709'))).toBeCloseTo(102.9, 0);
  });
  it('hues run the same way round as in YUV (yellow 60° counter-clockwise of red)', () => {
    const r = { x: 0, y: 0, w: 200, h: 200 };
    const [rx, ry] = hlsPoint(r, 0, 1, '709', 1), [yx, yy] = hlsPoint(r, 1 / 6, 1, '709', 1);
    const a = (x: number, y: number) => Math.atan2(100 - y, x - 100);
    expect(deg(a(yx, yy) - a(rx, ry))).toBeCloseTo(60, 4);
    // the 100 % ring has radius 0.9 · R like the YUV vectorscope's 0.5 Cb/Cr circle
    expect(Math.hypot(rx - 100, ry - 100)).toBeCloseTo(90, 6);
  });
});
