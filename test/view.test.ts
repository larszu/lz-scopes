import { describe, expect, it } from 'vitest';
import { IDENTITY, classifyWheel, clampView, intersect, isIdentity, panBy, pinchOf, viewClip, viewRect, waveRange, wheelFactor, zoomAt, zoomLabel, type ViewLimits } from '../src/view';
import { WAVE_ZOOMS, waveLevel, waveY } from '../src/graticule';
import { cubeProject, cubeRotation } from '../src/cube';

// Zoom/pan transform of the scope panels (#89). One rule, c′ = c·z + t in clip units, must give
// the same picture in the shader (viewClip), the overlay (viewRect) and the waveform range.

const r = { x: 44, y: 8, w: 600, h: 400 };
const XY: ViewLimits = { min: 1, max: 16, axes: 'xy', cover: true };
const FREE: ViewLimits = { min: 0.3, max: 8, axes: 'xy', cover: false };
const Y: ViewLimits = { min: 1, max: 20, axes: 'y', cover: true };

/** screen position of clip point c drawn into rect q (the overlay's mapping) */
const screen = (q: typeof r, cx: number, cy: number) => [q.x + ((cx + 1) / 2) * q.w, q.y + ((1 - cy) / 2) * q.h];

describe('viewRect = shader transform', () => {
  it('identity leaves the rect alone', () => {
    expect(viewRect(r, IDENTITY)).toEqual(r);
    expect(isIdentity(undefined)).toBe(true);
  });
  it('drawing into viewRect puts every point where the shader puts it', () => {
    const v = { z: 2.5, x: 0.4, y: -0.7 };
    for (const [cx, cy] of [[-1, -1], [0, 0], [0.3, -0.8], [1, 1]]) {
      const [sx, sy] = viewClip(v, cx, cy);
      const a = screen(viewRect(r, v), cx, cy), b = screen(r, sx, sy);
      expect(a[0]).toBeCloseTo(b[0], 9);
      expect(a[1]).toBeCloseTo(b[1], 9);
    }
  });
  it('3D volume: cubeProject with a view = viewClip of the plain projection', () => {
    const rot = cubeRotation(35, 25), v = { zoom: 2, panX: 0.3, panY: -0.2 };
    const q: [number, number, number] = [0.2, 0.7, 0.4];
    const plain = cubeProject(rot, q), viewed = cubeProject(rot, q, v);
    const [x, y] = viewClip({ z: 2, x: 0.3, y: -0.2 }, plain[0], plain[1]);
    expect(viewed[0]).toBeCloseTo(x, 9);
    expect(viewed[1]).toBeCloseTo(y, 9);
  });
});

describe('zoomAt keeps the point under the cursor', () => {
  for (const [px, py] of [[44, 8], [344, 208], [600, 100]]) {
    it(`cursor at ${px}, ${py}`, () => {
      const v0 = { z: 1.5, x: 0.2, y: 0.1 };
      const v1 = zoomAt(v0, r, px, py, 2, FREE);
      expect(v1.z).toBeCloseTo(3, 9);
      // content (clip units before the view) under the cursor, before and after
      const under = (v: typeof v0) => { const cx = ((px - r.x) / r.w) * 2 - 1, cy = 1 - ((py - r.y) / r.h) * 2; return [(cx - v.x) / v.z, (cy - v.y) / v.z]; };
      expect(under(v1)[0]).toBeCloseTo(under(v0)[0], 9);
      expect(under(v1)[1]).toBeCloseTo(under(v0)[1], 9);
    });
  }
  it('limits the factor', () => {
    expect(zoomAt(IDENTITY, r, 100, 100, 100, XY).z).toBe(16);
    expect(zoomAt(IDENTITY, r, 100, 100, 0.1, XY)).toEqual(IDENTITY);
    expect(zoomAt(IDENTITY, r, 100, 100, 0.1, FREE).z).toBeCloseTo(0.3);
  });
  it('waveforms zoom vertically only', () => {
    const v = zoomAt(IDENTITY, r, 100, 300, 4, Y);
    expect(v.x).toBe(0);
    expect(v.z).toBe(4);
  });
});

