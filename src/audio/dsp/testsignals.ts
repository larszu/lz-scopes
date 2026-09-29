// Minimum-requirement test signals of EBU Tech 3341 (Table 1, p8–9) and Tech 3342
// (Table 1, p6) that can be synthesised, and a runner that feeds them through the DSP
// core. Used by vitest and by the self-test in the app (“Selbsttest”). Cases #7/#8 of
// Tech 3341 and #5/#6 of Tech 3342 need the EBU's authentic programme files and are
// not included.

import { LoudnessMeter } from './loudness';
import { LevelMeter } from './meters';
import { toDb } from './truepeak';

export interface CaseResult { id: string; label: string; expected: string; measured: string; pass: boolean }
export interface TestCase { id: string; label: string; run: (fs: number) => CaseResult }

type Seg = [seconds: number, dbfs: number | null];

/** Concatenated 1 kHz sine segments (phase-continuous), null = silence. */
export function toneSegments(segs: Seg[], fs: number, freq = 1000): Float32Array {
  const total = segs.reduce((s, [t]) => s + Math.round(t * fs), 0);
  const x = new Float32Array(total);
  let n = 0;
  for (const [t, db] of segs) {
    const len = Math.round(t * fs), a = db === null ? 0 : 10 ** (db / 20);
    for (let i = 0; i < len; i++, n++) x[n] = a * Math.sin((2 * Math.PI * freq * n) / fs);
  }
  return x;
}

interface Hooks { every10ms?: (m: LoudnessMeter, t: number) => void; levels?: boolean }

/** Run planar channels through the loudness and level meters in 4800-frame chunks. */
export function measure(chs: Float32Array[], fs: number, hooks: Hooks = {}, layout = '') {
  const lm = new LoudnessMeter(fs, chs.length, layout);
  const lv = new LevelMeter(fs, chs.length);
  const n = chs[0].length;
  const step = hooks.every10ms ? Math.round(fs / 100) : 4800;
  for (let off = 0; off < n; off += step) {
    const len = Math.min(step, n - off);
    lm.process(chs, len, off); if (hooks.levels !== false) lv.process(chs, len, off);
    hooks.every10ms?.(lm, (off + len) / fs);
  }
  return { lm, lv };
}

const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '−∞').replace('.', ',').replace('-', '−');
const stereo = (x: Float32Array) => [x, x];

function loudnessCase(id: string, label: string, segs: Seg[], expected: number, what: 'I' | 'MSI' = 'I'): TestCase {
  return {
    id, label,
    run: (fs) => {
      const x = toneSegments(segs, fs);
      const { lm } = measure(stereo(x), fs, { levels: false });
      const vals = what === 'I' ? [lm.integrated] : [lm.momentary, lm.shortTerm, lm.integrated];
      const pass = vals.every((v) => Math.abs(v - expected) <= 0.1);
      return { id, label, expected: `${what === 'I' ? 'I' : 'M, S, I'} = ${f1(expected)} ±0,1 LUFS`, measured: vals.map(f1).join(' / ') + ' LUFS', pass };
    },
  };
}

function tpSine(id: string, fsDiv: number, amp: number, phaseDeg: number, expected: number): TestCase {
  const label = `Sinus fs/${fsDiv}, ${amp.toFixed(2)} FFS, ${phaseDeg}°`;
  return {
    id, label,
    run: (fs) => {
      const n = fs, fade = Math.round(fs * 0.01), x = new Float32Array(n), ph = (phaseDeg * Math.PI) / 180;
      for (let i = 0; i < n; i++) {
        const g = Math.min(1, i / fade, (n - 1 - i) / fade);
        x[i] = g * amp * Math.sin((2 * Math.PI * i) / fsDiv + ph);
      }
      const { lv } = measure(stereo(x), fs);
      const tp = toDb(Math.max(...lv.maxTP));
      return tpResult(id, label, expected, tp);
    },
  };
}

function tpResult(id: string, label: string, expected: number, tp: number): CaseResult {
  return { id, label, expected: `${f1(expected)} +0,2/−0,4 dBTP`, measured: `${f1(tp)} dBTP`, pass: tp <= expected + 0.2 && tp >= expected - 0.4 };
}

/**
 * Tech 3341 #20–#23: fs/6 sine (0.5 FFS) containing one period of fs/4 at 1.0 FFS, phase-
 * continuous, synthesised at 4·fs, low-pass filtered and decimated with an offset of 0–3.
 */
