import { describe, expect, it } from 'vitest';
import { kWeightingCoefficients, kWeightingPowerGain } from '../src/audio/dsp/kweight';
import { loudnessRange } from '../src/audio/dsp/lra';
import { ALL_CASES, measure, toneSegments } from '../src/audio/dsp/testsignals';
import { DEFAULT_GEN, ToneGenerator, expectedSine, type GenConfig } from '../src/audio/dsp/signals';
import { spectrumDb, thirdOctaveBands, thirdOctaveCentres } from '../src/audio/dsp/fft';
import { toDb } from '../src/audio/dsp/truepeak';

describe('K-filter coefficients (BS.1770-5 Tables 1 and 2, audio.md c.1)', () => {
  it('48 kHz reproduces the norm table', () => {
    const [s1, s2] = kWeightingCoefficients(48000);
    expect(s1.b0).toBeCloseTo(1.53512485958697, 12);
    expect(s1.b1).toBeCloseTo(-2.69169618940638, 12);
    expect(s1.b2).toBeCloseTo(1.19839281085285, 12);
    expect(s1.a1).toBeCloseTo(-1.69065929318241, 12);
    expect(s1.a2).toBeCloseTo(0.73248077421585, 12);
    expect([s2.b0, s2.b1, s2.b2]).toEqual([1, -2, 1]);
    expect(s2.a1).toBeCloseTo(-1.99004745483398, 12);
    expect(s2.a2).toBeCloseTo(0.99007225036621, 12);
  });
  it('44.1 and 96 kHz match the values in audio.md', () => {
    const [a1, a2] = kWeightingCoefficients(44100);
    expect(a1.b0).toBeCloseTo(1.5308412300503478, 12);
    expect(a1.a1).toBeCloseTo(-1.6636551132560204, 12);
    expect(a2.a2).toBeCloseTo(0.9891990357870393, 12);
    const [b1, b2] = kWeightingCoefficients(96000);
    expect(b1.b1).toBeCloseTo(-2.9267415782510824, 12);
    expect(b1.a2).toBeCloseTo(0.8558433229306412, 12);
    expect(b2.a1).toBeCloseTo(-1.9950175447247156, 12);
  });
  it('0 dBFS 997 Hz on one channel = −3.01 LKFS (BS.1770-5 p9)', () => {
    const x = toneSegments([[5, 0]], 48000, 997);
    const { lm } = measure([x, new Float32Array(x.length)], 48000);
    expect(lm.integrated).toBeCloseTo(-3.01, 1);
    expect(-0.691 + 10 * Math.log10(0.5 * kWeightingPowerGain(997, 48000))).toBeCloseTo(-3.01, 1);
  });
});

describe('EBU Tech 3341 / 3342 minimum requirements (synthesisable cases)', { timeout: 60000 }, () => {
  for (const fs of [48000, 44100]) {
    for (const c of ALL_CASES) {
      it(`${c.id} @ ${fs / 1000} kHz: ${c.label}`, () => {
        const r = c.run(fs);
        expect(r.pass, `${r.expected} – gemessen ${r.measured}`).toBe(true);
      });
    }
  }
});

describe('LRA', () => {
  it('gates: silence gives no value, a constant level gives 0 LU', () => {
    expect(loudnessRange([])).toBeNull();
    expect(loudnessRange([-80, -90])).toBeNull();
    expect(loudnessRange(Array(100).fill(-23))).toBe(0);
  });
});

