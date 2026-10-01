import { describe, expect, it } from 'vitest';
import { cubeProject, cubeQOf, cubeRotation, cubeWireframe, hsvOf, qFromChl, qFromHsv, qFromYcc, yccOf } from '../src/cube';

const sdr = { transfer: 'sdr' as const, gamut: '709' as const, hlgLw: 1000, colorspace: '709' as const };

describe('3D volume: more colour models, pan and zoom', () => {
  it('HSV of the signal: red 0°, yellow 60°, blue 240°; grey has no saturation', () => {
    expect(hsvOf([1, 0, 0])).toEqual([0, 1, 1]);
    expect(hsvOf([1, 1, 0])[0]).toBeCloseTo(60, 9);
    expect(hsvOf([0, 0, 1])[0]).toBeCloseTo(240, 9);
    expect(hsvOf([0.5, 0.5, 0.5])[1]).toBe(0);
    expect(cubeQOf('hsv', [1, 0, 0], sdr)).toEqual(qFromHsv([0, 1, 1]));
  });
  it('Y′CbCr ("Hector") view: BT.709 red has Cr = 0.5; white sits on the vertical axis at Y′ 100 %', () => {
    const [y, cb, cr] = yccOf([1, 0, 0], { kr: 0.2126, kb: 0.0722 });
    expect(y).toBeCloseTo(0.2126, 9); expect(cr).toBeCloseTo(0.5, 9); expect(cb).toBeCloseTo(-0.1146, 4);
    expect(cubeQOf('ycbcr', [1, 1, 1], sdr)).toEqual(qFromYcc([1, 0, 0]).map((v) => expect.closeTo(v, 9)));
    expect(cubeWireframe('ycbcr', '709', '709')).toHaveLength(12);
  });
  it('CIE XYZ: SDR white is Y = 1; LCh: hue of a red is near 40°', () => {
    expect(cubeQOf('xyz', [1, 1, 1], sdr)[1]).toBeCloseTo((1 - 0.5) * 1.6, 9);
    const q = cubeQOf('chl', [1, 0, 0], sdr);
    const h = (q[0] / 2.4 + 0.5) * 360;
    expect(h).toBeGreaterThan(35); expect(h).toBeLessThan(45); // CIELAB hue of sRGB red ≈ 40°
    expect(qFromChl([50, 0, 180])[0]).toBeCloseTo(0, 9);
  });
  it('zoom scales and pan shifts the projection', () => {
    const r = cubeRotation(0, 0), q = [0.5, 0.25, 0];
    const [x1, y1] = cubeProject(r, q), [x2, y2] = cubeProject(r, q, { zoom: 2, panX: 0.1, panY: -0.2 });
    expect(x2).toBeCloseTo(2 * x1 + 0.1, 12); expect(y2).toBeCloseTo(2 * y1 - 0.2, 12);
  });
});
