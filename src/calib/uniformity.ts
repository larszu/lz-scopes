// Uniformity evaluation (procedure as in DisplayCAL report/uniformity.functions.js, rewritten):
// reference = centre cell; Lab of every cell relative to the centre's white; ΔE00 to the centre at
// the same level; luminance deviation; contrast deviation T = |R/R_ref − 1| with R = Y50/Y100.
// Limits "ISO 14861" as quoted by DisplayCAL (ΔE00 ≤ 4 shall, ≤ 2 should; T < 0.1). The ISO text
// itself was not accessible, see docs/research/display-kalibrierung.md.

import { deltaE2000, xyzToLab } from '../color';
import { cctDuv, xyzToXy, type XYZ } from './colorimetry';
import { UNIFORMITY_LEVELS } from './testsets';

export const UNIFORMITY_LIMITS = { dE00: { nominal: 4, recommended: 2 }, contrastT: 0.1 } as const;

export interface UniformityCell {
  row: number; col: number;
  /** per level (UNIFORMITY_LEVELS order) */
  dE00: number[]; lumDev: number[];
  cct: number | null; contrastT: number | null;
  grade: 'gut' | 'ok' | 'aus';
}
export interface UniformityReport {
  n: number; levels: number[]; cells: UniformityCell[]; maxDE00: number; maxT: number;
  grade: 'gut' | 'ok' | 'aus'; contrastOk: boolean; warnings: string[]; date: string;
}

/** @param readings [cellIndex][levelIndex] absolute XYZ, cells row by row, n odd */
export function evaluateUniformity(n: number, readings: XYZ[][], levels = UNIFORMITY_LEVELS): UniformityReport {
  const warnings: string[] = [];
  if (n % 2 === 0) throw new Error('Raster braucht ein Mittelfeld (ungerade Anzahl)');
  if (n < 5) warnings.push('ISO 14861 verlangt laut DisplayCAL mindestens ein 5×5-Raster.');
  const ref = readings[(n * n - 1) / 2];
  const refWhite = ref[0];
  const half = levels.indexOf(0.5);
  const ratio = (c: XYZ[]) => (half >= 0 && c[0][1] > 0 ? c[half][1] / c[0][1] : NaN);
  const rRef = ratio(ref);
  const cells: UniformityCell[] = readings.map((c, i) => {
    const dE00 = c.map((xyz, l) => deltaE2000(xyzToLab(ref[l], refWhite), xyzToLab(xyz, refWhite)));
    const lumDev = c.map((xyz, l) => (xyz[1] / ref[l][1] - 1) * 100);
    const T = Number.isFinite(rRef) ? Math.abs(ratio(c) / rRef - 1) : null;
    const m = Math.max(...dE00);
    return {
      row: Math.floor(i / n), col: i % n, dE00, lumDev,
      cct: c[0][1] > 0 ? cctDuv(xyzToXy(c[0])).cct : null, contrastT: T,
      grade: m <= UNIFORMITY_LIMITS.dE00.recommended ? 'gut' : m <= UNIFORMITY_LIMITS.dE00.nominal ? 'ok' : 'aus',
    };
  });
  const maxDE00 = Math.max(...cells.flatMap((c) => c.dE00));
  const maxT = Math.max(...cells.map((c) => c.contrastT ?? 0));
  return {
    n, levels, cells, maxDE00, maxT, warnings, date: new Date().toISOString(),
    grade: maxDE00 <= UNIFORMITY_LIMITS.dE00.recommended ? 'gut' : maxDE00 <= UNIFORMITY_LIMITS.dE00.nominal ? 'ok' : 'aus',
    contrastOk: maxT < UNIFORMITY_LIMITS.contrastT,
  };
}
