import { describe, expect, it } from 'vitest';
import { PeakHold, lumaPlane, measureRect, peakingShare, sharpness } from '../src/focus';
import { rgbDecoder } from '../src/ycbcr';

const KR = 0.2126, KB = 0.0722;
/** Grey frame from a level function (RGBA floats, decoder scale 1). */
function frame(w: number, h: number, f: (x: number, y: number) => number) {
  const px = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x, y); px.set([v, v, v, 1], (y * w + x) * 4); }
  return px;
}
/** Checkerboard of 16-px squares, blurred with a Gaussian of `sigma` px (separable, sampled analytically). */
function blurredChecker(w: number, h: number, sigma: number) {
  const sharp = (x: number, y: number) => ((Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? 0.8 : 0.2);
  if (sigma <= 0) return frame(w, h, sharp);
  const r = Math.ceil(3 * sigma), k: number[] = [];
  for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const sum = k.reduce((a, b) => a + b, 0);
  const tmp = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let i = -r; i <= r; i++) s += k[i + r] * sharp(Math.min(w - 1, Math.max(0, x + i)), y); tmp[y * w + x] = s / sum; }
  return frame(w, h, (x, y) => { let s = 0; for (let i = -r; i <= r; i++) s += k[i + r] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x]; return s / sum; });
}
const dec = rgbDecoder(1);
const measure = (px: Float32Array, w: number, h: number) => sharpness(lumaPlane(px, w, dec, KR, KB, [0, 0, w, h]));

describe('focus measure', () => {
  it('falls monotonically as the same picture gets more blurred', () => {
    const w = 128, h = 96;
    const s = [0, 0.7, 1.5, 3, 6].map((sigma) => measure(blurredChecker(w, h, sigma), w, h));
    for (let i = 1; i < s.length; i++) expect(s[i], `σ step ${i}`).toBeLessThan(s[i - 1]);
    expect(s[4]).toBeLessThan(s[0] * 0.3);
  });
  it('a flat field reads 0; a single hard step of 1 reads the expected RMS', () => {
    expect(measure(frame(64, 64, () => 0.5), 64, 64)).toBe(0);
    // vertical edge 0 → 1: the scaled Sobel response is 1 in the two columns at the edge, 0 elsewhere
    const w = 64, h = 32, px = frame(w, h, (x) => (x < 32 ? 0 : 1));
    const inner = (w - 2) * (h - 2), hot = 2 * (h - 2);
    expect(measure(px, w, h)).toBeCloseTo(Math.sqrt(hot / inner) * 100, 4);
  });
  it('peaking colours more of the sharp picture than of the blurred one', () => {
    const w = 128, h = 96;
    const sh = peakingShare(lumaPlane(blurredChecker(w, h, 0), w, dec, KR, KB, [0, 0, w, h]), 0.12);
    const bl = peakingShare(lumaPlane(blurredChecker(w, h, 4), w, dec, KR, KB, [0, 0, w, h]), 0.12);
    expect(sh).toBeGreaterThan(0.05);
    expect(bl).toBeLessThan(sh * 0.2);
  });
  it('measures the measuring frame, otherwise the centre third; large regions are cropped, not scaled', () => {
    expect(measureRect(null, 300, 90)).toEqual([100, 30, 200, 60]);
    expect(measureRect([10.4, 5.2, 50.6, 40.9], 300, 90)).toEqual([10, 5, 51, 41]);
    const p = lumaPlane(frame(1000, 1000, (x) => x / 1000), 1000, dec, KR, KB, [0, 0, 1000, 1000], 10_000);
    expect(p.w).toBe(100); expect(p.h).toBe(100);
    expect(p.y[0]).toBeCloseTo(0.45, 6); // starts at the centre crop, not at x = 0
  });
  it('peak hold keeps the maximum and starts over for a new region', () => {
    const ph = new PeakHold();
    expect(ph.update('a', 3)).toBe(3); expect(ph.update('a', 5)).toBe(5); expect(ph.update('a', 4)).toBe(5);
    expect(ph.update('b', 2)).toBe(2);
    ph.reset(); expect(ph.update('b', 1)).toBe(1);
  });
});
