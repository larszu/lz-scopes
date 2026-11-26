// Sound level meter, RTA bands and stereo field per band (#186, #187).
import { describe, expect, it } from 'vitest';
import { WeightingFilter, bandLabel, bandPowers, fractionalOctaveBands, weightingDb } from '../src/audio/dsp/weighting';
import { SplMeter, msDb, peakDb } from '../src/audio/dsp/spl';
import { powerSpectrum } from '../src/audio/dsp/fft';
import { averageSums, bandField, bandSums, monoLossDb, totalCorrelation } from '../src/audio/dsp/stereofield';
import { AudioAnalysis } from '../src/audio/analysis';

const sine = (f: number, a: number, fs: number, n: number, ph = 0) => Float32Array.from({ length: n }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / fs + ph));
/** deterministic white noise */
function noise(n: number, seed: number) {
  let s = seed >>> 0;
  return Float32Array.from({ length: n }, () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 2 ** 32 - 0.5) * 0.5; });
}

describe('frequency weightings A and C (IEC 61672-1:2013 Annex E)', () => {
  it('formula reproduces the nominal values of Table 3 (rounded to 0.1 dB)', () => {
    const A: [number, number][] = [[31.5, -39.4], [63, -26.2], [100, -19.1], [250, -8.6], [500, -3.2], [1000, 0], [2000, 1.2], [4000, 1.0], [8000, -1.1], [10000, -2.5], [16000, -6.6]];
    const C: [number, number][] = [[31.5, -3.0], [63, -0.8], [100, -0.3], [1000, 0], [4000, -0.8], [8000, -3.0], [10000, -4.4], [16000, -8.5]];
    // Table 3 uses the nominal band centres; the exact base-10 frequencies give the table values
    const exact = (f: number) => 1000 * 10 ** (Math.round(10 * Math.log10(f / 1000)) / 10);
    for (const [f, v] of A) expect(weightingDb('A', exact(f)), `A ${f}`).toBeCloseTo(v, 1);
    for (const [f, v] of C) expect(weightingDb('C', exact(f)), `C ${f}`).toBeCloseTo(v, 1);
  });
  it('digital filters follow Annex E: ±0.05 dB up to 1 kHz, ±1 dB up to 12.5 kHz at 48 kHz, inside class 1 at 16 kHz', () => {
    for (const w of ['A', 'C'] as const) {
      const fl = new WeightingFilter(w, 48000);
      for (const f of [10, 20, 31.5, 63, 125, 250, 500, 1000]) expect(Math.abs(fl.responseDb(f) - weightingDb(w, f)), `${w} ${f}`).toBeLessThan(0.05);
      for (const f of [2000, 4000, 8000, 10000, 12500]) expect(Math.abs(fl.responseDb(f) - weightingDb(w, f)), `${w} ${f}`).toBeLessThan(1);
      // IEC 61672-1 Table 3, class 1 at 16 kHz: +2.5 / −16 dB
      const d16 = fl.responseDb(16000) - weightingDb(w, 16000);
      expect(d16).toBeGreaterThan(-16); expect(d16).toBeLessThan(2.5);
    }
  });
});

