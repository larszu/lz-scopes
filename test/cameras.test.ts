import { describe, expect, it } from 'vitest';
import { DEFAULT_INSET, LAYOUTS, WHOLE, composeSplit, copyCrop, cropPixels, isWhole, layoutTiles, sanitizeCamera } from '../src/cameras';
import { CameraSource, SplitSource } from '../src/derived';
import { Source } from '../src/sources';

/** RGBA picture whose pixel (x, y) holds x in R, y in G, `tag` in B. */
function picture(w: number, h: number, tag = 0, T: typeof Uint8Array | typeof Uint16Array = Uint8Array) {
  const px = new T(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; px[i] = x; px[i + 1] = y; px[i + 2] = tag; px[i + 3] = 255; }
  return px;
}
/** A source with a bridge-like picture in `data`, ready and live. */
function input(w: number, h: number, tag = 0, T: typeof Uint8Array | typeof Uint16Array = Uint8Array) {
  const s = new Source('stream', `in${tag}`);
  s.data = picture(w, h, tag, T); s.width = w; s.height = h; s.depth = T === Uint16Array ? 16 : 8; s.status = 'live'; s.frameSeq = 1;
  return s;
}

describe('multiviewer layouts', () => {
  it('every layout covers the picture once: tiles inside, no overlap, areas add up to 1', () => {
    for (const id of LAYOUTS) {
      const tiles = layoutTiles(id);
      const area = tiles.reduce((a, [, , w, h]) => a + w * h, 0);
      expect(area, id).toBeCloseTo(1, 9);
      for (const [x, y, w, h] of tiles) { expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0); expect(x + w).toBeLessThanOrEqual(1 + 1e-9); expect(y + h).toBeLessThanOrEqual(1 + 1e-9); }
      for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
        const a = tiles[i], b = tiles[j];
        const apart = a[0] + a[2] <= b[0] + 1e-9 || b[0] + b[2] <= a[0] + 1e-9 || a[1] + a[3] <= b[1] + 1e-9 || b[1] + b[3] <= a[1] + 1e-9;
        expect(apart, `${id} ${i}/${j}`).toBe(true);
      }
    }
  });
  it('tiles keep the picture aspect (equal width and height shares)', () => {
    for (const id of LAYOUTS) for (const [, , w, h] of layoutTiles(id)) expect(w).toBeCloseTo(h, 9);
  });
  it('tile counts: 4, 9, 16, 2 + 8 (big ones first), 1 + 5', () => {
    expect(LAYOUTS.map((id) => layoutTiles(id).length)).toEqual([4, 9, 16, 10, 6]);
    const atem = layoutTiles('2+8');
    expect(atem[0]).toEqual([0, 0, 0.5, 0.5]);
    expect(atem[1]).toEqual([0.5, 0, 0.5, 0.5]);
    expect(atem[2]).toEqual([0, 0.5, 0.25, 0.25]);
  });
});

describe('crop in pixels', () => {
  it('2×2 of 1920×1080: 960×540 tiles; the border is a share of the tile height on every side', () => {
    expect(cropPixels([0.5, 0.5, 0.5, 0.5], 0, 1920, 1080)).toEqual([960, 540, 960, 540]);
    // 10 % of 540 = 54 px off every side
    expect(cropPixels([0, 0, 0.5, 0.5], DEFAULT_INSET, 1920, 1080)).toEqual([54, 54, 852, 432]);
  });
  it('stays inside the picture and at least 2 × 2', () => {
    expect(cropPixels([0.99, 0.99, 0.01, 0.01], 0.25, 100, 100)).toEqual([98, 98, 2, 2]);
    expect(cropPixels(WHOLE, 0, 7, 5)).toEqual([0, 0, 7, 5]);
  });
  it('copies exactly the crop, 8 and 16 bit', () => {
    for (const T of [Uint8Array, Uint16Array]) {
      const out = copyCrop(picture(16, 8, 3, T), 16, [4, 2, 5, 3]);
      expect(out).toBeInstanceOf(T);
      expect(out.length).toBe(5 * 3 * 4);
      expect([out[0], out[1], out[2]]).toEqual([4, 2, 3]);
      const last = (2 * 5 + 4) * 4;
      expect([out[last], out[last + 1]]).toEqual([8, 4]);
    }
  });
});

describe('A/B split as one picture (#177)', () => {
  it('left of the line A, right of it B; same size copies B unchanged', () => {
    const out = composeSplit(picture(10, 4, 1), 10, 4, picture(10, 4, 2), 10, 4, 0.3);
    for (let x = 0; x < 10; x++) { const i = (2 * 10 + x) * 4; expect(out[i + 2], `x ${x}`).toBe(x < 3 ? 1 : 2); expect(out[i]).toBe(x); }
  });
  it('B of another size is scaled to A (nearest pixel)', () => {
    const out = composeSplit(picture(8, 4, 1), 8, 4, picture(4, 2, 2), 4, 2, 0.5);
    const i = (3 * 8 + 7) * 4; // bottom right → B (3, 1)
    expect([out[i], out[i + 1], out[i + 2]]).toEqual([3, 1, 2]);
  });
  it('line at the edges: all A or all B', () => {
    const a = picture(6, 2, 1), b = picture(6, 2, 2);
    expect(composeSplit(a, 6, 2, b, 6, 2, 1).every((v, i) => v === a[i])).toBe(true);
    expect(composeSplit(a, 6, 2, b, 6, 2, 0).every((v, i) => v === b[i])).toBe(true);
  });
});

