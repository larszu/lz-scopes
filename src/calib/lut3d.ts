// 3D-LUT (.cube) from verification measurements via a matrix/shaper display model:
//   XYZ(r, g, b) = K + M·[trc_r(r), trc_g(g), trc_b(b)]
// K = measured black, M = measured primaries minus black, per-channel curves from the grey ramp.
// Valid only for additive displays with independent channels; the model is checked against all
// measured patches first and no LUT is written if it does not fit (docs/research/display-kalibrierung.md).
// .cube layout per Adobe Cube LUT Specification 1.0 § 7.2 (red index changes fastest).

import { inv3, mul3 } from '../color';
import { patchDelta, stats, targetXyz, whiteXyz, type Stats, type Target, type XYZ } from './colorimetry';
import type { TestSet } from './testsets';

type Curve = { x: number[]; y: number[] };
export interface DisplayModel { black: XYZ; m: number[]; mInv: number[]; trc: [Curve, Curve, Curve] }

/** Model fit limits (own choice): mean ΔE00 ≤ 1.5 and 95th percentile ≤ 3 over the measured patches. */
export const MODEL_LIMITS = { mean: 1.5, p95: 3 };

const same = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
function reading(set: TestSet, readings: (XYZ | null)[], rgb: number[]) {
  const i = set.patches.findIndex((p) => same(p.rgb, rgb));
  return i >= 0 ? readings[i] : null;
}

/** Piecewise linear, monotone (non-decreasing) curve evaluation and inverse. */
function evalCurve(c: Curve, x: number) {
  const { x: xs, y: ys } = c;
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
}
function invertCurve(c: Curve, y: number) {
  const { x: xs, y: ys } = c;
  if (y <= ys[0]) return xs[0];
  for (let i = 1; i < xs.length; i++) {
    if (y <= ys[i]) return ys[i] === ys[i - 1] ? xs[i - 1] : xs[i - 1] + ((xs[i] - xs[i - 1]) * (y - ys[i - 1])) / (ys[i] - ys[i - 1]);
  }
  return xs[xs.length - 1];
}

export function fitModel(set: TestSet, readings: (XYZ | null)[]): DisplayModel | string {
  const K = reading(set, readings, [0, 0, 0]);
  const R = reading(set, readings, [1, 0, 0]), G = reading(set, readings, [0, 1, 0]), B = reading(set, readings, [0, 0, 1]);
  if (!K || !R || !G || !B) return 'Für das Modell fehlen Messungen von Schwarz, Rot, Grün und Blau (je 100 %).';
  const col = (p: XYZ) => p.map((v, i) => v - K[i]);
  const [r, g, b] = [col(R), col(G), col(B)];
  const m = [r[0], g[0], b[0], r[1], g[1], b[1], r[2], g[2], b[2]];
  const mInv = inv3(m);
  if (!mInv.every(Number.isFinite)) return 'Primärfarben-Matrix ist nicht invertierbar.';
  const greys = set.patches.map((p, i) => ({ v: p.rgb[0], xyz: readings[i] })).filter((p, i) => set.patches[i].kind === 'grey' && p.xyz)
    .sort((a, b2) => a.v - b2.v);
  if (greys.length < 5) return 'Für die Kanalkurven werden mindestens 5 gemessene Graustufen gebraucht.';
  const trc = [0, 1, 2].map((ch) => {
    const x = [0], y = [0];
    for (const p of greys) {
      if (p.v <= 0) continue;
      const lin = mul3(mInv, col(p.xyz!))[ch];
      x.push(p.v); y.push(Math.max(y[y.length - 1], lin)); // enforce monotone
    }
    return { x, y };
  }) as [Curve, Curve, Curve];
  return { black: K, m, mInv, trc };
}

export function predict(model: DisplayModel, rgb: number[]): XYZ {
  const lin = rgb.map((v, i) => evalCurve(model.trc[i], v));
  return mul3(model.m, lin).map((v, i) => v + model.black[i]) as XYZ;
}

