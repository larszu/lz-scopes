// Share of the picture outside a target gamut (#181): the number next to the picture's gamut
// warning. It has to agree with the shader's rule, so the test checks the two ends – a colour
// that fits in Rec.709 and one that only exists in Rec.2020.
import { describe, expect, it } from 'vitest';
import { GAMUTS, gamutConvert, signalToLinear } from '../src/color';
import { gamutShare } from '../src/gamutShare';

const decode = (px: ArrayLike<number>, i: number): [number, number, number] => [px[i] / 255, px[i + 1] / 255, px[i + 2] / 255];
const lin = (rgb: number[]) => signalToLinear(rgb, 'sdr');
/** w × h pixels, all the same colour */
const flat = (rgb: [number, number, number], w = 8, h = 8) => {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { px[i * 4] = rgb[0]; px[i * 4 + 1] = rgb[1]; px[i * 4 + 2] = rgb[2]; px[i * 4 + 3] = 255; }
  return { px, w, h };
};

describe('share outside the target gamut', () => {
  const to709 = (from: keyof typeof GAMUTS) => gamutConvert(GAMUTS[from], GAMUTS['709']);

  it('a Rec.709 picture is never outside Rec.709', () => {
    for (const c of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [128, 128, 128], [255, 255, 255]] as [number, number, number][]) {
      const f = flat(c);
      expect(gamutShare(f.px, f.w, f.h, decode, to709('709'), lin).share).toBe(0);
    }
  });

  it('the saturated primaries of Rec.2020 are outside Rec.709', () => {
    const red = flat([255, 0, 0]);
    const g = gamutShare(red.px, red.w, red.h, decode, to709('2020'), lin);
    expect(g.share).toBe(1);
    expect(g.samples).toBe(64);
    // Rec.2020 red lands just outside the Rec.709 red (d ≈ 1.07), its green far outside
    expect(g.far).toBe(0);
    const green = flat([0, 255, 0]);
    expect(gamutShare(green.px, green.w, green.h, decode, to709('2020'), lin).far).toBe(1);
  });

  it('counts per pixel: half in, half out', () => {
    const w = 8, h = 8;
    const px = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const sat = i % 2 === 0;
      px[i * 4] = sat ? 255 : 128; px[i * 4 + 1] = sat ? 0 : 128; px[i * 4 + 2] = sat ? 0 : 128; px[i * 4 + 3] = 255;
    }
    expect(gamutShare(px, w, h, decode, to709('2020'), lin).share).toBeCloseTo(0.5, 6);
  });

  it('black counts as inside: nothing to be outside of', () => {
    const f = flat([0, 0, 0]);
    expect(gamutShare(f.px, f.w, f.h, decode, to709('2020'), lin).share).toBe(0);
  });

  it('a big picture is sampled, not walked pixel by pixel', () => {
    const f = flat([255, 0, 0], 1920, 1080);
    const g = gamutShare(f.px, f.w, f.h, decode, to709('2020'), lin);
    expect(g.samples).toBeLessThanOrEqual(25_000);
    expect(g.samples).toBeGreaterThan(1000);
    expect(g.share).toBe(1);
  });
});
