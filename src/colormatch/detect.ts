// Chart detection without a trained model: Otsu threshold on luma, connected regions of both
// polarities, holes filled, the largest region that does not touch the picture edge and fills
// its quadrilateral well is the chart. Corners = extreme points along x+y and x−y (TL, TR, BR,
// BL). Works for a chart with a frame or border that differs from the background; otherwise the
// corners are set by hand (chartUi.ts). Pure (test/colormatch-tool.test.ts).

import type { Frame, Pt } from '../led/analysis';

export interface Detection { corners: Pt[]; fill: number; aspect: number }

function otsu(y: Float32Array): number {
  const bins = 256, hist = new Array(bins).fill(0);
  for (const v of y) hist[Math.max(0, Math.min(bins - 1, Math.floor(v * (bins - 1))))]++;
  let sum = 0, sumB = 0, wB = 0, best = 0, thr = 0.5;
  hist.forEach((c, i) => { sum += i * c; });
  for (let i = 0; i < bins; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = y.length - wB; if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; thr = (i + 0.5) / (bins - 1); }
  }
  return thr;
}

const quadArea = (q: Pt[]) => Math.abs(q.reduce((s, [x, y], i) => { const [u, v] = q[(i + 1) % 4]; return s + x * v - u * y; }, 0)) / 2;

/** Corners of the chart, or null. `aspect`: expected width : height (rejects other shapes when given). */
export function detectChart(f: Frame, o: { aspect?: number; minArea?: number; minFill?: number } = {}): Detection | null {
  // work on at most ~320 px width
  const st = Math.max(1, Math.floor(f.width / 320)), W = Math.floor(f.width / st), H = Math.floor(f.height / st);
  const y = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = ((j * st) * f.width + i * st) * 3;
    y[j * W + i] = 0.2126 * f.rgb[k] + 0.7152 * f.rgb[k + 1] + 0.0722 * f.rgb[k + 2];
  }
  const thr = otsu(y), minArea = (o.minArea ?? 0.02) * W * H, minFill = o.minFill ?? 0.85;
  let best: Detection | null = null, bestArea = 0;
  for (const dark of [true, false]) {
    const fg = new Uint8Array(W * H);
    for (let i = 0; i < y.length; i++) fg[i] = (y[i] < thr) === dark ? 1 : 0;
    const label = new Int32Array(W * H).fill(-1);
    for (let s = 0; s < fg.length; s++) {
      if (!fg[s] || label[s] >= 0) continue;
      // region by flood fill
      const stack = [s], pix: number[] = [];
      label[s] = s;
      let edge = false;
      while (stack.length) {
        const p = stack.pop()!, px = p % W, py = (p / W) | 0;
        pix.push(p);
        if (px === 0 || py === 0 || px === W - 1 || py === H - 1) edge = true;
        for (const q of [px > 0 ? p - 1 : -1, px < W - 1 ? p + 1 : -1, py > 0 ? p - W : -1, py < H - 1 ? p + W : -1]) if (q >= 0 && fg[q] && label[q] < 0) { label[q] = s; stack.push(q); }
      }
      if (edge || pix.length < minArea / 4) continue;
      // corners from extreme points
      let tl = pix[0], tr = pix[0], br = pix[0], bl = pix[0];
      const sx = (p: number) => (p % W) + ((p / W) | 0), dx = (p: number) => (p % W) - ((p / W) | 0);
      for (const p of pix) { if (sx(p) < sx(tl)) tl = p; if (sx(p) > sx(br)) br = p; if (dx(p) > dx(tr)) tr = p; if (dx(p) < dx(bl)) bl = p; }
      const q: Pt[] = [tl, tr, br, bl].map((p) => [(p % W) + 0.5, ((p / W) | 0) + 0.5]);
      const area = quadArea(q);
      if (area < minArea) continue;
      // fill: region plus its holes inside the quadrilateral
      const minX = Math.min(...q.map((p) => p[0])) | 0, maxX = Math.ceil(Math.max(...q.map((p) => p[0]))), minY = Math.min(...q.map((p) => p[1])) | 0, maxY = Math.ceil(Math.max(...q.map((p) => p[1])));
      const bw = maxX - minX + 1, bh = maxY - minY + 1, out = new Uint8Array(bw * bh), st2: number[] = [];
      const mine = (x: number, yy: number) => label[yy * W + x] === s;
      for (let i = 0; i < bw; i++) for (const j of [0, bh - 1]) if (!mine(minX + i, minY + j)) { out[j * bw + i] = 1; st2.push(j * bw + i); }
      for (let j = 0; j < bh; j++) for (const i of [0, bw - 1]) if (!out[j * bw + i] && !mine(minX + i, minY + j)) { out[j * bw + i] = 1; st2.push(j * bw + i); }
      while (st2.length) {
        const p = st2.pop()!, px = p % bw, py = (p / bw) | 0;
        for (const [qx, qy] of [[px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]]) {
          if (qx < 0 || qy < 0 || qx >= bw || qy >= bh) continue;
          const qi = qy * bw + qx;
          if (!out[qi] && !mine(minX + qx, minY + qy)) { out[qi] = 1; st2.push(qi); }
        }
      }
      let filled = 0;
      for (let i = 0; i < out.length; i++) if (!out[i]) filled++;
      const fill = Math.min(filled, area) / Math.max(filled, area);
      const aspect = (Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) + Math.hypot(q[2][0] - q[3][0], q[2][1] - q[3][1])) / (Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]) + Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1]));
      if (fill < minFill) continue;
      if (o.aspect && Math.abs(Math.log(aspect / o.aspect)) > 0.35) continue;
      if (area > bestArea) { bestArea = area; best = { corners: q.map(([x, yy]) => [x * st, yy * st]), fill, aspect }; }
    }
  }
  return best;
}