describe('saved cameras', () => {
  it('keeps valid entries, clamps crop and border, drops broken ones', () => {
    expect(sanitizeCamera({ parent: 0, crop: [0.5, 0.5, 0.5, 0.5], inset: 0.1, tile: '2×2 · 4' })).toEqual({ parent: 0, crop: [0.5, 0.5, 0.5, 0.5], inset: 0.1, tile: '2×2 · 4' });
    const c = sanitizeCamera({ parent: 1, crop: [0.8, 0, 0.5, 2], inset: 3 })!;
    expect(c.crop[2]).toBeCloseTo(0.2, 9);
    expect([c.parent, c.crop[0], c.crop[1], c.crop[3], c.inset]).toEqual([1, 0.8, 0, 1, 0.25]);
    expect(sanitizeCamera({ parent: -1, crop: WHOLE, inset: 0 })).toBeNull();
    expect(sanitizeCamera({ parent: 0, crop: [0, 0, 0, 1] as never, inset: 0 })).toBeNull();
    expect(sanitizeCamera(undefined)).toBeNull();
    expect(isWhole(WHOLE)).toBe(true);
    expect(isWhole([0, 0, 0.5, 0.5])).toBe(false);
  });
});

describe('camera source (#217)', () => {
  it('takes its tile from the input at every new picture, with the input decoding', () => {
    const mv = input(64, 36, 7, Uint16Array);
    mv.settings.transfer = 'hlg';
    const cam = new CameraSource(mv, layoutTiles('2x2')[3], 0, 'Kam 4', '2×2 · 4');
    cam.sync();
    expect(cam.status).toBe('live');
    expect([cam.width, cam.height, cam.depth]).toEqual([32, 18, 16]);
    expect([cam.data![0], cam.data![1], cam.data![2]]).toEqual([32, 18, 7]);
    expect(cam.transfer).toBe('hlg');
    expect(cam.fromTile).toBe(true);
    expect(cam.cropSize).toEqual([32, 18]);
    const seq = cam.frameSeq;
    cam.sync();
    expect(cam.frameSeq, 'no new picture, no new frame').toBe(seq);
    mv.frameSeq++;
    cam.sync();
    expect(cam.frameSeq).toBe(seq + 1);
  });
  it('re-hung on a direct input it becomes the whole picture, name kept', () => {
    const mv = input(64, 36, 1), sdi = input(20, 10, 2);
    const cam = new CameraSource(mv, layoutTiles('2x2')[0], 0.1, 'Totale');
    cam.sync();
    cam.rehang(sdi);
    cam.sync();
    expect([cam.name, cam.width, cam.height, cam.fromTile]).toEqual(['Totale', 20, 10, false]);
    expect(cam.data![2]).toBe(2);
  });
  it('without a picture of the input it has none either', () => {
    const mv = new Source('stream', 'mv');
    const cam = new CameraSource(mv, WHOLE);
    cam.sync();
    expect(cam.ready).toBe(false);
  });
  it('a frozen camera keeps its picture', () => {
    const mv = input(8, 8, 1);
    const cam = new CameraSource(mv, WHOLE);
    cam.sync();
    cam.frozen = true;
    mv.data = picture(8, 8, 9); mv.frameSeq++;
    cam.sync();
    expect(cam.data![2]).toBe(1);
  });
});

describe('split source (#177)', () => {
  it('composes A | B with A’s decoding and a fixed id per panel', () => {
    const a = input(10, 4, 1), b = input(10, 4, 2);
    a.settings.colorspace = '2020';
    const sp = new SplitSource(0);
    expect(sp.id).toBe('split1');
    sp.input = { a, b, pos: 0.5, stageB: false };
    sp.sync();
    expect(sp.status).toBe('live');
    expect(sp.colorspace).toBe('2020');
    expect(sp.data![(0 * 10 + 9) * 4 + 2]).toBe(2);
    expect(sp.data![2]).toBe(1);
  });
  it('honest when it cannot: stage as B, different formats', () => {
    const a = input(10, 4, 1), b16 = input(10, 4, 2, Uint16Array);
    const sp = new SplitSource(1);
    sp.input = { a, b: null, pos: 0.5, stageB: true };
    sp.sync();
    expect([sp.status, sp.ready]).toEqual(['error', false]);
    sp.input = { a, b: b16, pos: 0.5, stageB: false };
    sp.sync();
    expect([sp.status, sp.ready]).toEqual(['error', false]);
  });
});
