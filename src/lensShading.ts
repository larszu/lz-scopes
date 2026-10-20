// White shading of a flat white field, reusable core (idea 9, docs/research/lens-fingerprint.md).
// Pure functions, no DOM:
//   shadingGrid   cell means of R, G, B over the picture (or a region)
//   shadingFit    per channel, relative to the centre: saw H/V (linear) and parabola H/V
//                 (quadratic) after the camera controls named by Tektronix 25W-27159 and Sony
//                 "The Basics of Camera Technology" p. 10 (parabolic correction of lens fall-off)
//   centreColour  colour of the field centre as R/G and B/G (lens colour, white balance)
// Values are linear light when `linear` is passed (inverse BT.709 OETF), else code values.

import { bt709InverseOetf } from './color';

export interface ShadingGrid { nx: number; ny: number; /** nx·ny·3 means, row-major, R G B */ rgb: Float32Array }

export interface GridFrame { px: ArrayLike<number>; w: number; h: number; decode: (px: ArrayLike<number>, i: number) => [number, number, number] }

/** Cell means of R, G, B on an nx × ny grid inside [x0, y0, x1, y1] (fractions of the picture). */
export function shadingGrid(f: GridFrame, nx = 16, ny = 9, region: [number, number, number, number] = [0, 0, 1, 1], linear = false): ShadingGrid {
  const rgb = new Float32Array(nx * ny * 3), n = new Float32Array(nx * ny);
  const X0 = Math.floor(region[0] * f.w), X1 = Math.ceil(region[2] * f.w), Y0 = Math.floor(region[1] * f.h), Y1 = Math.ceil(region[3] * f.h);
  const step = Math.max(1, Math.floor(Math.sqrt(((X1 - X0) * (Y1 - Y0)) / (nx * ny * 64))));
  for (let y = Y0; y < Y1; y += step) for (let x = X0; x < X1; x += step) {
    const cx = Math.min(nx - 1, Math.floor(((x - X0) * nx) / (X1 - X0))), cy = Math.min(ny - 1, Math.floor(((y - Y0) * ny) / (Y1 - Y0)));
    const c = f.decode(f.px, (y * f.w + x) * 4), k = cy * nx + cx;
    for (let i = 0; i < 3; i++) rgb[k * 3 + i] += linear ? bt709InverseOetf(c[i]) : c[i];
    n[k]++;
  }
  for (let k = 0; k < nx * ny; k++) for (let i = 0; i < 3; i++) rgb[k * 3 + i] /= n[k] || 1;
  return { nx, ny, rgb };
}

export interface ChannelShading {
  /** level at the centre (fit), and in % of it: saw = change from the centre to the right/bottom edge (linear term), par = edges against the centre (quadratic term, + = edges brighter) */
  centre: number; sawH: number; sawV: number; parH: number; parV: number;
  /** RMS of what the four terms leave, % of the centre */
  rest: number;
}
export interface ShadingFit { r: ChannelShading; g: ChannelShading; b: ChannelShading; /** luma deviation from the centre per cell, % */ map: Float32Array; nx: number; ny: number }

/** Solve the 5×5 normal equations (Gaussian elimination). */
function solve5(A: number[][], b: number[]) {
  const n = 5, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return [0, 0, 0, 0, 0];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** Least-squares fit v = a + b·x + c·y + d·x² + e·y², x and y from −1 (left/top) to +1 over the cell centres. */
function fitChannel(g: ShadingGrid, ch: number): ChannelShading {
  const A = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]), b = [0, 0, 0, 0, 0];
  const pts: { f: number[]; v: number }[] = [];
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
    const x = g.nx > 1 ? (2 * (i + 0.5)) / g.nx - 1 : 0, y = g.ny > 1 ? (2 * (j + 0.5)) / g.ny - 1 : 0;
    const f = [1, x, y, x * x, y * y], v = g.rgb[(j * g.nx + i) * 3 + ch];
    pts.push({ f, v });
    for (let r = 0; r < 5; r++) { b[r] += f[r] * v; for (let c = 0; c < 5; c++) A[r][c] += f[r] * f[c]; }
  }
  const [a, sx, sy, px, py] = solve5(A, b);
  const pct = (v: number) => (a > 1e-9 ? (v / a) * 100 : NaN);
  let ss = 0;
  for (const p of pts) { const m = p.f.reduce((s, fi, k) => s + fi * [a, sx, sy, px, py][k], 0); ss += (p.v - m) ** 2; }
  return { centre: a, sawH: pct(sx), sawV: pct(sy), parH: pct(px), parV: pct(py), rest: pct(Math.sqrt(ss / pts.length)) };
}

export function shadingFit(g: ShadingGrid): ShadingFit {
  const r = fitChannel(g, 0), gg = fitChannel(g, 1), b = fitChannel(g, 2);
  const yc = 0.2126 * r.centre + 0.7152 * gg.centre + 0.0722 * b.centre;
  const map = new Float32Array(g.nx * g.ny);
  for (let k = 0; k < map.length; k++) {
    const y = 0.2126 * g.rgb[k * 3] + 0.7152 * g.rgb[k * 3 + 1] + 0.0722 * g.rgb[k * 3 + 2];
    map[k] = yc > 1e-9 ? (y / yc - 1) * 100 : NaN;
  }
  return { r, g: gg, b, map, nx: g.nx, ny: g.ny };
}

/** Colour of the field centre: R/G and B/G of the fitted centre levels. */
export const centreColour = (s: ShadingFit) => ({ rg: s.r.centre / s.g.centre, bg: s.b.centre / s.g.centre });

/** Synthetic white field (tests): per channel gain·(1 + saw·x + par·x² …) on a w × h RGBA 8-bit frame. */
export function syntheticField(w: number, h: number, ch: { gain: number; sawH?: number; sawV?: number; parH?: number; parV?: number }[]): GridFrame {
  const px = new Float32Array(w * h * 4);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
    const x = (2 * (xx + 0.5)) / w - 1, y = (2 * (yy + 0.5)) / h - 1;
    for (let c = 0; c < 3; c++) {
      const k = ch[c];
      px[(yy * w + xx) * 4 + c] = k.gain * (1 + (k.sawH ?? 0) * x + (k.sawV ?? 0) * y + (k.parH ?? 0) * x * x + (k.parV ?? 0) * y * y);
    }
  }
  return { px, w, h, decode: (p, i) => [p[i], p[i + 1], p[i + 2]] };
}