describe('generator', () => {
  const run = (cfg: Partial<GenConfig>, seconds: number, fs = 48000) => {
    const g = new ToneGenerator(fs, 2, { ...DEFAULT_GEN, ...cfg, running: true });
    const n = Math.round(seconds * fs), L = new Float32Array(n), R = new Float32Array(n);
    for (let off = 0; off < n; off += 128) {
      const len = Math.min(128, n - off);
      g.render([L.subarray(off, off + len), R.subarray(off, off + len)], len, off);
    }
    return [L, R];
  };
  const rms = (x: Float32Array, a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)); };
  const fs = 48000;

  it('1 kHz −18 dBFS stereo reads −18,0 LUFS (Tech 3341 calibration) and −18 dBTP', () => {
    const chs = run({ signal: 'sine', level: -18 }, 10);
    const { lm, lv } = measure(chs, fs);
    expect(lm.integrated).toBeCloseTo(-18, 1);
    expect(toDb(lv.maxTP[0])).toBeCloseTo(-18, 1);
    const exp = expectedSine({ ...DEFAULT_GEN, level: -18 }, (f) => kWeightingPowerGain(f, fs))!;
    expect(exp.lufs).toBeCloseTo(-18, 1);
  });
  it('fades in over 10 ms (no click)', () => {
    const [L] = run({ signal: 'sine', level: 0 }, 0.02);
    expect(Math.abs(L[10])).toBeLessThan(0.03);
  });
  it('EBU stereo ident: L silent for 250 ms every 3 s, R continuous', () => {
    const [L, R] = run({ signal: 'ebu-ident', level: -18 }, 6.5);
    expect(rms(L, 3 * fs + 480, 3.24 * fs)).toBe(0);
    expect(rms(L, 3.26 * fs, 3.5 * fs)).toBeGreaterThan(0.08);
    expect(rms(R, 3 * fs, 3.25 * fs)).toBeGreaterThan(0.08);
  });
  it('GLITS: L off 0–250 ms, R off 500–750 and 1000–1250 ms of the 4 s cycle', () => {
    const [L, R] = run({ signal: 'glits', level: -18 }, 5.5);
    const off = (x: Float32Array, a: number, b: number) => rms(x, Math.round((4 + a) * fs), Math.round((4 + b) * fs)) === 0;
    expect(off(L, 0.01, 0.24)).toBe(true);
    expect(off(R, 0.51, 0.74)).toBe(true);
    expect(off(R, 1.01, 1.24)).toBe(true);
    expect(off(R, 0.76, 0.99)).toBe(false);
    expect(off(L, 0.26, 1.3)).toBe(false);
  });
  it('pink noise has the RMS of a sine at the same peak level', () => {
    const [L] = run({ signal: 'pink', level: -20 }, 4);
    expect(20 * Math.log10(rms(L, fs, L.length))).toBeCloseTo(-23.01, 0);
  });
  it('polarity pulse is asymmetric and inverts with the route', () => {
    const chs = run({ signal: 'polarity', level: -6, routes: [{ on: true, invert: false, trim: 0 }, { on: true, invert: true, trim: 0 }] }, 1);
    const { lv } = measure(chs, fs);
    expect(lv.polarity(0)).toBe('+');
    expect(lv.polarity(1)).toBe('−');
    expect(lv.correlation(500)!).toBeLessThan(-0.99);
  });
  it('A/V-sync beep: 80 ms at the sync frame, silent in between', () => {
    const g = new ToneGenerator(fs, 2, { ...DEFAULT_GEN, signal: 'avsync', level: -6, running: true });
    g.avFrame0 = 24000; g.avPeriod = fs;
    const n = 2 * fs, L = new Float32Array(n), R = new Float32Array(n);
    for (let off = 0; off < n; off += 128) { const len = Math.min(128, n - off); g.render([L.subarray(off, off + len), R.subarray(off, off + len)], len, off); }
    expect(rms(L, 24000 + 10, 24000 + 3800)).toBeGreaterThan(0.3);
    expect(rms(L, 24000 + 3900, 24000 + 47000)).toBe(0);
    expect(rms(L, 72000 + 10, 72000 + 3800)).toBeGreaterThan(0.3);
  });
});

describe('spectrum', () => {
  it('a sine on a bin reads its peak level, the third-octave band keeps it', () => {
    const n = 8192, k = 171, x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * k * i) / n);
    const db = spectrumDb(x, 0, n);
    expect(db[k]).toBeCloseTo(-6.02, 1);
    const fs = 48000, f = (k * fs) / n, centres = thirdOctaveCentres();
    const band = thirdOctaveBands(db, fs, centres);
    const idx = centres.findIndex((c) => f >= c * 10 ** (-1 / 20) && f < c * 10 ** (1 / 20));
    expect(band[idx]).toBeCloseTo(-6.02, 0);
  });
});
