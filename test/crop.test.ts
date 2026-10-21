import { describe, expect, it } from 'vitest';
import { cropPlan, fitBox, regionOf, regionRect, type Box } from '../src/match/crop';

/** Picture fraction shown at screen x of a picture drawn into `rect` (mirrored: read right to left). */
const fracAt = (rect: Box, x: number, mirror: boolean) => { const u = (x - rect.x) / rect.w; return mirror ? 1 - u : u; };

describe('crop comparison and butterfly split', () => {
  it('region fills the target exactly, also mirrored', () => {
    const t = { x: 100, y: 50, w: 200, h: 100 }, r: [number, number, number, number] = [0.25, 0.4, 0.5, 0.6];
    const a = regionRect(t, r);
    expect(fracAt(a, t.x, false)).toBeCloseTo(0.25); expect(fracAt(a, t.x + t.w, false)).toBeCloseTo(0.5);
    expect((t.y - a.y) / a.h).toBeCloseTo(0.4); expect((t.y + t.h - a.y) / a.h).toBeCloseTo(0.6);
    const m = regionRect(t, r, true);
    expect(fracAt(m, t.x, true)).toBeCloseTo(0.5); expect(fracAt(m, t.x + t.w, true)).toBeCloseTo(0.25);
  });

  it('fitBox keeps the aspect and centres', () => {
    expect(fitBox({ x: 0, y: 0, w: 400, h: 100 }, 2)).toEqual({ x: 100, y: 0, w: 200, h: 100 });
  });

  it('regionOf: first region as fractions, whole picture without one', () => {
    expect(regionOf([[192, 108, 960, 540]], 1920, 1080)).toEqual([0.1, 0.1, 0.5, 0.5]);
    expect(regionOf([], 1920, 1080)).toEqual([0, 0, 1, 1]);
  });

  it('butterfly: A left half, B mirrored so its left half meets A in the middle', () => {
    const box = { x: 0, y: 0, w: 800, h: 400 };
    const p = cropPlan('butterfly', box, [0.4, 0.2, 0.6, 0.6], [1920, 1080], [0.1, 0.3, 0.3, 0.7], [1920, 1080]);
    expect(p.divider).toBeCloseTo(p.a.clip.x + p.a.clip.w);
    // at the divider both sides show the centre of their face
    expect(fracAt(p.a.rect, p.divider, false)).toBeCloseTo(0.5);
    expect(fracAt(p.b.rect, p.divider, true)).toBeCloseTo(0.2);
    // right edge of the butterfly shows B's left region edge
    expect(fracAt(p.b.rect, p.b.clip.x + p.b.clip.w, true)).toBeCloseTo(0.1);
  });

  it('crop: two halves, each region fitted to its own aspect', () => {
    const p = cropPlan('crop', { x: 0, y: 0, w: 800, h: 300 }, [0, 0, 0.5, 0.5], [1920, 1080], [0.5, 0.5, 1, 1], [1280, 720]);
    expect(p.a.clip.x + p.a.clip.w).toBeLessThanOrEqual(400.0001);
    expect(p.b.clip.x).toBeGreaterThanOrEqual(400);
    expect(p.a.clip.w / p.a.clip.h).toBeCloseTo(16 / 9);
    expect(fracAt(p.b.rect, p.b.clip.x, false)).toBeCloseTo(0.5);
  });
});
