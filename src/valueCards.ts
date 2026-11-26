// Explanation cards per measured value (#239; idea: Bridge Technologies VB440, aimed at
// beginners): full name, what the value means, and its formula with the numbers measured right
// now. Help → Measured values explained … shows them for the source on most panels.
// The formulas are those the code uses; the norm is named on every card:
//   Y′          ITU-R BT.709-6 item 3.2 / BT.2020-2 Tab. 4 / BT.601-7 item 2.5.1 (Kr, Kb)  – src/sources.ts computeStats
//   clipping    share of samples at code 255 of 8 bit (≥ 254.5/255)                       – src/sources.ts computeStats
//   EBU R 103   v3.0 (2020) Tab. 1 p5, filters and 1 % rule p5                            – src/ycbcr.ts R103
//   MaxCLL/FALL CTA-861.3-A (2015)                                                          – src/sources.ts lightLevel
//   I, LRA, TP  ITU-R BS.1770-5 (2023) Annex 1/2, EBU Tech 3341/3342 (2023), EBU R 128       – src/audio/dsp/*
//   PLR         EBU Tech 3343 (peak to loudness ratio = true peak − integrated)
//   BRNG/TOUT/VREP  ffmpeg signalstats filter (doc/filters.texi)                            – server/signalstats.mjs

import { num, t, type Key } from './i18n';
import { R103 } from './ycbcr';
import type { R103Result } from './ycbcr';
import type { LightLevel, Stats } from './sources';

export interface ValueInput {
  stats: Stats | null;
  /** luma coefficients of the source matrix and its name (709, 2020, 601 …) */
  kr: number; kb: number; matrix: string;
  /** R 103 on the unclipped Y′CbCr path; null otherwise */
  r103: R103Result | null;
  /** MaxCLL / MaxFALL of a PQ source; null otherwise */
  light: LightLevel | null;
  /** loudness of the source's sound; null without sound */
  loud: { integrated: number; lra: number | null; maxTpDb: number; seconds: number } | null;
  /** QC metrics of the bridge (#202); null when not delivered */
  signal: { tout?: number; vrep?: number; brng?: number } | null;
}

export interface ValueCard {
  id: string;
  /** full name */
  name: string;
  /** current value, formatted */
  value: string;
  /** what it means */
  what: string;
  /** the formula with the current numbers */
  formula: string;
  /** norm or source of the formula */
  source: string;
}

const pct = (v: number, d = 1) => `${num(v * 100, d)} %`;
const db = (v: number, d = 1) => (Number.isFinite(v) ? num(v, d) : '−∞');
const k = (id: string, part: 'name' | 'what' | 'formula') => `ops.vc.${id}.${part}` as Key;

/** Cards for every value the source delivers right now (values it does not have are left out). */
export function valueCards(i: ValueInput): ValueCard[] {
  const out: ValueCard[] = [];
  const add = (id: string, value: string, params: Record<string, string | number>, source: string) =>
    out.push({ id, name: t(k(id, 'name')), value, what: t(k(id, 'what')), formula: t(k(id, 'formula'), params), source });
  const s = i.stats;
  const kg = 1 - i.kr - i.kb;
  const lumaSource = i.matrix === '2020' ? 'ITU-R BT.2020-2, Tab. 4' : i.matrix.startsWith('601') ? 'ITU-R BT.601-7, 2.5.1' : 'ITU-R BT.709-6, 3.2';
  if (s && s.samples > 0) {
    const coeff = { kr: num(i.kr, 4), kg: num(kg, 4), kb: num(i.kb, 4), n: num(s.samples, 0) };
    add('ymax', pct(s.yMax), { ...coeff, v: pct(s.yMax) }, lumaSource);
    add('ymin', pct(s.yMin), { ...coeff, v: pct(s.yMin) }, lumaSource);
    add('yavg', pct(s.yAvg), { ...coeff, v: pct(s.yAvg) }, lumaSource);
    const clip = Math.max(...s.clipHigh), ch = s.clipHigh.indexOf(clip);
    add('clip', pct(clip, 2), { r: pct(s.clipHigh[0], 2), g: pct(s.clipHigh[1], 2), b: pct(s.clipHigh[2], 2), ch: ['R′', 'G′', 'B′'][ch] ?? 'R′', v: pct(clip, 2) }, 'LZ Scopes (8 bit code 255)');
  }
  if (i.r103) {
    const r = i.r103, n = r.samples || 1;
    add('r103', pct(r.pref, 2), {
      lo: pct(R103.prefLo, 2), hi: pct(R103.prefHi, 2), out: num(Math.round(r.pref * n), 0), n: num(r.samples, 0), v: pct(r.pref, 2),
      limit: pct(R103.area, 0), verdict: r.alarm ? t('ops.vc.over') : t('ops.vc.under'),
    }, 'EBU R 103 v3.0 (2020), Tab. 1 + p5');
    add('r103total', pct(r.total, 2), {
      lo: pct(R103.totalLo, 2), hi: pct(R103.totalHi, 2), out: num(Math.round(r.total * n), 0), n: num(r.samples, 0), v: pct(r.total, 2),
    }, 'EBU R 103 v3.0 (2020), Tab. 1');
  }
  if (i.light && i.light.frames > 0) {
    add('maxcll', `${num(i.light.maxCll, 0)} cd/m²`, { v: num(i.light.maxCll, 0), frames: num(i.light.frames, 0) }, 'CTA-861.3-A');
    add('maxfall', `${num(i.light.maxFall, 0)} cd/m²`, { v: num(i.light.maxFall, 0), frames: num(i.light.frames, 0) }, 'CTA-861.3-A');
  }
  if (i.loud) {
    const L = i.loud;
    add('integrated', `${db(L.integrated)} LUFS`, { v: db(L.integrated), s: num(L.seconds, 0), dev: Number.isFinite(L.integrated) ? db(L.integrated + 23) : '–' }, 'ITU-R BS.1770-5 Annex 1, EBU R 128 (2023)');
    if (L.lra !== null) add('lra', `${db(L.lra)} LU`, { v: db(L.lra) }, 'EBU Tech 3342 (2023)');
    add('truepeak', `${db(L.maxTpDb)} dBTP`, { v: db(L.maxTpDb), verdict: L.maxTpDb > -1 ? t('ops.vc.over') : t('ops.vc.under') }, 'ITU-R BS.1770-5 Annex 2, EBU R 128 (2023)');
    if (Number.isFinite(L.integrated) && Number.isFinite(L.maxTpDb)) add('plr', `${db(L.maxTpDb - L.integrated)} dB`, { tp: db(L.maxTpDb), i: db(L.integrated), v: db(L.maxTpDb - L.integrated) }, 'EBU Tech 3343 (2023)');
  }
  const sig = i.signal;
  if (sig?.brng !== undefined) add('brng', pct(sig.brng, 2), { v: pct(sig.brng, 2) }, 'ffmpeg signalstats (BRNG)');
  if (sig?.tout !== undefined) add('tout', pct(sig.tout, 3), { v: pct(sig.tout, 3) }, 'ffmpeg signalstats (TOUT)');
  if (sig?.vrep !== undefined) add('vrep', pct(sig.vrep, 2), { v: pct(sig.vrep, 2) }, 'ffmpeg signalstats (VREP)');
  return out;
}
