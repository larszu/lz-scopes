// Where is the viewer in a capture of the DaVinci Resolve window? (#88)
//
// During playback LZ Scopes shows a live capture of the Resolve window, cropped to the viewer.
// The viewer is found by template matching: the last exact still from the scripting API (taken
// at the paused frame, i.e. what the viewer shows when playback starts) is searched in the
// window picture over position and size, with normalised cross-correlation of grey values.
// NCC ignores gain and offset, so the display colour management of the capture does not stop
// the match. Coarse search on a small picture, then refined on a larger one.

export interface Gray { w: number; h: number; px: Float32Array }
/** Found rectangle as fractions of the window picture, and the NCC score (−1…1). */
export interface ViewerRect { x: number; y: number; w: number; h: number; score: number }

/** Grey (mean of R, G, B; 0…1) of an RGBA picture, box-averaged down to width `w`. */
export function toGray(px: ArrayLike<number>, sw: number, sh: number, w: number, max = 255, read?: (i: number) => [number, number, number]): Gray {
  w = Math.max(1, Math.min(sw, Math.round(w)));
  const h = Math.max(1, Math.round((sh * w) / sw));
  const out = new Float32Array(w * h), n = new Float32Array(w * h);
  for (let y = 0; y < sh; y++) {
    const ty = Math.min(h - 1, Math.floor((y * h) / sh));
    for (let x = 0; x < sw; x++) {
      const tx = Math.min(w - 1, Math.floor((x * w) / sw)), i = (y * sw + x) * 4;
      const v = read ? read(i).reduce((a, b) => a + b, 0) / 3 : (px[i] + px[i + 1] + px[i + 2]) / (3 * max);
      out[ty * w + tx] += v; n[ty * w + tx]++;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] /= n[i] || 1;
  return { w, h, px: out };
}

/** Box-resample a grey picture to w × h. */
export function resample(g: Gray, w: number, h: number): Gray {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = (y * g.h) / h, y1 = ((y + 1) * g.h) / h;
    for (let x = 0; x < w; x++) {
      const x0 = (x * g.w) / w, x1 = ((x + 1) * g.w) / w;
      let s = 0, n = 0;
      for (let yy = Math.floor(y0); yy < Math.min(g.h, Math.ceil(y1)); yy++) for (let xx = Math.floor(x0); xx < Math.min(g.w, Math.ceil(x1)); xx++) { s += g.px[yy * g.w + xx]; n++; }
      out[y * w + x] = n ? s / n : 0;
    }
  }
  return { w, h, px: out };
}

/** NCC of template `t` placed at (x, y) in `hay`; flat regions score 0. */
function ncc(hay: Gray, t: Gray, x: number, y: number, tMean: number, tNorm: number): number {
  let sh = 0, sh2 = 0, sht = 0;
  for (let j = 0; j < t.h; j++) {
    const row = (y + j) * hay.w + x, trow = j * t.w;
    for (let i = 0; i < t.w; i++) { const a = hay.px[row + i], b = t.px[trow + i]; sh += a; sh2 += a * a; sht += a * b; }
  }
  const n = t.w * t.h, hMean = sh / n;
  const hVar = sh2 - n * hMean * hMean;
  if (hVar <= 1e-9 || tNorm <= 1e-9) return 0;
  return (sht - n * hMean * tMean) / Math.sqrt(hVar * tNorm);
}

function stats(t: Gray) {
  let s = 0; for (const v of t.px) s += v;
  const m = s / t.px.length;
  let v2 = 0; for (const v of t.px) v2 += (v - m) * (v - m);
  return { m, norm: v2 };
}

/** Best placement of `needle` (any size, aspect kept) in `hay` over the given widths and position ranges. */
function search(hay: Gray, needle: Gray, widths: number[], xr?: [number, number], yr?: [number, number], step = 1) {
  const aspect = needle.w / needle.h;
  let best = { x: 0, y: 0, w: 0, h: 0, score: -2 };
  for (const w of widths) {
    const h = Math.round(w / aspect);
    if (w < 4 || h < 4 || w > hay.w || h > hay.h) continue;
    const t = resample(needle, w, h), st = stats(t);
    const x0 = Math.max(0, xr?.[0] ?? 0), x1 = Math.min(hay.w - w, xr?.[1] ?? hay.w);
    const y0 = Math.max(0, yr?.[0] ?? 0), y1 = Math.min(hay.h - h, yr?.[1] ?? hay.h);
    for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step) {
      const s = ncc(hay, t, x, y, st.m, st.norm);
      if (s > best.score) best = { x, y, w, h, score: s };
    }
  }
  return best;
}

/**
 * Find the still in the window picture. `levels` is the same window picture at growing sizes
 * (e.g. 96, 320 and 960 px wide): full search on the first, refinement around the hit on the
 * others. `still` is the exact still in grey (any size, about 64 px wide is enough).
 * Returns null when nothing fits (score below `minScore`).
 */
export function findViewer(levels: Gray[], still: Gray, minScore = 0.6): ViewerRect | null {
  const coarse = levels[0];
  const widths: number[] = [];
  for (let w = Math.max(6, Math.round(coarse.w * 0.08)); w <= coarse.w; w++) widths.push(w);
  let b = search(coarse, still, widths);
  if (b.score < minScore * 0.8) return null;
  let at = coarse, best = { x: b.x / at.w, y: b.y / at.h, w: b.w / at.w, h: b.h / at.h, score: b.score };
  for (const fine of levels.slice(1)) {
    const k = fine.w / at.w, pad = Math.ceil(k * 1.5), cw = Math.round(b.w * k);
    const fw: number[] = [];
    for (let w = cw - pad; w <= cw + pad; w++) fw.push(w);
    const f = search(fine, still, fw, [Math.round(b.x * k) - pad, Math.round(b.x * k) + pad], [Math.round(b.y * k) - pad, Math.round(b.y * k) + pad]);
    if (f.score < b.score - 0.05) break;
    b = f; at = fine;
    best = { x: b.x / at.w, y: b.y / at.h, w: b.w / at.w, h: b.h / at.h, score: b.score };
  }
  return best.score >= minScore ? best : null;
}