describe('clamp and pan', () => {
  it('cover: the zoomed plot always fills the panel', () => {
    const v = clampView({ z: 3, x: 5, y: -5 }, XY);
    expect(v).toEqual({ z: 3, x: 2, y: -2 });
    const q = viewRect(r, v);
    expect(q.x).toBeLessThanOrEqual(r.x + 1e-9);
    expect(q.x + q.w).toBeGreaterThanOrEqual(r.x + r.w - 1e-9);
    expect(q.y + q.h).toBeGreaterThanOrEqual(r.y + r.h - 1e-9);
  });
  it('unzoomed 2D scopes do not pan; the 3D volume does', () => {
    expect(panBy(IDENTITY, r, 50, 50, XY)).toEqual(IDENTITY);
    const v = panBy(IDENTITY, r, 60, -40, FREE);
    expect(v.x).toBeCloseTo(0.2); expect(v.y).toBeCloseTo(0.2);
  });
  it('a pan of d px moves the content by d px', () => {
    const v0 = { z: 4, x: 0, y: 0 };
    const v1 = panBy(v0, r, 30, -20, XY);
    const a = viewRect(r, v0), b = viewRect(r, v1);
    expect(b.x - a.x).toBeCloseTo(30, 9);
    expect(b.y - a.y).toBeCloseTo(-20, 9);
  });
});

describe('waveform range', () => {
  it('unzoomed: the preset range', () => {
    expect(waveRange(WAVE_ZOOMS.full, undefined)).toEqual([...WAVE_ZOOMS.full]);
    expect(waveRange(WAVE_ZOOMS.black, IDENTITY)).toEqual([...WAVE_ZOOMS.black]);
  });
  it('matches the level under the zoomed graticule', () => {
    const v = zoomAt(IDENTITY, r, 300, r.y + r.h - 20, 6, Y);
    const range = waveRange(WAVE_ZOOMS.full, v);
    // the view drawn with the full range into viewRect = the full plot drawn with `range`
    const q = viewRect(r, v);
    for (const level of [0, 0.02, 0.1]) {
      expect(waveY({ ...r, y: q.y, h: q.h }, level)).toBeCloseTo(waveY(r, level, range), 6);
    }
    // the level under the cursor did not move
    expect(waveLevel(r, r.y + r.h - 20, range)).toBeCloseTo(waveLevel(r, r.y + r.h - 20), 9);
    expect(range[1] - range[0]).toBeCloseTo((WAVE_ZOOMS.full[1] - WAVE_ZOOMS.full[0]) / 6, 9);
  });
});

describe('input', () => {
  it('wheel factor: symmetric, pinch steps finer per delta unit than notches', () => {
    expect(wheelFactor(-10, 0, true) * wheelFactor(10, 0, true)).toBeCloseTo(1, 12);
    expect(wheelFactor(-10, 0, true)).toBeGreaterThan(1);
    expect(wheelFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelFactor(1, 1, false)).toBeCloseTo(wheelFactor(8, 0, false), 12); // lines → px
    expect(wheelFactor(10000, 0, false)).toBeCloseTo(wheelFactor(50, 0, false), 12); // capped
  });
  it('classifies pinch, trackpad scroll and mouse wheel', () => {
    expect(classifyWheel({ ctrlKey: true, deltaX: 0, deltaY: 3.2, deltaMode: 0 })).toBe('pinch');
    expect(classifyWheel({ ctrlKey: false, deltaX: 0, deltaY: 3, deltaMode: 1 })).toBe('wheel');
    expect(classifyWheel({ ctrlKey: false, deltaX: 0, deltaY: 4, deltaMode: 0, wheelDeltaY: -12 })).toBe('pan');
    expect(classifyWheel({ ctrlKey: false, deltaX: 0, deltaY: 100, deltaMode: 0, wheelDeltaY: -120 })).toBe('wheel');
    expect(classifyWheel({ ctrlKey: false, deltaX: 0, deltaY: 40, deltaMode: 0, wheelDeltaY: -120 })).toBe('pan'); // −3 × deltaY
    expect(classifyWheel({ ctrlKey: false, deltaX: 0, deltaY: 7.5, deltaMode: 0, wheelDeltaY: -7 })).toBe('pan');
    expect(classifyWheel({ ctrlKey: false, deltaX: 2, deltaY: 0, deltaMode: 0 })).toBe('pan');
    expect(classifyWheel({ ctrlKey: false, deltaX: 0, deltaY: 100, deltaMode: 0 })).toBe('wheel');
    expect(classifyWheel({ ctrlKey: false, deltaX: 0, deltaY: 7.5, deltaMode: 0 })).toBe('pan');
  });
  it('pinch centre and distance; labels; intersect', () => {
    expect(pinchOf({ x: 0, y: 0 }, { x: 30, y: 40 })).toEqual({ cx: 15, cy: 20, d: 50 });
    expect(zoomLabel(2.345)).toBe('×2.3');
    expect(zoomLabel(12.6)).toBe('×13');
    expect(intersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toEqual({ x: 5, y: 5, w: 5, h: 5 });
    expect(intersect({ x: 0, y: 0, w: 1, h: 1 }, { x: 5, y: 5, w: 1, h: 1 })).toBeNull();
  });
});
