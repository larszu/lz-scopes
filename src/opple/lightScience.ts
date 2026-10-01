// Light-meter maths for the light scopes (#11): u′v′, Planckian isotherms, "vectorscope of the
// light", mired and gel suggestions, comparison of two lights, measuring-grid statistics.
// Sources (all opened, see docs/research/opple-light-master.md, section "Ansichten"):
// - CIE 1976 u′v′ = 4X/(X+15Y+3Z), 9Y/(X+15Y+3Z), saturation s_uv = 13·√(Δu′² + Δv′²),
//   hue h_uv = atan2(Δv′, Δu′): Wikipedia "CIELUV" (citing CIE 15.2 and Poynton 2003).
// - mired M = 10⁶ K / T and the gel shift 10⁶/T_target − 10⁶/T_source: Wikipedia "Mired".
// - Gel mired values: "Mired Shift Gel Table", Dan Berens (PDF, danberens.co.uk), a secondary
//   table; the manufacturers' own data sheets were not opened.
// - Planckian locus: Krystek approximation in src/calib/colorimetry.ts.

import { cctDuv, planckUv } from '../calib/colorimetry';
import type { Reading } from './photometry';

export type XY = [number, number];

/** CIE 1976 UCS u′, v′ from xy. */
export function xyToUvPrime(x: number, y: number): [number, number] {
  const d = -2 * x + 12 * y + 3;
  return d === 0 ? [0, 0] : [(4 * x) / d, (9 * y) / d];
}
/** xy from CIE 1976 u′, v′. */
export function uvPrimeToXy(u: number, v: number): XY {
  const d = 6 * u - 16 * v + 12;
  return [(9 * u) / d, (4 * v) / d];
}
/** Chromaticity distance Δu′v′ between two xy points. */
export function deltaUvPrime(a: XY, b: XY) {
  const [ua, va] = xyToUvPrime(a[0], a[1]), [ub, vb] = xyToUvPrime(b[0], b[1]);
  return Math.hypot(ua - ub, va - vb);
}

/** Planckian radiator at T in xy (via CIE 1960 uv; u′ = u, v′ = 1.5 v). */
export function planckXy(T: number): XY {
  const [u, v] = planckUv(T), d = 2 * u - 8 * v + 4;
  return [(3 * u) / d, (2 * v) / d];
}

/**
 * Point on the isotherm of T at signed distance `duv` from the locus, in xy. The isotherm is the
 * normal to the locus in CIE 1960 uv (Robertson's construction); + = above the locus (greenish).
 */
export function isothermXy(T: number, duv: number): XY {
  const [u0, v0] = planckUv(T), [u1, v1] = planckUv(T * 1.0005);
  let nu = -(v1 - v0), nv = u1 - u0;
  const n = Math.hypot(nu, nv) || 1;
  nu /= n; nv /= n;
  if (nv < 0) { nu = -nu; nv = -nv; }
  const u = u0 + duv * nu, v = v0 + duv * nv, d = 2 * u - 8 * v + 4;
  return [(3 * u) / d, (2 * v) / d];
}

// ---------------------------------------------------------------- vectorscope of the light

export interface LightVector {
  /** hue angle in degrees, 0° = +u′ (reddish/warm side), counter-clockwise */
  hue: number;
  /** CIELUV saturation s_uv = 13·Δu′v′ (independent of the illuminance) */
  sat: number;
  du: number; dv: number;
}
/** Direction and saturation of a chromaticity relative to a reference white (CIELUV s_uv, h_uv). */
export function lightVector(xy: XY, ref: XY): LightVector {
  const [u, v] = xyToUvPrime(xy[0], xy[1]), [un, vn] = xyToUvPrime(ref[0], ref[1]);
  const du = u - un, dv = v - vn;
  return { hue: ((Math.atan2(dv, du) * 180) / Math.PI + 360) % 360, sat: 13 * Math.hypot(du, dv), du, dv };
}

// ---------------------------------------------------------------- mired and gels

