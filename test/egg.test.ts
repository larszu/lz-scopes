import { describe, expect, it } from 'vitest';
import { EGG_LEVELS, eggColumnLevels, smpteLzRaster } from '../src/egg';

describe('SMPTE 75 % (LZ) with the signature in the waveform', () => {
  const W = 1920, H = 1080, r = smpteLzRaster(W, H), bw = W / 7;
  it('bars, mid row and PLUGE carry the norm codes (75 % = 721, black 64, PLUGE 48/64/80/64/99/64)', () => {
    const top = [[721, 721, 721], [721, 721, 64], [64, 721, 721], [64, 721, 64], [721, 64, 721], [721, 64, 64], [64, 64, 721]];
    top.forEach((c, i) => expect(r.at(Math.round((i + 0.5) * bw), 300)).toEqual(c));
    expect(r.at(Math.round(1.5 * bw), 760)).toEqual([64, 64, 64]);
    const pw = bw / 3;
    [48, 64, 80, 64, 99, 64].forEach((c, i) => expect(r.at(Math.round(bw * 5 + (i + 0.5) * pw), 1000)).toEqual([c, c, c]));
    expect(r.at(Math.round(1.25 * bw * 1.5), 1000)).toEqual([940, 940, 940]);
  });
  it('the signature stays in the black field and below 4 % (code < 99), grey only', () => {
    const x0 = Math.round(1.25 * bw * 3), x1 = Math.round(bw * 5);
    let ink = 0;
    for (let x = 0; x < W; x++) {
      for (let y = 810; y < H; y += 7) {
        const [a, b, c] = r.at(x, y);
        if (x >= x0 && x < x1) { expect(a).toBeLessThan(99); expect(a).toBeGreaterThanOrEqual(64); expect(a).toBe(b); expect(b).toBe(c); if (a !== 64) ink++; }
      }
    }
    expect(ink).toBeGreaterThan(500);
    // outside the field nothing changed: top rows have no signature levels
    for (let x = 0; x < W; x += 13) expect(EGG_LEVELS.flat()).not.toContain(r.at(x, 100)[0]);
  });
  it('reading the waveform back: the column levels spell the glyphs ("L" = full left column on line 1)', () => {
    const cols = eggColumnLevels(10 * 6 * 4);
    const line1 = new Set(EGG_LEVELS[0]);
    // first ink column of line 1 is the stem of "L": all 7 rows
    const first = cols.find((c) => c.some((v) => line1.has(v)))!;
    expect(first.filter((v) => line1.has(v)).sort((a, b) => b - a)).toEqual(EGG_LEVELS[0]);
    // the bottom bar of "L" (row 6 only) follows
    expect(cols.some((c) => c.filter((v) => line1.has(v)).length === 1 && c.includes(EGG_LEVELS[0][6]))).toBe(true);
  });
});
