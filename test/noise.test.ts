import { describe, expect, it } from 'vitest';
import { channelPlanes, measureNoise, noiseRows, quantFloorDb, toDb } from '../src/noise';
import { fitSurface, surfaceAt } from '../src/surface';
import { rgbDecoder } from '../src/ycbcr';

const KR = 0.2126, KB = 0.0722;
/** Deterministic Gaussian noise (mulberry32 + Box–Muller). */
function gauss(seed: number) {
  let s = seed;
  const u = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (((t ^ (t >>> 14)) >>> 0) + 0.5) / 4294967296; };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}
function frame(w: number, h: number, f: (x: number, y: number) => [number, number, number]) {
  const px = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set([...f(x, y), 1], (y * w + x) * 4);
  return px;
}
const dec = rgbDecoder(1);

describe('noise meter', () => {
  it('finds a known Gaussian noise of σ = 1 % (−40 dB) on a flat field, per channel', () => {
    const w = 200, h = 150, n = gauss(7);
    const px = frame(w, h, () => [0.1 + 0.01 * n(), 0.1 + 0.01 * n(), 0.1 + 0.01 * n()]);
    const r = measureNoise(channelPlanes(px, w, dec, KR, KB, [0, 0, w, h]))!;
    for (const c of ['R', 'G', 'B'] as const) {
      expect(r[c].sigma).toBeGreaterThan(0.0097); expect(r[c].sigma).toBeLessThan(0.0103);
      expect(r[c].db).toBeCloseTo(-40, 0);
      expect(r[c].mv).toBeCloseTo(7, 0);
      expect(r[c].mean).toBeCloseTo(0.1, 3);
    }
    // independent channel noise averages down in Y′: σ_Y = σ·√(Kr² + Kg² + Kb²)
    const kg = 1 - KR - KB;
    expect(r.Y.sigma).toBeCloseTo(0.01 * Math.hypot(KR, kg, KB), 3);
  });

  it('with detrending a shading ramp and hotspot do not count as noise; without they do', () => {
    const w = 160, h = 90, n = gauss(3);
    const px = frame(w, h, (x, y) => {
      const nx = (x / w) * 2 - 1, ny = (y / h) * 2 - 1, v = 0.7 + 0.05 * nx - 0.04 * nx * nx - 0.03 * ny * ny + 0.005 * n();
      return [v, v, v];
    });
    const planes = channelPlanes(px, w, dec, KR, KB, [0, 0, w, h]);
    expect(measureNoise(planes, true)!.G.sigma).toBeCloseTo(0.005, 3);
    expect(measureNoise(planes, false)!.G.sigma).toBeGreaterThan(0.02);
  });

  it('a noise-free test pattern reads −∞ dB', () => {
    const r = measureNoise(channelPlanes(frame(20, 20, () => [0.5, 0.5, 0.5]), 20, dec, KR, KB, [0, 0, 20, 20]))!;
    expect(r.Y.db).toBe(-Infinity);
    expect(noiseRows(r, { level: 'level', sigma: 'σ %' })[1]).toContain('−∞');
  });

  it('quantisation floors and dB scale', () => {
    expect(quantFloorDb(8, false)).toBeCloseTo(-58.9, 1);
    expect(quantFloorDb(10, true)).toBeCloseTo(-69.6, 1);
    expect(toDb(0.001)).toBeCloseTo(-60, 6);
  });

  it('surface fit recovers known saw and parabola coefficients', () => {
    const w = 64, h = 36, v = new Float32Array(w * h);
    const c = [0.6, 0.03, -0.02, -0.05, 0.01, 0.004];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const nx = ((x + 0.5) / w) * 2 - 1, ny = ((y + 0.5) / h) * 2 - 1;
      v[y * w + x] = c[0] + c[1] * nx + c[2] * ny + c[3] * nx * nx + c[4] * ny * ny + c[5] * nx * ny;
    }
    const s = fitSurface(v, w, h)!;
    s.forEach((k, i) => expect(k).toBeCloseTo(c[i], 6));
    expect(surfaceAt(s, 0, 0)).toBeCloseTo(0.6, 6);
  });
});
