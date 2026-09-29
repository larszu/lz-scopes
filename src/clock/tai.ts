// TAI − UTC and the SMPTE/PTP epoch.
//
// SMPTE ST 2059-1:2021 §6.1: "The SMPTE Epoch shall be 01 January 1970 00:00:00 TAI",
// identical to the PTP epoch of IEEE Std 1588-2008; Note 2: the SMPTE Epoch is
// 63072010 seconds before 1972-01-01T00:00:00Z (UTC).
//
// TAI − UTC from the IERS table Leap_Second.dat (hpiers.obspm.fr/iers/bul/bulc/Leap_Second.dat,
// "Updated through IERS Bulletin 72 issued in July 2026", "File expires on 28 June 2027").
// IERS Bulletin C 72 (Paris, 06 July 2026): "NO leap second will be introduced at the end of
// December 2026 … from 2017 January 1, 0h UTC, until further notice : UTC-TAI = -37 s".
// Both files are copied verbatim into docs/research/clock-ptp.md.

/** [MJD at 0h UTC from which the value applies, TAI − UTC in s] */
export const LEAP_TABLE: readonly (readonly [number, number])[] = [
  [41317, 10], [41499, 11], [41683, 12], [42048, 13], [42413, 14], [42778, 15], [43144, 16], [43509, 17], [43874, 18],
  [44239, 19], [44786, 20], [45151, 21], [45516, 22], [46247, 23], [47161, 24], [47892, 25], [48257, 26], [48804, 27],
  [49169, 28], [49534, 29], [50083, 30], [50630, 31], [51179, 32], [53736, 33], [54832, 34], [56109, 35], [57204, 36],
  [57754, 37],
];
/** The table is known to be complete up to this instant (Leap_Second.dat: "File expires on 28 June 2027"). */
export const LEAP_TABLE_EXPIRES_MS = Date.UTC(2027, 5, 28);
export const LEAP_SOURCE = 'IERS Bulletin C 72 (06.07.2026), Leap_Second.dat gültig bis 28.06.2027';

/** MJD 40587 = 1970-01-01 (ST 2059-1 §9.3.4 step 3: MJD = D + 40587). */
export const MJD_UNIX = 40587;
const DAY = 86400;

/** TAI − UTC in seconds at a UTC instant (ms since 1970, POSIX); 0 before 1972 (no integer offset defined). */
export function taiMinusUtc(utcMs: number): number {
  const mjd = utcMs / 1000 / DAY + MJD_UNIX;
  let v = 0;
  for (const [m, s] of LEAP_TABLE) if (mjd >= m) v = s; else break;
  return v;
}

/** Is the leap-second table still authoritative at this instant? */
export const leapTableValid = (utcMs: number) => utcMs < LEAP_TABLE_EXPIRES_MS;

/** PTP time (seconds since the SMPTE/PTP epoch, TAI) from a POSIX UTC instant in ms. */
export const utcToPtp = (utcMs: number) => utcMs / 1000 + taiMinusUtc(utcMs);

/** POSIX UTC ms from PTP time (inverse of utcToPtp outside a leap second). */
export function ptpToUtc(ptp: number): number {
  let ms = ptp * 1000;
  for (let i = 0; i < 2; i++) ms = (ptp - taiMinusUtc(ms)) * 1000;
  return ms;
}

/**
 * currentLocalOffset of the SMPTE profile (ST 2059-2 Table 2): Local Time − PTP time in s.
 * = zone offset (incl. daylight saving) − (TAI − UTC). ST 2059-2 footnote 4: EST (UTC−5),
 * 2014-01-01, TAI − UTC = 35 → −18035; EDT (UTC−4), 2014-07-01 → −14435.
 */
export const localOffset = (utcMs: number, zoneSeconds: number) => zoneSeconds - taiMinusUtc(utcMs);

/** Zone offset of the browser's time zone at an instant, in seconds east of UTC. */
export const browserZoneSeconds = (utcMs: number) => -new Date(utcMs).getTimezoneOffset() * 60;