export function tpBurst(fs: number, offset: number): Float32Array {
  const up = 4, per6 = 6 * up, per4 = 4 * up; // periods in samples at 4·fs
  const pre = 400, post = 400; // periods of fs/6 before and after
  const hi: number[] = [];
  const fadeP = 20;
  for (let p = 0; p < pre; p++) for (let i = 0; i < per6; i++) hi.push(0.5 * Math.min(1, p / fadeP) * Math.sin((2 * Math.PI * i) / per6));
  for (let i = 0; i < per4; i++) hi.push(1.0 * Math.sin((2 * Math.PI * i) / per4));
  for (let p = 0; p < post; p++) for (let i = 0; i < per6; i++) hi.push(0.5 * Math.min(1, (post - 1 - p) / fadeP) * Math.sin((2 * Math.PI * i) / per6));
  // windowed-sinc low-pass (Blackman, 1023 taps) at 0.47·fs of the target rate
  const taps = 1023, mid = (taps - 1) / 2, fc = 0.47 / up;
  const h = new Float64Array(taps);
  let sum = 0;
  for (let k = 0; k < taps; k++) {
    const m = k - mid, sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * k) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * k) / (taps - 1));
    h[k] = sinc * w; sum += h[k];
  }
  for (let k = 0; k < taps; k++) h[k] /= sum;
  const out = new Float32Array(Math.floor((hi.length - offset) / up));
  for (let j = 0; j < out.length; j++) {
    const c = j * up + offset;
    let acc = 0;
    for (let k = 0; k < taps; k++) { const idx = c + mid - k; if (idx >= 0 && idx < hi.length) acc += h[k] * hi[idx]; }
    out[j] = acc;
  }
  return out;
}

export const TECH3341: TestCase[] = [
  loudnessCase('3341-1', '1 kHz stereo −23 dBFS, 20 s', [[20, -23]], -23, 'MSI'),
  loudnessCase('3341-2', '1 kHz stereo −33 dBFS, 20 s', [[20, -33]], -33, 'MSI'),
  loudnessCase('3341-3', '−36/−23/−36 dBFS (10/60/10 s)', [[10, -36], [60, -23], [10, -36]], -23),
  loudnessCase('3341-4', '−72/−36/−23/−36/−72 dBFS', [[10, -72], [10, -36], [60, -23], [10, -36], [10, -72]], -23),
  loudnessCase('3341-5', '−26/−20/−26 dBFS (20/20,1/20 s)', [[20, -26], [20.1, -20], [20, -26]], -23),
  {
    id: '3341-6', label: '5.0: L/R −28, C −24, Ls/Rs −30 dBFS',
    run: (fs) => {
      const t = (db: number) => toneSegments([[20, db]], fs);
      const lr = t(-28), c = t(-24), s = t(-30);
      const { lm } = measure([lr, lr, c, s, s], fs, { levels: false }, '5.0');
      const v = lm.integrated;
      return { id: '3341-6', label: '5.0: L/R −28, C −24, Ls/Rs −30 dBFS', expected: 'I = −23,0 ±0,1 LUFS', measured: `${f1(v)} LUFS`, pass: Math.abs(v + 23) <= 0.1 };
    },
  },
  {
    id: '3341-9', label: 'S: (1,34 s −20 / 1,66 s −30 dBFS) ×5',
    run: (fs) => {
      const segs: Seg[] = [];
      for (let i = 0; i < 5; i++) segs.push([1.34, -20], [1.66, -30]);
      let lo = Infinity, hi = -Infinity;
      measure(stereo(toneSegments(segs, fs)), fs, { levels: false, every10ms: (m, t) => { if (t >= 3 - 1e-9) { lo = Math.min(lo, m.shortTerm); hi = Math.max(hi, m.shortTerm); } } });
      return { id: '3341-9', label: 'S konstant ab 3 s', expected: 'S = −23,0 ±0,1 LUFS', measured: `${f1(lo)} … ${f1(hi)} LUFS`, pass: Math.abs(lo + 23) <= 0.1 && Math.abs(hi + 23) <= 0.1 };
    },
  },
  {
    id: '3341-10', label: 'Max S dateibasiert, 20 Segmente',
    run: (fs) => {
      const vals: number[] = [];
      for (let i = 0; i < 20; i++) vals.push(measure(stereo(toneSegments([[i * 0.15, null], [3, -23], [1, null]], fs)), fs, { levels: false }).lm.maxS);
      const lo = Math.min(...vals), hi = Math.max(...vals);
      return { id: '3341-10', label: 'Max S dateibasiert, 20 Segmente', expected: 'Max S = −23,0 ±0,1 LUFS je Segment', measured: `${f1(lo)} … ${f1(hi)} LUFS`, pass: vals.every((v) => Math.abs(v + 23) <= 0.1) };
    },
  },
  liveMax('3341-11', 'S', 3, 0.15),
  {
    id: '3341-12', label: 'M: (0,18 s −20 / 0,22 s −30 dBFS) ×25',
    run: (fs) => {
      const segs: Seg[] = [];
      for (let i = 0; i < 25; i++) segs.push([0.18, -20], [0.22, -30]);
      let lo = Infinity, hi = -Infinity;
      measure(stereo(toneSegments(segs, fs)), fs, { levels: false, every10ms: (m, t) => { if (t >= 1 - 1e-9) { lo = Math.min(lo, m.momentary); hi = Math.max(hi, m.momentary); } } });
      return { id: '3341-12', label: 'M konstant ab 1 s', expected: 'M = −23,0 ±0,1 LUFS', measured: `${f1(lo)} … ${f1(hi)} LUFS`, pass: Math.abs(lo + 23) <= 0.1 && Math.abs(hi + 23) <= 0.1 };
    },
  },
  {
    id: '3341-13', label: 'Max M dateibasiert, 20 Segmente',
    run: (fs) => {
      const vals: number[] = [];
      for (let i = 0; i < 20; i++) vals.push(measure(stereo(toneSegments([[i * 0.02, null], [0.4, -23], [1, null]], fs)), fs, { levels: false }).lm.maxM);
      return { id: '3341-13', label: 'Max M dateibasiert, 20 Segmente', expected: 'Max M = −23,0 ±0,1 LUFS je Segment', measured: `${f1(Math.min(...vals))} … ${f1(Math.max(...vals))} LUFS`, pass: vals.every((v) => Math.abs(v + 23) <= 0.1) };
    },
  },
  liveMax('3341-14', 'M', 0.4, 0.02),
  tpSine('3341-15', 4, 0.5, 0, -6),
  tpSine('3341-16', 4, 0.5, 45, -6),
  tpSine('3341-17', 6, 0.5, 60, -6),
  tpSine('3341-18', 8, 0.5, 67.5, -6),
  tpSine('3341-19', 4, 1.41, 45, 3),
  ...[0, 1, 2, 3].map((o): TestCase => ({
    id: `3341-${20 + o}`, label: `Periode fs/4 in fs/6, Versatz ${o}`,
    run: (fs) => {
      const x = tpBurst(fs, o);
      const { lv } = measure(stereo(x), fs);
      return tpResult(`3341-${20 + o}`, `Periode fs/4 in fs/6, Versatz ${o}`, 0, toDb(Math.max(...lv.maxTP)));
    },
  })),
];

