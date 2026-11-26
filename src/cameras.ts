// Cameras instead of inputs (#217): a camera is the picture one wants to measure – a whole input
// or a crop of it (one tile of a multiviewer). Pure geometry and pixel copies, no DOM
// (test/cameras.test.ts). The sources built on it live in src/derived.ts.

/** Share of the input picture, each 0…1: x, y, width, height. */
export type Frac = [number, number, number, number];
export const WHOLE: Frac = [0, 0, 1, 1];

/**
 * Multiviewer layouts offered by "Split …". All tiles keep the aspect of the whole picture
 * (a 16:9 multiviewer shows 16:9 tiles), so width and height shares are equal per tile.
 * ATEM multiviews are built from quadrants that are either one big tile or four small ones:
 * 2×2 (four big), 4×4 (all quadrants split) and 2+8 (top two big, bottom two split, the
 * ATEM default with preview/program on top). Videohub/Decimator monitors add 3×3 and 1+5.
 * Order: row by row, big tiles first.
 */
export const LAYOUTS = ['2x2', '3x3', '4x4', '2+8', '1+5'] as const;
export type LayoutId = (typeof LAYOUTS)[number];
export const LAYOUT_LABELS: Record<LayoutId, string> = { '2x2': '2×2', '3x3': '3×3', '4x4': '4×4', '2+8': '2 + 8', '1+5': '1 + 5' };

function grid(cols: number, rows: number, x0 = 0, y0 = 0, w = 1, h = 1): Frac[] {
  const out: Frac[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push([x0 + (c * w) / cols, y0 + (r * h) / rows, w / cols, h / rows]);
  return out;
}

/** Tiles of a layout as shares of the picture. */
export function layoutTiles(id: LayoutId): Frac[] {
  switch (id) {
    case '2x2': return grid(2, 2);
    case '3x3': return grid(3, 3);
    case '4x4': return grid(4, 4);
    // two big tiles on top, two quads of four below (row by row across both quads)
    case '2+8': return [...grid(2, 1, 0, 0, 1, 0.5), ...grid(4, 2, 0, 0.5, 1, 0.5)];
    // one big tile top left (2 × 2 cells of a 3 × 3 grid), five small ones around it
    case '1+5': return [[0, 0, 2 / 3, 2 / 3], [2 / 3, 0, 1 / 3, 1 / 3], [2 / 3, 1 / 3, 1 / 3, 1 / 3], ...grid(3, 1, 0, 2 / 3, 1, 1 / 3)];
  }
}

export const isLayout = (v: unknown): v is LayoutId => (LAYOUTS as readonly unknown[]).includes(v);

/** Border removed from every side of a tile by default (labels, tally frame, audio meters), share of the tile height. */
export const DEFAULT_INSET = 0.1;
export const MAX_INSET = 0.25;

/**
 * Crop in pixels of a `w × h` picture: [x, y, width, height], whole pixels, at least 2 × 2, inside
 * the picture. `inset` (share of the tile height) is taken off every side, the same number of
 * pixels left/right as top/bottom, so the tile keeps its shape.
 */
export function cropPixels(f: Frac, inset: number, w: number, h: number): [number, number, number, number] {
  let x0 = f[0] * w, y0 = f[1] * h, x1 = (f[0] + f[2]) * w, y1 = (f[1] + f[3]) * h;
  const d = Math.max(0, Math.min(MAX_INSET, inset || 0)) * (y1 - y0);
  x0 += d; x1 -= d; y0 += d; y1 -= d;
  const X0 = Math.max(0, Math.min(w - 2, Math.round(x0))), Y0 = Math.max(0, Math.min(h - 2, Math.round(y0)));
  const X1 = Math.max(X0 + 2, Math.min(w, Math.round(x1))), Y1 = Math.max(Y0 + 2, Math.min(h, Math.round(y1)));
  return [X0, Y0, X1 - X0, Y1 - Y0];
}

type Px = Uint8Array | Uint16Array;
/** New pixel array of the same type as `like`. */
const alike = (like: Px, n: number): Px => (like instanceof Uint16Array ? new Uint16Array(n) : new Uint8Array(n));

/** Copy the crop [x, y, w, h] of a picture with four values per pixel (RGBA or packed Y′CbCr). */
export function copyCrop(src: Px, srcW: number, [x, y, w, h]: [number, number, number, number]): Px {
  const out = alike(src, w * h * 4);
  for (let r = 0; r < h; r++) {
    const from = ((y + r) * srcW + x) * 4;
    out.set(src.subarray(from, from + w * 4), r * w * 4);
  }
  return out;
}

/**
 * The picture of an A/B split as one picture (#177): left of `pos` (share of the width) A, right
 * of it B scaled to A's size (nearest pixel, like the picture panel shows it, without filtering).
 * Both with four values per pixel and the same type.
 */
export function composeSplit(a: Px, aw: number, ah: number, b: Px, bw: number, bh: number, pos: number): Px {
  const out = alike(a, aw * ah * 4);
  const cut = Math.max(0, Math.min(aw, Math.round(pos * aw)));
  const same = aw === bw && ah === bh;
  const bx = same ? null : Int32Array.from({ length: aw }, (_, x) => Math.min(bw - 1, Math.floor(((x + 0.5) * bw) / aw)));
  for (let y = 0; y < ah; y++) {
    const row = y * aw * 4;
    out.set(a.subarray(row, row + cut * 4), row);
    if (same) { out.set(b.subarray(row + cut * 4, row + aw * 4), row + cut * 4); continue; }
    const brow = Math.min(bh - 1, Math.floor(((y + 0.5) * bh) / ah)) * bw * 4;
    for (let x = cut; x < aw; x++) {
      const o = row + x * 4, i = brow + bx![x] * 4;
      out[o] = b[i]; out[o + 1] = b[i + 1]; out[o + 2] = b[i + 2]; out[o + 3] = b[i + 3];
    }
  }
  return out;
}

/** One camera as saved: input by its place in the saved list, crop, border, tile label. */
export interface SavedCamera { parent: number; crop: Frac; inset: number; tile?: string }

const isFrac = (v: unknown): v is Frac => Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Clamp a saved camera (old saves, layout import); null when it cannot be used. */
export function sanitizeCamera(c: Partial<SavedCamera> | undefined): SavedCamera | null {
  if (!c || !Number.isInteger(c.parent) || (c.parent as number) < 0 || !isFrac(c.crop)) return null;
  const [x, y, w, h] = c.crop.map((n) => Math.max(0, Math.min(1, n)));
  if (w <= 0 || h <= 0) return null;
  return { parent: c.parent as number, crop: [x, y, Math.min(w, 1 - x), Math.min(h, 1 - y)], inset: Math.max(0, Math.min(MAX_INSET, Number(c.inset) || 0)), ...(typeof c.tile === 'string' ? { tile: c.tile } : {}) };
}

/** Is this crop the whole picture (a camera that is a whole input)? */
export const isWhole = (f: Frac) => f[0] <= 1e-6 && f[1] <= 1e-6 && f[2] >= 1 - 1e-6 && f[3] >= 1 - 1e-6;
