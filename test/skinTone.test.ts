import { describe, expect, it } from 'vitest';
import { cloudRow, hueDelta, skinCloud } from '../src/skinTone';

const KR = 0.2126, KB = 0.0722, KG = 1 - KR - KB;
const Q = { lo: 0.3, hi: 0.8, tol: 14 };
/** R′G′B′ of luma Y with chroma at vectorscope angle `deg` and |CbCr| = `c` (BT.709). */
function rgbAt(Y: number, deg: number, c: number): [number, number, number] {
  const cb = c * Math.cos((deg * Math.PI) / 180), cr = c * Math.sin((deg * Math.PI) / 180);
  const r = Y + 2 * (1 - KR) * cr, b = Y + 2 * (1 - KB) * cb;
  return [r, (Y - KR * r - KB * b) / KG, b];
}
/** A face patch: skin at hue `deg` with a little spread, plus background pixels that must not count. */
function face(deg: number, sat = 0.2, n = 600) {
  const out: [number, number, number][] = [];
  for (let i = 0; i < n; i++) out.push(rgbAt(0.55 + 0.1 * Math.sin(i), deg + 2 * Math.sin(i * 1.7), sat * 0.5 * (1 + 0.05 * Math.cos(i * 0.9))));
  for (let i = 0; i < 300; i++) out.push(rgbAt(0.5, 240, 0.1), [0.9, 0.9, 0.9], rgbAt(0.2, 120, 0.1)); // blue shirt, white wall, dark skin-coloured shadow below the luma window
  return out;
}

describe('skin tone across cameras', () => {
  it('finds the hue and saturation of a synthetic face and ignores shirt, wall and shadow', () => {
    const c = skinCloud(face(123), KR, KB, Q)!;
    expect(c.n).toBe(600);
    expect(c.hue).toBeCloseTo(123, 0);
    expect(c.sat).toBeCloseTo(0.2, 2);
  });
  it('a camera with a known hue shift of +6° reads ΔH ≈ +6° against the reference', () => {
    const ref = skinCloud(face(123), KR, KB, Q)!, cam = skinCloud(face(129, 0.25), KR, KB, Q)!;
    expect(hueDelta(cam.hue, ref.hue)).toBeCloseTo(6, 0);
    expect((cam.sat - ref.sat) * 100).toBeCloseTo(5, 0);
    const row = cloudRow('2 Cam B', cam, ref);
    expect(row).toContain('ΔH +6.0°');
    expect(cloudRow('1 Cam A', ref, ref)).not.toContain('ΔH');
  });
  it('outside the hue tolerance or with too few skin pixels there is no cloud', () => {
    expect(skinCloud(face(160), KR, KB, Q)).toBeNull();
    expect(skinCloud(face(123, 0.2, 10), KR, KB, Q)).toBeNull();
  });
  it('hue differences wrap around', () => {
    expect(hueDelta(5, 355)).toBeCloseTo(10, 9);
    expect(hueDelta(355, 5)).toBeCloseTo(-10, 9);
  });
});
