import { describe, expect, it } from 'vitest';
import { HUE_BINS, History, gridFromData, hueSat, summarise } from '../src/history';
import { rgbDecoder } from '../src/ycbcr';

describe('scopes over time (history.ts)', () => {
  it('hue and saturation follow the vectorscope: BT.709 red at about 103°, 100 % red ≈ 100 % saturation', () => {
    // BT.709 red: Cb = −0.1146, Cr = 0.5 → atan2(0.5, −0.1146) = 102.9°
    const red = hueSat([1, 0, 0], '709');
    expect(red.deg).toBeCloseTo(102.9, 1);
    expect(red.sat).toBeCloseTo(Math.hypot(-0.1146, 0.5) / 0.5, 2);
    expect(hueSat([0.5, 0.5, 0.5], '709').sat).toBeCloseTo(0, 12);
  });
  it('summarises a frame: mean colour, luma range, saturation and hue histogram', () => {
    const pts = [[1, 0, 0], [1, 0, 0], [0.5, 0.5, 0.5], [0, 0, 0]];
    const s = summarise(pts, '709', 1);
    expect(s.rgb[0]).toBeCloseTo(0.625, 9);
    expect(s.yMin).toBeCloseTo(0, 9); expect(s.yMax).toBeCloseTo(0.5, 9);
    expect(s.hue.reduce((a, v) => a + v, 0)).toBeCloseTo(1, 6);
    expect(s.hue[Math.floor(102.9 / (360 / HUE_BINS))]).toBeCloseTo(1, 6); // only red has chroma
    expect(s.sat95).toBeCloseTo(hueSat([1, 0, 0], '709').sat, 9);
  });
  it('grid sampling reads raw frames through the decoder', () => {
    const w = 4, h = 2, px = new Float32Array(w * h * 4).fill(0.25);
    expect(gridFromData(px, w, h, rgbDecoder(1))[0]).toEqual([0.25, 0.25, 0.25]);
  });
  it('the ring buffer keeps the newest samples', () => {
    const hst = new History(3);
    for (let i = 0; i < 5; i++) hst.push(summarise([[0, 0, 0]], '709', i));
    expect(hst.samples.map((s) => s.t)).toEqual([2, 3, 4]);
    expect(hst.version).toBe(5);
  });
});