/** Model error over all measured patches (ΔE00, Lab relative to the measured white). */
export function modelError(model: DisplayModel, set: TestSet, readings: (XYZ | null)[]): Stats {
  const white = predict(model, [1, 1, 1]);
  return stats(set.patches.map((p, i) => (readings[i] ? patchDelta(readings[i]!, predict(model, p.rgb), white).dE00 : NaN)));
}

export interface CubeResult { text: string; clipped: number; whiteScale: number; error: Stats }

/**
 * .cube mapping target-space signal (e.g. Rec.709/BT.1886) → display code values, so the display
 * shows the target. SDR only. Returns an explanation string when the model is not good enough.
 */
export function buildCube(set: TestSet, readings: (XYZ | null)[], target: Target, size: 33 | 65): CubeResult | string {
  if (target.transfer === 'pq') return 'Für PQ/HDR wird keine LUT erzeugt (Modell nur für SDR geprüft).';
  const model = fitModel(set, readings);
  if (typeof model === 'string') return model;
  const error = modelError(model, set, readings);
  if (!(error.mean <= MODEL_LIMITS.mean && error.p95 <= MODEL_LIMITS.p95)) {
    return `Displaymodell passt nicht (Modellfehler ΔE00 Mittel ${error.mean.toFixed(2)}, 95 % ${error.p95.toFixed(2)}; Grenze ${MODEL_LIMITS.mean}/${MODEL_LIMITS.p95}). Display ist vermutlich nicht additiv (ABL, Dynamik-Modus) – keine LUT erzeugt.`;
  }
  const lb = model.black[1];
  const toLin = (xyz: number[]) => mul3(model.mInv, xyz.map((v, i) => v - model.black[i]));
  // Full-white luminance at the target chromaticity: lower Lw until no channel exceeds 1.
  const wFull = predict(model, [1, 1, 1])[1];
  const whiteLin = toLin(whiteXyz(target.white, wFull));
  const whiteScale = Math.min(1, 1 / Math.max(...whiteLin.map((v, i) => v / evalCurve(model.trc[i], 1))));
  const lw = lb + (wFull - lb) * whiteScale;
  const n = size, lines: string[] = [];
  let clipped = 0;
  for (let bi = 0; bi < n; bi++) for (let gi = 0; gi < n; gi++) for (let ri = 0; ri < n; ri++) {
    const src = [ri / (n - 1), gi / (n - 1), bi / (n - 1)];
    const lin = toLin(targetXyz(src, target, lw, lb));
    let clip = false;
    const out = lin.map((v, ch) => {
      const top = evalCurve(model.trc[ch], 1);
      if (v < -1e-6 || v > top + 1e-6) clip = true;
      return invertCurve(model.trc[ch], Math.max(0, Math.min(top, v)));
    });
    if (clip) clipped++;
    lines.push(out.map((v) => v.toFixed(6)).join(' '));
  }
  // red index changes fastest: the loop above has red innermost
  const head = [
    `TITLE "LZ Scopes Display-Korrektur ${size}"`,
    '# Erzeugt von LZ Scopes aus Verifikationsmessungen (Matrix/Shaper-Modell)',
    `# Ziel: ${target.transfer} / Gamut ${target.gamut} / Weiß xy ${target.white.join(' ')}`,
    `# Messsatz: ${set.name}; Modellfehler dE00 Mittel ${error.mean.toFixed(3)} Max ${error.max.toFixed(3)} P95 ${error.p95.toFixed(3)}`,
    `# Weiß ${lw.toFixed(2)} cd/m2 (Faktor ${whiteScale.toFixed(4)}), Schwarz ${lb.toFixed(4)} cd/m2; geclippt ${clipped} von ${n ** 3} Stützstellen`,
    '# Eingang: Signal im Zielraum (Full Range 0..1), Ausgang: Display-Codewerte (Full Range 0..1)',
    `LUT_3D_SIZE ${n}`,
  ];
  return { text: `${head.join('\n')}\n${lines.join('\n')}\n`, clipped, whiteScale, error };
}