describe('sound level meter (IEC 61672-1)', () => {
  const fs = 48000;
  it('1 kHz sine of amplitude 0.5: L_AF = L_CF = L_Z = −6.0 dB re full-scale sine, L_Cpeak 3 dB higher', () => {
    const m = new SplMeter(fs);
    m.process(sine(1000, 0.5, fs, fs * 10), fs * 10, 0);
    for (const w of ['A', 'C', 'Z'] as const) {
      expect(msDb(m.level(w, 'F')), w).toBeCloseTo(-6.02, 1);
      expect(msDb(m.level(w, 'S')), w).toBeCloseTo(-6.02, 1);
    }
    expect(msDb(m.leq('A', 1).ms)).toBeCloseTo(-6.02, 1);
    expect(peakDb(m.maxSince('C', 'F', -1).peak)).toBeCloseTo(-6.02 + 3.01, 1);
  });
  it('A weighting attenuates 100 Hz by 19.14 dB (Annex E; Table 3: 19.1)', () => {
    const m = new SplMeter(fs);
    m.process(sine(100, 1, fs, fs * 10), fs * 10, 0);
    expect(msDb(m.level('A', 'S'))).toBeCloseTo(weightingDb('A', 100), 1);
    expect(msDb(m.level('Z', 'S'))).toBeCloseTo(0, 1);
  });
  it('decay after switch-off: F 34.7 dB/s, S 4.3 dB/s (§5.8)', () => {
    const m = new SplMeter(fs);
    m.process(sine(1000, 1, fs, fs * 6), fs * 6, 0);
    const f0 = msDb(m.level('Z', 'F')), s0 = msDb(m.level('Z', 'S'));
    m.process(new Float32Array(fs / 2), fs / 2, 6000);
    expect(f0 - msDb(m.level('Z', 'F'))).toBeCloseTo(34.7 * 0.5, 0);
    expect(s0 - msDb(m.level('Z', 'S'))).toBeCloseTo(4.34 * 0.5, 1);
  });
  it('L_eq over a period is the energy mean; since reset covers everything after the reset', () => {
    const m = new SplMeter(fs);
    // 10 s at −10 dB, then 10 s at −20 dB → Leq,20 s = 10 lg((10^−1 + 10^−2)/2) = −12.6 dB
    m.process(sine(1000, 10 ** (-10 / 20), fs, fs * 10), fs * 10, 0);
    m.process(sine(1000, 10 ** (-20 / 20), fs, fs * 10), fs * 10, 10000);
    expect(msDb(m.leq('Z', 20).ms)).toBeCloseTo(10 * Math.log10((0.1 + 0.01) / 2), 1);
    expect(msDb(m.leq('Z', 10).ms)).toBeCloseTo(-20, 1);
    expect(msDb(m.leq('Z', 0).ms)).toBeCloseTo(10 * Math.log10((0.1 + 0.01) / 2), 1);
    m.reset();
    m.process(sine(1000, 10 ** (-30 / 20), fs, fs * 2), fs * 2, 20000);
    expect(msDb(m.leq('Z', 0).ms)).toBeCloseTo(-30, 0);
  });
  it('the analysis creates a meter per channel on demand and feeds it', () => {
    const a = new AudioAnalysis(fs, 2);
    const m = a.spl(1);
    a.push([new Float32Array(fs), sine(1000, 0.5, fs, fs)], fs);
    expect(msDb(m.level('A', 'F'))).toBeCloseTo(-6.02, 1);
    expect(a.spl(1)).toBe(m);
  });
});

describe('fractional-octave bands (IEC 61260-1, base 10)', () => {
  it('centres and edges', () => {
    const third = fractionalOctaveBands(3);
    expect(third.length).toBe(31);
    expect(third.find((b) => Math.abs(b.fm - 1000) < 1e-9)).toBeTruthy();
    expect(third[0].fm).toBeCloseTo(19.95, 2);
    const oct = fractionalOctaveBands(1);
    expect(oct.map((b) => Math.round(b.fm))).toEqual([32, 63, 126, 251, 501, 1000, 1995, 3981, 7943, 15849]);
    expect(oct[5].hi / oct[5].lo).toBeCloseTo(10 ** 0.3, 9);
    // even b: centres between, 1000 Hz is a band edge
    const sixth = fractionalOctaveBands(6);
    expect(sixth.some((b) => Math.abs(b.hi - 1000) < 1e-6)).toBe(true);
    expect(fractionalOctaveBands(48).length).toBeGreaterThan(470);
    expect(third.map((b) => bandLabel(b.fm)).slice(0, 12)).toEqual(['20', '25', '31.5', '40', '50', '63', '80', '100', '125', '160', '200', '250']);
    expect(third.map((b) => bandLabel(b.fm)).slice(-4)).toEqual(['10k', '12.5k', '16k', '20k']);
  });
  it('a full-scale sine reads 0 dB in its band, white noise rises by 3 dB per octave', () => {
    const fs = 48000, n = 16384;
    const bands = fractionalOctaveBands(3);
    const p = bandPowers(powerSpectrum(sine(1000, 1, fs, n), 0, n), fs, bands);
    const i = bands.findIndex((b) => Math.abs(b.fm - 1000) < 1e-9);
    expect(10 * Math.log10(p[i])).toBeCloseTo(0, 0);
    const oct = fractionalOctaveBands(1);
    let acc = new Float64Array(oct.length);
    for (let s = 0; s < 16; s++) { const q = bandPowers(powerSpectrum(noise(n, s + 1), 0, n), fs, oct); acc = acc.map((v, k) => v + q[k] / 16); }
    const k1 = oct.findIndex((b) => Math.abs(b.fm - 1000) < 1e-9);
    expect(10 * Math.log10(acc[k1 + 1] / acc[k1])).toBeCloseTo(3.01, 0);
  });
});

