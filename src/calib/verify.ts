// Verification report data: per-patch ΔE00/ΔITP against the target, statistics, white point,
// contrast and grey curve. Pure functions, tested with synthetic readings (test/calib.test.ts).

import { D65, type GamutId, type XY } from '../color';
import type { TestSet } from './testsets';
import {
  DE00_LIMITS, cctDuv, grade, patchDelta, stats, targetChannel, targetXyz, whiteXyz, xyzToXy,
  type Grade, type PatchDelta, type Stats, type Target, type TargetTransfer, type XYZ,
} from './colorimetry';

export interface VerifyRow extends Partial<PatchDelta> {
  label: string; rgb: [number, number, number]; kind: string;
  target: XYZ; measured: XYZ | null;
}
export interface GreyPoint { signal: number; measured: number; target: number; gamma: number | null }
export interface VerifyReport {
  set: string; target: Target; date: string; meter: string; hdr: boolean;
  lw: number; lb: number; contrast: number;
  /** white and black were measured (otherwise SDR targets use 100 / 0 cd/m²) */
  whiteMeasured: boolean;
  white: { xy: XY; cct: number; duv: number; dE00: number; grade: Grade } | null;
  rows: VerifyRow[];
  dE00: Stats; dITP: Stats;
  grades: { mean: Grade; max: Grade };
  grey: GreyPoint[];
}

const isWhite = (r: number[]) => r[0] === 1 && r[1] === 1 && r[2] === 1;
const isBlack = (r: number[]) => r[0] === 0 && r[1] === 0 && r[2] === 0;

export function verify(set: TestSet, readings: (XYZ | null)[], target: Target, meter = ''): VerifyReport {
  const hdr = target.transfer === 'pq';
  const find = (pred: (r: number[]) => boolean) => { const i = set.patches.findIndex((p) => pred(p.rgb)); return i >= 0 ? readings[i] : null; };
  const wm = find(isWhite), bm = find(isBlack);
  // SDR targets scale to the measured white and black (BT.1886 Annex 1); without them 100 / 0 cd/m².
  const lw = wm?.[1] ?? 100, lb = Math.max(0, bm?.[1] ?? 0);
  const refWhite = whiteXyz(target.white, hdr ? 203 : lw);
  const rows: VerifyRow[] = set.patches.map((p, i) => {
    const t = targetXyz(p.rgb, target, lw, lb), m = readings[i] ?? null;
    return { label: p.label, rgb: p.rgb, kind: p.kind, target: t, measured: m, ...(m ? patchDelta(m, t, refWhite) : {}) };
  });
  const done = rows.filter((r) => r.measured);
  const dE00 = stats(done.map((r) => r.dE00!)), dITP = stats(done.map((r) => r.dITP!));
  let white: VerifyReport['white'] = null;
  if (wm && !hdr) {
    const xy = xyzToXy(wm), c = cctDuv(xy);
    // white point: measured white against the target chromaticity at the same luminance
    const d = patchDelta(wm, whiteXyz(target.white, wm[1]), whiteXyz(target.white, wm[1])).dE00;
    white = { xy, cct: c.cct, duv: c.duv, dE00: d, grade: grade(d, DE00_LIMITS.white) };
  }
  const grey: GreyPoint[] = rows.filter((r) => r.kind === 'grey' && r.measured).map((r) => {
    const v = r.rgb[0], y = r.measured![1];
    // effective gamma relative to the measured black/white (SDR), not defined at 0 and 1
    const rel = (y - lb) / (lw - lb);
    const gamma = !hdr && v > 0.02 && v < 0.98 && rel > 0 ? Math.log(rel) / Math.log(v) : null;
    return { signal: v, measured: y, target: targetChannel(target.transfer, v, lw, lb), gamma };
  }).sort((a, b) => a.signal - b.signal);
  return {
    set: set.name, target, date: new Date().toISOString(), meter, hdr, lw, lb, whiteMeasured: !!wm && !!bm, contrast: lb > 0 ? lw / lb : Infinity,
    white, rows, dE00, dITP, grades: { mean: grade(dE00.mean, DE00_LIMITS.mean), max: grade(dE00.max, DE00_LIMITS.max) }, grey,
  };
}

export const defaultTarget = (hdr: boolean, gamut: GamutId = hdr ? '2020' : '709', transfer: TargetTransfer = hdr ? 'pq' : 'bt1886'): Target => ({ transfer, gamut, white: D65 });
