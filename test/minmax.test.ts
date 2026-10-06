import { describe, expect, it } from 'vitest';
import { castName, lineExtremes, neutralCast } from '../src/minmax';
import { rgbDecoder } from '../src/ycbcr';

const frame = (w: number, h: number, fn: (x: number, y: number) => number[]) => {
  const px = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set([...fn(x, y), 1], (y * w + x) * 4);
  return px;
};
const dec = rgbDecoder(1);

describe('Min/Max per line', () => {
  it('finds the darkest and brightest Y′ of every line', () => {
    // line y: ramp from 0 to y/10 across the line
    const w = 11, h = 10, px = frame(w, h, (x, y) => { const v = (x / 10) * (y / 10); return [v, v, v]; });
    const e = lineExtremes(px, w, h, dec, '709', h, 1);
    expect(e.rows).toBe(10);
    for (let y = 0; y < h; y++) { expect(e.min[y]).toBeCloseTo(0, 6); expect(e.max[y]).toBeCloseTo(y / 10, 6); }
  });
});

describe('neutral cast', () => {
  it('a slightly warm grey has a cast towards yellow/red; pure grey none; saturated pixels are ignored', () => {
    const w = 20, h = 10;
    const warm = neutralCast(frame(w, h, () => [0.52, 0.5, 0.47]), w, h, 1, dec, '709');
    expect(warm.share).toBe(1);
    expect(warm.amount).toBeGreaterThan(0.01);
    expect(['Gelb', 'Rot']).toContain(castName(warm.deg, '709'));
    const grey = neutralCast(frame(w, h, () => [0.5, 0.5, 0.5]), w, h, 1, dec, '709');
    expect(grey.amount).toBeCloseTo(0, 9);
    const red = neutralCast(frame(w, h, () => [0.8, 0.1, 0.1]), w, h, 1, dec, '709');
    expect(red.share).toBe(0);
  });
  it('the Y′ range limits the counted pixels', () => {
    const w = 10, h = 10, px = frame(w, h, (_x, y) => (y < 5 ? [0.1, 0.1, 0.12] : [0.8, 0.8, 0.82]));
    expect(neutralCast(px, w, h, 1, dec, '709', 0.05, 0.02, 0.3).share).toBeCloseTo(0.5, 9);
    expect(castName(neutralCast(px, w, h, 1, dec, '709', 0.05, 0.02, 0.3).deg, '709')).toBe('Blau');
  });
});