export const mired = (T: number) => 1e6 / T;
/** Mired shift a gel must add to turn a source of T_source into T_target (+ = warmer/CTO, − = bluer/CTB). */
export const miredShift = (tSource: number, tTarget: number) => 1e6 / tTarget - 1e6 / tSource;

export interface Gel { maker: 'Lee' | 'Rosco'; name: string; mired: number }
/** CTO/CTB gels with their mired shift ("Mired Shift Gel Table", Dan Berens – secondary source). */
export const GELS: Gel[] = [
  { maker: 'Lee', name: '200 Double CT Blue', mired: -274 },
  { maker: 'Lee', name: '201 Full CT Blue', mired: -137 },
  { maker: 'Lee', name: '281 Three Quarter CT Blue', mired: -112 },
  { maker: 'Lee', name: '202 Half CT Blue', mired: -78 },
  { maker: 'Lee', name: '203 Quarter CT Blue', mired: -35 },
  { maker: 'Lee', name: '218 Eighth CT Blue', mired: -18 },
  { maker: 'Lee', name: '223 Eighth CT Orange', mired: 26 },
  { maker: 'Lee', name: '206 Quarter CT Orange', mired: 64 },
  { maker: 'Lee', name: '205 Half CT Orange', mired: 109 },
  { maker: 'Lee', name: '285 Three Quarter CT Orange', mired: 124 },
  { maker: 'Lee', name: '204 Full CT Orange', mired: 159 },
  { maker: 'Lee', name: '287 Double CT Orange', mired: 312 },
  { maker: 'Rosco', name: 'Cinegel 3220 Double CTB', mired: -260 },
  { maker: 'Rosco', name: 'Cinegel 3202 Full CTB', mired: -131 },
  { maker: 'Rosco', name: 'Cinegel 3203 3/4 CTB', mired: -100 },
  { maker: 'Rosco', name: 'Cinegel 3204 1/2 CTB', mired: -68 },
  { maker: 'Rosco', name: 'Cinegel 3206 1/3 CTB', mired: -49 },
  { maker: 'Rosco', name: 'Cinegel 3208 1/4 CTB', mired: -30 },
  { maker: 'Rosco', name: 'Cinegel 3216 1/8 CTB', mired: -12 },
  { maker: 'Rosco', name: 'Roscosun 3410 1/8 CTO', mired: 20 },
  { maker: 'Rosco', name: 'Roscosun 3409 1/4 CTO', mired: 42 },
  { maker: 'Rosco', name: 'Roscosun 3408 1/2 CTO', mired: 81 },
  { maker: 'Rosco', name: 'Roscosun 3411 3/4 CTO', mired: 131 },
  { maker: 'Rosco', name: 'Roscosun 3407 CTO', mired: 167 },
  { maker: 'Rosco', name: 'Roscosun 3420 Double CTO', mired: 320 },
];

export interface GelSuggestion { gels: Gel[]; mired: number; residual: number; resultK: number }

/**
 * Gels (one or two stacked, same maker) whose summed mired shift comes closest to `shift`.
 * Stacking adds the mired shifts – the reason the mired scale is used for gels.
 */
export function suggestGels(tSource: number, tTarget: number, maker: Gel['maker'] = 'Lee', n = 3): GelSuggestion[] {
  const shift = miredShift(tSource, tTarget);
  const list = GELS.filter((g) => g.maker === maker && Math.sign(g.mired) === Math.sign(shift));
  const combos: Gel[][] = list.map((g) => [g]);
  for (let i = 0; i < list.length; i++) for (let j = i; j < list.length; j++) combos.push([list[i], list[j]]);
  const src = mired(tSource);
  return combos
    .map((gels) => { const m = gels.reduce((a, g) => a + g.mired, 0); return { gels, mired: m, residual: shift - m, resultK: 1e6 / (src + m) }; })
    // prefer one gel when two are hardly better (≤ 3 mired)
    .sort((a, b) => Math.abs(a.residual) + (a.gels.length - 1) * 3 - (Math.abs(b.residual) + (b.gels.length - 1) * 3))
    .slice(0, n);
}

// ---------------------------------------------------------------- comparing two lights

