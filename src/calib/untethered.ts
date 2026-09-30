// Untethered mode: the patches come from an external generator (or the user switches them), the
// meter reads continuously and a new patch is recognised from the readings. Criterion as in
// DisplayCAL (wx_untethered_frame.py, idea only): ΔE > 1.5 to the last accepted reading, or
// |ΔL| > 1 with |ΔC| < 0.5 (grey steps); accepted on the second reading in a row that meets it
// and agrees with the first (ΔE00 ≤ 1.5, i.e. the patch has settled). Lab relative to the
// brightest reading so far. Own implementation.

import { deltaE2000, xyzToLab } from '../color';
import type { XYZ } from './colorimetry';

export const UNTETHERED = { minDelta: 1.5, minDeltaL: 1, maxDeltaC: 0.5 } as const;

export class UntetheredDetector {
  private last: XYZ | null = null;
  private candidate: XYZ | null = null;
  private white: XYZ = [0, 0, 0];

  /** Feed one reading; returns the reading when it is accepted as a new patch, otherwise null. */
  push(xyz: XYZ): XYZ | null {
    if (xyz[1] > this.white[1]) this.white = xyz;
    const w = this.white[1] > 0 ? this.white : ([95.047, 100, 108.883] as XYZ);
    const lab = (v: XYZ) => xyzToLab(v, w);
    if (!this.last) return this.accept(xyz);
    const a = lab(this.last), b = lab(xyz);
    const dE = deltaE2000(a, b), dL = Math.abs(a[0] - b[0]);
    const dC = Math.abs(Math.hypot(a[1], a[2]) - Math.hypot(b[1], b[2]));
    const changed = dE > UNTETHERED.minDelta || (dL > UNTETHERED.minDeltaL && dC < UNTETHERED.maxDeltaC);
    if (!changed) { this.candidate = null; return null; }
    if (this.candidate && deltaE2000(lab(this.candidate), b) <= UNTETHERED.minDelta) return this.accept(xyz);
    this.candidate = xyz;
    return null;
  }
  /** Take a reading as the current patch (first reading, or the user assigns it by hand, e.g. two identical patches in a row). */
  accept(xyz: XYZ): XYZ { this.last = xyz; this.candidate = null; return xyz; }
  reset() { this.last = null; this.candidate = null; this.white = [0, 0, 0]; }
}
