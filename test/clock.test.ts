import { describe, expect, it } from 'vitest';
import { localOffset, ptpToUtc, taiMinusUtc, utcToPtp } from '../src/clock/tai';
import {
  RATES, emulatedJam, formatPairs, formatTc, fromFrames, fromPairs, pairRate, toPairs, framePhase, framesPerDay, ltcBitNumber, nextAlignmentTime, nextCodeword, parseTc, rateById,
  tcDiff, timeAddressAt, timeAddressOfCodeword, timeOfNextJam, toFrames, validTc, type JamParams,
} from '../src/clock/timecode';

const r2997 = rateById('29.97'), r25 = rateById('25'), r5994 = rateById('59.94');

describe('TAI and the SMPTE epoch (ST 2059-1 §6.1, IERS)', () => {
  it('epoch is 63072010 s before 1972-01-01T00:00:00Z', () => {
    expect(utcToPtp(Date.UTC(1972, 0, 1))).toBe(63072010);
  });
  it('TAI − UTC from the IERS table', () => {
    expect(taiMinusUtc(Date.UTC(2014, 0, 1))).toBe(35);
    expect(taiMinusUtc(Date.UTC(2016, 11, 31, 23, 59, 59))).toBe(36);
    expect(taiMinusUtc(Date.UTC(2017, 0, 1))).toBe(37);
    expect(taiMinusUtc(Date.UTC(2026, 8, 30))).toBe(37);
  });
  it('round trip UTC ↔ PTP', () => {
    const ms = Date.UTC(2026, 8, 30, 12, 34, 56, 789);
    expect(ptpToUtc(utcToPtp(ms))).toBeCloseTo(ms, 3);
  });
  it('currentLocalOffset example of ST 2059-2 footnote 4 (EST/EDT 2014)', () => {
    // TAI − UTC was 35 s in 2014 (IERS)
    expect(localOffset(Date.UTC(2014, 0, 1), -5 * 3600)).toBe(-18035);
    expect(localOffset(Date.UTC(2014, 6, 1), -4 * 3600)).toBe(-14435);
  });
});

describe('alignment (ST 2059-1 §6.2, §9.2)', () => {
  it('50 Hz at an integer second: next alignment 20 ms later (Note in §6.2)', () => {
    expect(nextAlignmentTime(1000, 1, 50)).toBeCloseTo(1000.02, 9);
  });
  it('frame phase and index', () => {
    const p = framePhase(10.01, r25);
    expect(p.n).toBe(250);
    expect(p.phase).toBeCloseTo(0.25, 9);
    expect(p.next).toBeCloseTo(10.04, 9);
    // 30/1.001: frame n starts at n × 1001/30000
    expect(framePhase(1001 / 30000 * 7, r2997).n).toBe(7);
  });
  it('LTC bit number = floor(t × 80 × Ff) % 80', () => {
    expect(ltcBitNumber(0, r25)).toBe(0);
    expect(ltcBitNumber(0.02, r25)).toBe(40);
    expect(ltcBitNumber(0.0399, r25)).toBe(79);
  });
});

describe('frame counting (ST 2059-1 §9.3.3)', () => {
  it('DF 30/1.001: known addresses', () => {
    const df = (hh: number, mm: number, ss: number, ff: number) => ({ hh, mm, ss, ff, df: true });
    expect(toFrames(df(0, 1, 0, 2), r2997)).toBe(1800);
    expect(toFrames(df(0, 10, 0, 0), r2997)).toBe(17982);
    expect(toFrames(df(1, 0, 0, 0), r2997)).toBe(107892);
    expect(fromFrames(1799, r2997, true)).toEqual(df(0, 0, 59, 29));
    expect(fromFrames(1800, r2997, true)).toEqual(df(0, 1, 0, 2));
    expect(fromFrames(17982, r2997, true)).toEqual(df(0, 10, 0, 0));
    expect(framesPerDay(r2997, true)).toBe(2589408);
  });
  it('DF round trip over a full day (30 and 60 Hz) and every address is legal', () => {
    for (const r of [r2997, r5994]) {
      const day = framesPerDay(r, true);
      let prev = -1;
      for (let f = 0; f < day; f++) {
        const t = fromFrames(f, r, true);
        if (!validTc(t, r)) throw new Error(`${formatTc(t)} illegal`);
        const back = toFrames(t, r);
        if (back !== f) throw new Error(`${f} → ${formatTc(t)} → ${back}`);
        prev = back;
      }
      expect(prev).toBe(day - 1);
      expect(fromFrames(day, r, true)).toEqual({ hh: 0, mm: 0, ss: 0, ff: 0, df: true });
    }
  }, 60000);
  it('NDF round trip for all rates', () => {
    for (const r of RATES) {
      const day = framesPerDay(r, false);
      expect(day).toBe(r.nominal * 86400);
      for (let f = 0; f < day; f += 997) expect(toFrames(fromFrames(f, r, false), r)).toBe(f);
    }
  });
  it('format/parse', () => {
    expect(formatTc({ hh: 1, mm: 2, ss: 3, ff: 4, df: true })).toBe('01:02:03;04');
    expect(parseTc('10:00:00:00')).toEqual({ hh: 10, mm: 0, ss: 0, ff: 0, df: false });
    expect(parseTc('01:00:00;00')?.df).toBe(true);
    expect(parseTc('nope')).toBeNull();
    expect(validTc({ hh: 0, mm: 1, ss: 0, ff: 0, df: true }, r2997)).toBe(false);
  });
  it('difference in frames wraps at midnight', () => {
    expect(tcDiff({ hh: 0, mm: 0, ss: 0, ff: 1, df: false }, { hh: 23, mm: 59, ss: 59, ff: 24, df: false }, r25)).toBe(2);
  });
});

