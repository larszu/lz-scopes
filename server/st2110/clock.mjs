// Time base for the ST 2110 sender and receiver: PTP time scale (TAI, SMPTE epoch = PTP epoch,
// ST 2059-1 §6.1) taken from the system clock plus TAI − UTC (server/leap.mjs). There is no PTP
// servo here: on Linux the system clock is usually disciplined by linuxptp (ptp4l + phc2sys),
// elsewhere it follows NTP and the absolute values are only as good as that.
//
// Times are seconds relative to `epochSec`, an integer TAI second taken at start, so that
// Number keeps sub-microsecond resolution; the monotonic performance clock gives the steps.

import { performance } from 'node:perf_hooks';
import { taiMinusUtc } from '../leap.mjs';

export function createClock({ nowMs = () => Date.now(), perf = () => performance.now() } = {}) {
  const wall = nowMs(), p0 = perf();
  const tai = wall / 1000 + taiMinusUtc(wall);
  const epochSec = Math.floor(tai);
  const base = tai - epochSec;
  return {
    epochSec,
    /** seconds since epochSec (TAI) */
    now: () => base + (perf() - p0) / 1000,
    source: 'system',
  };
}
