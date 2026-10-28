// Vectorscope by tonal range (#180): the picture's luma axis split into shadows, mids and
// highlights. The boundaries come from the panel, so they have to stay in order whatever the
// user types, and the outer bands have to keep sub-black and super-white.
import { describe, expect, it } from 'vitest';
import { vectorBandRects, vectorBands } from '../src/graticule';

describe('tonal ranges of the vectorscope', () => {
  it('splits the luma axis and keeps sub-black and super-white', () => {
    const [low, mid, high] = vectorBands([30, 70]);
    expect(low[1]).toBeCloseTo(0.3, 6);
    expect(mid).toEqual([0.3, 0.7]);
    expect(high[0]).toBeCloseTo(0.7, 6);
    // below black and above white stay in: they belong to the picture
    expect(low[0]).toBeLessThan(-0.1);
    expect(high[1]).toBeGreaterThan(1.09);
    // the three ranges touch without a gap and without overlap
    expect(low[1]).toBe(mid[0]);
    expect(mid[1]).toBe(high[0]);
  });

  it('boundaries in the wrong order or outside the range are corrected', () => {
    expect(vectorBands([70, 30])[1]).toEqual([0.7, 0.71]);
    expect(vectorBands([0, 500])[0][1]).toBeCloseTo(0.01, 6);
    expect(vectorBands([0, 500])[2][0]).toBe(1);
    expect(vectorBands()[1]).toEqual([0.3, 0.7]);
  });

  it('three circles side by side, one alone when enlarged', () => {
    const r = { x: 0, y: 0, w: 900, h: 320 };
    const three = vectorBandRects(r);
    expect(three).toHaveLength(3);
    // square, inside the panel, left to right, not overlapping
    for (const c of three) {
      expect(c.w).toBe(c.h);
      expect(c.x).toBeGreaterThanOrEqual(r.x);
      expect(c.x + c.w).toBeLessThanOrEqual(r.x + r.w + 1e-9);
      expect(c.y).toBeGreaterThanOrEqual(r.y);
      expect(c.y + c.h).toBeLessThanOrEqual(r.y + r.h + 1e-9);
    }
    expect(three[0].x + three[0].w).toBeLessThanOrEqual(three[1].x);
    expect(three[1].x + three[1].w).toBeLessThanOrEqual(three[2].x);
    // enlarged: one circle, bigger than the three together allow
    const big = vectorBandRects(r, 2);
    expect(big).toHaveLength(1);
    expect(big[0].w).toBeGreaterThan(three[0].w);
    // a narrow panel still gives a usable circle
    expect(vectorBandRects({ x: 0, y: 0, w: 120, h: 60 })[0].w).toBeGreaterThanOrEqual(10);
  });
});