/** Tech 3341 #11 / #14: one long signal, Max S / Max M read after each of 20 segments. */
function liveMax(id: string, which: 'S' | 'M', tone: number, stepS: number): TestCase {
  const label = `Max ${which} live, 20 Stufen −38 … −19 dBFS`;
  return {
    id, label,
    run: (fs) => {
      const segs: Seg[] = [];
      const ends: number[] = [];
      let t = 0;
      for (let i = 0; i < 20; i++) {
        segs.push([i * stepS, null], [tone, -38 + i], [tone - i * stepS, null]);
        t += i * stepS + tone + tone - i * stepS; ends.push(t);
      }
      const got: number[] = [];
      let next = 0;
      measure(stereo(toneSegments(segs, fs)), fs, {
        levels: false,
        every10ms: (m, tt) => { if (next < 20 && tt >= ends[next] - 1e-6) { got.push(which === 'S' ? m.maxS : m.maxM); next++; } },
      });
      const pass = got.length === 20 && got.every((v, i) => Math.abs(v - (-38 + i)) <= 0.1);
      const worst = got.reduce((w, v, i) => Math.max(w, Math.abs(v - (-38 + i))), 0);
      return { id, label, expected: `Max ${which} = −38 … −19 ±0,1 LUFS`, measured: `größte Abweichung ${worst.toFixed(2)} LU`, pass };
    },
  };
}

function lraCase(id: string, levels: number[], expected: number): TestCase {
  const label = `1 kHz, ${levels.map((l) => l.toFixed(0).replace('-', '−')).join('/')} dBFS je 20 s`;
  return {
    id, label,
    run: (fs) => {
      const { lm } = measure(stereo(toneSegments(levels.map((l): Seg => [20, l]), fs)), fs, { levels: false });
      const v = lm.lra ?? NaN;
      return { id, label, expected: `LRA = ${expected} ±1 LU`, measured: `${f1(v)} LU`, pass: Math.abs(v - expected) <= 1 };
    },
  };
}

export const TECH3342: TestCase[] = [
  lraCase('3342-1', [-20, -30], 10),
  lraCase('3342-2', [-20, -15], 5),
  lraCase('3342-3', [-40, -20], 20),
  lraCase('3342-4', [-50, -35, -20, -35, -50], 15),
];

export const ALL_CASES = [...TECH3341, ...TECH3342];