describe('time address from PTP time (ST 2059-1 §9.3.2, ST 2059-2 Annex A)', () => {
  // 2026-09-30 12:00:00 UTC, TAI − UTC = 37, CEST (UTC+2): currentLocalOffset = 7200 − 37
  const utc = Date.UTC(2026, 8, 30, 12, 0, 0);
  const t = utcToPtp(utc);
  const clo = 7200 - 37;

  it('Annex A: next jam at 03:00 local lies in the future and on 03:00 local', () => {
    const next = timeOfNextJam(t, clo, 3, 0);
    expect(next).toBeGreaterThan(t);
    expect(((next + clo) % 86400) / 3600).toBe(3);
  });
  it('integer rate: time address equals local wall-clock time', () => {
    // Jam per Annex A (local midnight): exact
    const jam2 = emulatedJam(t, () => clo, 0, 0);
    expect(formatTc(timeAddressAt(t, r25, false, jam2))).toBe('14:00:00:00');
    expect(formatTc(timeAddressAt(t + 0.5, r25, false, jam2))).toBe('14:00:00:12');
  });
  it('observation: timeOfPreviousJam = 0 (ST 2059-2 §6.13.3 Note 1) loses the seconds of the offset', () => {
    // §9.3.2.1 step 5 sets SS = 0 at the jam; with a jam at the epoch the Local Time of the jam is
    // 7163 s = 01:59:23 → 01:59:00, so addresses run 23 s behind. Documented in docs/research/clock-ptp.md.
    const jam: JamParams = { currentLocalOffset: clo, timeOfPreviousJam: 0, previousJamLocalOffset: clo, timeOfNextJam: 0 };
    expect(formatTc(timeAddressAt(t, r25, false, jam))).toBe('13:59:37:00');
  });
  it('30/1.001 DF: counting from the jam at local midnight', () => {
    const jam = emulatedJam(t, () => clo, 0, 0);
    // local midnight 2026-09-30 00:00 on the PTP scale
    const tJam = jam.timeOfPreviousJam;
    expect(((tJam + clo) % 86400 + 86400) % 86400).toBe(0);
    const n0 = nextCodeword(tJam, r2997);
    expect(formatTc(timeAddressOfCodeword(n0, r2997, true, jam))).toBe('00:00:00;00');
    // 10 minutes of DF = 17982 codewords later
    expect(formatTc(timeAddressOfCodeword(n0 + 17982, r2997, true, jam))).toBe('00:10:00;00');
    // after 14 h the DF address lags wall-clock time by the documented residual (≤ 3 frames/day)
    const ta = timeAddressAt(t, r2997, true, jam);
    const wall = toFrames({ hh: 14, mm: 0, ss: 0, ff: 0, df: true }, r2997);
    expect(Math.abs(toFrames(ta, r2997) - wall)).toBeLessThanOrEqual(3);
  });
  it('30/1.001 NDF drifts 3.6 s per hour against wall-clock time', () => {
    const jam = emulatedJam(t, () => clo, 0, 0);
    const n0 = nextCodeword(jam.timeOfPreviousJam, r2997);
    // one real hour = 3600 × 30000/1001 codewords ≈ 107892.1 → reads 00:59:56;12 NDF
    const ta = timeAddressOfCodeword(n0 + Math.round(3600 * 30000 / 1001), r2997, false, jam);
    expect(formatTc(ta)).toBe('00:59:56:12');
  });
});

describe('above 30 fps: full count and ST 12-1 frame pairs', () => {
  it('59.94 DF full count maps onto 29.97 DF pairs for a whole day', () => {
    const r60 = rateById('59.94'), r30 = rateById('29.97');
    expect(pairRate(r60)).toBe(r30);
    const day = framesPerDay(r60, true);
    expect(day).toBe(2 * framesPerDay(r30, true));
    for (let f = 0; f < day; f += 7) {
      const p = toPairs(fromFrames(f, r60, true), r60);
      const q = fromFrames(Math.floor(f / 2), r30, true);
      if (p.ff !== q.ff || p.ss !== q.ss || p.mm !== q.mm || p.hh !== q.hh || p.second !== (f % 2 === 1)) throw new Error(`frame ${f}`);
      if (toFrames(fromPairs(p, r60), r60) !== f) throw new Error(`back ${f}`);
    }
  }, 60000);
  it('50p: last frame of a second is pair 24, second frame', () => {
    const r50 = rateById('50');
    const p = toPairs({ hh: 10, mm: 0, ss: 0, ff: 49, df: false }, r50);
    expect(p).toMatchObject({ ff: 24, second: true });
    expect(formatPairs(p)).toBe('10:00:00:24.1');
    expect(toPairs({ hh: 0, mm: 0, ss: 0, ff: 7, df: false }, rateById('25'))).toMatchObject({ ff: 7, second: false });
  });
});
