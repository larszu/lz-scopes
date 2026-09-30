import { describe, expect, it } from 'vitest';
import { cubeProject, cubeQOf, cubeRotation, cubeWireframe, qFromLab, qFromRgb } from '../src/cube';
import { barRefs, deltaE, nearest } from '../src/deltae';
import { GAMUTS, mul3, rgbToXyzMatrix, signalToLinear, xyzToLab } from '../src/color';

const sdr = { transfer: 'sdr' as const, gamut: '709' as const, hlgLw: 1000 };
const pq = { transfer: 'pq' as const, gamut: '2020' as const, hlgLw: 1000 };

describe('3D colour volume', () => {
  it('rotation is orthonormal and 0/0 is the identity', () => {
    cubeRotation(0, 0).forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0, 0, 1, 0, 0, 0, 1][i], 12));
    const r = cubeRotation(35, 25);
    for (const q of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) expect(Math.hypot(...mul3(r, q))).toBeCloseTo(1, 12);
  });
  it('R′G′B′: black and white are symmetric about the centre, the grey axis is the diagonal', () => {
    const r = cubeRotation(0, 0);
    expect(cubeProject(r, qFromRgb([0.5, 0.5, 0.5]))).toEqual([0, 0]);
    const [bx, by] = cubeProject(r, qFromRgb([0, 0, 0])), [wx, wy] = cubeProject(r, qFromRgb([1, 1, 1]));
    expect(bx).toBeCloseTo(-wx, 12); expect(by).toBeCloseTo(-wy, 12);
  });
  it('CIELAB: SDR white = L* 100 on the vertical axis, grey has a* = b* = 0', () => {
    expect(cubeQOf('lab', [1, 1, 1], sdr)).toEqual(qFromLab([100, 0, 0]).map((v) => expect.closeTo(v, 9)));
    const q = cubeQOf('lab', [0.5, 0.5, 0.5], sdr);
    expect(q[0]).toBeCloseTo(0, 9); expect(q[2]).toBeCloseTo(0, 9);
  });
  it('wire frame: 12 edges, the 709 cube in CIELAB passes through white', () => {
    const w = cubeWireframe('lab', '709', '709');
    expect(w).toHaveLength(12);
    const pts = w.flat();
    expect(pts.some((q) => Math.abs(q[1] - qFromLab([100, 0, 0])[1]) < 1e-9 && Math.abs(q[0]) < 1e-9)).toBe(true);
  });
});

describe('ΔE at the probe point', () => {
  it('identical colours: 0; nearest bar of a 75 % yellow is the yellow bar', () => {
    expect(deltaE(sdr, [0.75, 0.75, 0], [0.75, 0.75, 0]).value).toBe(0);
    const n = nearest(sdr, [0.74, 0.76, 0.01], barRefs(sdr))!;
    expect(n.ref.name).toBe('Yl 75 %');
    expect(n.metric).toBe('ΔE00');
  });
  it('SDR uses CIEDE2000 on Lab of BT.1886 display light', () => {
    const lab = (c: number[]) => { const M = rgbToXyzMatrix(GAMUTS['709']); return xyzToLab(mul3(M, signalToLinear(c, 'sdr')), mul3(M, [1, 1, 1])); };
    const a = lab([0.5, 0.5, 0.5]), b = lab([0.52, 0.5, 0.5]);
    expect(a[1]).toBeCloseTo(0, 9);
    expect(deltaE(sdr, [0.5, 0.5, 0.5], [0.52, 0.5, 0.5]).value).toBeGreaterThan(0);
    expect(b[1]).toBeGreaterThan(0);
  });
  it('PQ uses ΔE ITP; 58 % bars for PQ', () => {
    expect(deltaE(pq, [0.58, 0.58, 0.58], [0.6, 0.58, 0.58]).metric).toBe('ΔITP');
    expect(barRefs(pq).some((r) => r.name === 'R 58 %')).toBe(true);
  });
});