describe('stereo field per band (#186)', () => {
  const fs = 48000, n = 8192, bands = fractionalOctaveBands(3, 20, 20000);
  const run = (l: (s: number) => Float32Array, r: (s: number) => Float32Array, frames = 24) => {
    let acc = null as ReturnType<typeof bandSums> | null;
    for (let s = 0; s < frames; s++) { const now = bandSums(l(s), r(s), n, fs, bands); if (acc) averageSums(acc, now, 0.8); else acc = now; }
    return acc!;
  };
  it('mono: correlation +1, width 0, mono loss 0 dB', () => {
    const s = run((k) => noise(n, k + 1), (k) => noise(n, k + 1));
    const f = bandField(s, bands);
    for (const b of f.filter((x) => x.fm > 50)) { expect(b.corr!).toBeCloseTo(1, 3); expect(b.width!).toBeLessThan(1e-3); expect(Math.abs(b.balance!)).toBeLessThan(1e-6); }
    expect(monoLossDb(s, bands, fs)!).toBeCloseTo(0, 3);
  });
  it('out of phase: correlation −1, width 1, the mono sum cancels', () => {
    const s = run((k) => noise(n, k + 1), (k) => noise(n, k + 1).map((v) => -v));
    for (const b of bandField(s, bands).filter((x) => x.fm > 50)) { expect(b.corr!).toBeCloseTo(-1, 3); expect(b.width!).toBeCloseTo(1, 3); }
    expect(monoLossDb(s, bands, fs)).toBe(-Infinity);
  });
  it('independent noise: correlation near 0, width near ½, mono about −3 dB', () => {
    const s = run((k) => noise(n, 2 * k + 1), (k) => noise(n, 2 * k + 1000), 60);
    const f = bandField(s, bands).filter((x) => x.fm > 500);
    for (const b of f) { expect(Math.abs(b.corr!)).toBeLessThan(0.35); expect(b.width!).toBeGreaterThan(0.3); expect(b.width!).toBeLessThan(0.7); }
    expect(monoLossDb(s, bands, fs)!).toBeGreaterThan(-4); expect(monoLossDb(s, bands, fs)!).toBeLessThan(-2);
  });
  it('bass out of phase shows in its band although the total correlation stays positive', () => {
    const hi = (k: number) => noise(n, k + 7);
    const l = (k: number) => { const x = hi(k), b = sine(63, 0.08, fs, n, k); return x.map((v, i) => v + b[i]); };
    const r = (k: number) => { const x = hi(k), b = sine(63, 0.08, fs, n, k); return x.map((v, i) => v - b[i]); };
    const s = run(l, r);
    const f = bandField(s, bands), b63 = f.find((x) => Math.abs(x.fm - 63.1) < 0.1)!;
    expect(b63.corr!).toBeLessThan(-0.8);
    expect(totalCorrelation(s)!).toBeGreaterThan(0);
  });
});

describe('new audio panels draw without errors (#183, #186, #187)', () => {
  // 2D context stand-in: records fillText, everything else is a no-op
  const fakeCtx = (texts: string[]) => new Proxy({} as Record<string, unknown>, {
    get: (o, k) => {
      if (k === 'fillText') return (s: string) => texts.push(s);
      if (k === 'createLinearGradient') return () => ({ addColorStop: () => {} });
      if (k === 'measureText') return (s: string) => ({ width: s.length * 6 });
      return k in o ? o[k as string] : () => {};
    },
    set: (o, k, v) => { o[k as string] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  it('surround, stereo field, sound level and RTA with snapshots', async () => {
    const { drawAudioPanel } = await import('../src/audio/panels');
    const { rtaCurve } = await import('../src/audio/soundPanels');
    const fs = 48000, a = new AudioAnalysis(fs, 6, '5.1');
    for (let s = 0; s < 4; s++) a.push(Array.from({ length: 6 }, (_, c) => noise(fs / 2, s * 10 + c + 1)), fs / 2);
    const texts: string[] = [];
    const ctx = fakeCtx(texts);
    const key = {};
    for (const scope of ['audio-surround', 'audio-field', 'audio-spl', 'audio-rta', 'audio-meter']) drawAudioPanel(ctx, scope, a, 800, 500, { labels: ',,Mitte' }, '', key);
    expect(texts).toContain('Mitte'); // own channel label (#183)
    expect(texts).toContain('3/4'); // AES3 pair labels at the meter
    expect(texts.some((s) => s.startsWith('LAF'))).toBe(true);
    const c = rtaCurve(key)!;
    expect(c.f.length).toBe(c.db.length);
    drawAudioPanel(ctx, 'audio-rta', a, 800, 500, { snaps: [{ name: 'Ref', at: 0, ...c }], frac: 48, xlin: true, rtaWeight: 'A', cal: 110 }, '', key);
    expect(texts).toContain('– – Ref');
  });
});