export interface Comparison {
  /** Δu′v′ between the two chromaticities */
  duv: number;
  /** CCT (exact Planck search) of A and B, K */
  cctA: number; cctB: number;
  /** Duv of A and B (distance from the locus, CIE 1960) */
  duvA: number; duvB: number;
  /** mired shift that turns B into A's CCT (gel on B) */
  shift: number;
  /** illuminance ratio B/A in stops (log2) */
  stops: number;
  /** green/magenta: B minus A in Duv; > 0 → B is greener → Minus Green on B */
  dDuv: number;
  gels: GelSuggestion[];
}

/** Compare light B against reference A (gel suggestions are for B, to match A). */
export function compareLights(a: Reading, b: Reading, maker: Gel['maker'] = 'Lee'): Comparison {
  const ca = cctDuv([a.x, a.y]), cb = cctDuv([b.x, b.y]);
  const shift = miredShift(cb.cct, ca.cct);
  return {
    duv: deltaUvPrime([a.x, a.y], [b.x, b.y]), cctA: ca.cct, cctB: cb.cct, duvA: ca.duv, duvB: cb.duv, shift,
    stops: a.lux > 0 && b.lux > 0 ? Math.log2(b.lux / a.lux) : NaN,
    dDuv: cb.duv - ca.duv,
    gels: Math.abs(shift) < 5 ? [] : suggestGels(cb.cct, ca.cct, maker),
  };
}

/** Plain-language direction of a green/magenta difference (no gel strength: not documented). */
export function greenMagentaHint(dDuv: number) {
  if (Math.abs(dDuv) < 0.002) return 'Grün/Magenta passt (|ΔDuv| < 0,002)';
  return dDuv > 0 ? `B ist grüner (ΔDuv ${fmt(dDuv, 4)}) → Minus Green auf B` : `B ist magentastichiger (ΔDuv ${fmt(dDuv, 4)}) → Plus Green auf B`;
}
const fmt = (v: number, d: number) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d).replace('.', ',');

// ---------------------------------------------------------------- measuring grid

export interface GridCell { col: number; row: number; reading: Reading }
export interface GridStats {
  /** per cell: illuminance relative to the brightest cell, % */
  rel: Map<string, number>;
  /** per cell: Δu′v′ to the mean chromaticity */
  dUv: Map<string, number>;
  /** min/max illuminance ratio, % (uniformity) */
  uniformity: number;
  maxDuv: number; meanXy: XY; minLux: number; maxLux: number;
}
export const cellKey = (col: number, row: number) => `${col},${row}`;

export function gridStats(cells: GridCell[]): GridStats | null {
  if (!cells.length) return null;
  const lux = cells.map((c) => c.reading.lux), maxLux = Math.max(...lux), minLux = Math.min(...lux);
  // mean chromaticity from summed XYZ (weights brighter cells more, like one large measurement)
  const s = cells.reduce((a, c) => [a[0] + c.reading.X, a[1] + c.reading.Y, a[2] + c.reading.Z], [0, 0, 0]);
  const t = s[0] + s[1] + s[2];
  const meanXy: XY = t > 0 ? [s[0] / t, s[1] / t] : [0, 0];
  const rel = new Map<string, number>(), dUv = new Map<string, number>();
  for (const c of cells) {
    rel.set(cellKey(c.col, c.row), maxLux > 0 ? (c.reading.lux / maxLux) * 100 : 0);
    dUv.set(cellKey(c.col, c.row), deltaUvPrime([c.reading.x, c.reading.y], meanXy));
  }
  return { rel, dUv, uniformity: maxLux > 0 ? (minLux / maxLux) * 100 : 0, maxDuv: Math.max(...dUv.values()), meanXy, minLux, maxLux };
}

// ---------------------------------------------------------------- noise / repeatability

/** Mean, standard deviation and coefficient of variation of a series. */
export function seriesStats(values: number[]) {
  const n = values.length;
  if (!n) return { mean: NaN, sd: NaN, cv: NaN, n };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  return { mean, sd, cv: mean !== 0 ? sd / Math.abs(mean) : NaN, n };
}
