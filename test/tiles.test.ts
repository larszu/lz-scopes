import { describe, expect, it } from 'vitest';
import { MAX_TILES, TILE_GAP, TILE_HEAD, sanitizeTiles, tileAt, tileGrid, tileLabel, tileSources } from '../src/tiles';

describe('tile grid', () => {
  it('four 16:9 waveforms on a 16:9 body form 2 × 2', () => {
    const c = tileGrid(4, 1600, 900);
    expect(new Set(c.map((r) => r.x)).size).toBe(2);
    expect(new Set(c.map((r) => r.y)).size).toBe(2);
  });
  it('on a wide strip the tiles stand in one row, on a tall phone in one column', () => {
    expect(new Set(tileGrid(4, 2000, 300).map((r) => r.y)).size).toBe(1);
    expect(new Set(tileGrid(4, 380, 1600).map((r) => r.x)).size).toBe(1);
  });
  it('tiles never overlap and stay inside the body, with the gap between them', () => {
    for (const n of [1, 2, 3, 5, 6, 7, 8]) for (const [w, h] of [[1280, 720], [390, 700], [800, 800]]) {
      const c = tileGrid(n, w, h);
      expect(c).toHaveLength(n);
      for (const r of c) { expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0); expect(r.x + r.w).toBeLessThanOrEqual(w + 1e-6); expect(r.y + r.h).toBeLessThanOrEqual(h + 1e-6); }
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = c[i], b = c[j];
        const apart = a.x + a.w + TILE_GAP - 1e-6 <= b.x || b.x + b.w + TILE_GAP - 1e-6 <= a.x || a.y + a.h + TILE_GAP - 1e-6 <= b.y || b.y + b.h + TILE_GAP - 1e-6 <= a.y;
        expect(apart, `${n} tiles ${w}×${h}: ${i}/${j}`).toBe(true);
      }
    }
  });
  it('the grid follows the plot aspect: six vectorscopes 3 × 2, six waveforms 2 × 3 on a 3:2 body', () => {
    const cols = (asp: number) => new Set(tileGrid(6, 1200, 800, asp).map((r) => r.x)).size;
    expect(cols(1)).toBe(3);
    expect(cols(16 / 9)).toBe(2);
    // every tile leaves room for the ID strip
    expect(Math.min(...tileGrid(8, 600, 400).map((r) => r.h))).toBeGreaterThan(TILE_HEAD);
  });
  it('finds the tile under a point', () => {
    const c = tileGrid(4, 1000, 600);
    expect(tileAt(c, c[3].x + 5, c[3].y + 5)).toBe(3);
    expect(tileAt(c, -1, 5)).toBe(-1);
  });
});

describe('tile sources', () => {
  const all = Array.from({ length: 10 }, (_, i) => ({ id: `s${i + 1}` }));
  it('without a choice the first eight', () => {
    expect(tileSources(all, []).map((s) => s.id)).toEqual(all.slice(0, MAX_TILES).map((s) => s.id));
  });
  it('the chosen ones in the chosen order, missing ones dropped', () => {
    expect(tileSources(all, ['s3', 'gone', 's1']).map((s) => s.id)).toEqual(['s3', 's1']);
  });
  it('camera ID and sanitising', () => {
    expect(tileLabel(0, 'Cam A')).toBe('1 · Cam A');
    expect(sanitizeTiles({ scope: 'cube' as never, sources: ['a', 3 as never] })).toEqual({ scope: 'wf-luma', sources: ['a'] });
  });
});
