import { describe, expect, it } from 'vitest';
import { DriftBuffer } from '../src/audio/dsp/driftbuffer';

/** Producer with clock error `ppm` sends 20 ms packets with jitter; the sound card pulls 128 frames. */
function run(ppm: number, seconds: number) {
  const fs = 48000, b = new DriftBuffer(2, fs, 120);
  const prodRate = fs * (1 + ppm / 1e6);
  let produced = 0, t = 0, phase = 0, rng = 7;
  const out = [new Float32Array(128), new Float32Array(128)];
  const fills: number[] = [], ppms: number[] = [];
  let maxStep = 0, prev = 0;
  while (t < seconds) {
    t += 128 / fs;
    // packets of 960 frames arrive in bursts (network jitter up to 30 ms)
    rng = (rng * 16807) % 2147483647;
    const due = Math.floor((t - 0.03 * (rng / 2147483647)) * prodRate);
    while (produced + 960 <= due) {
      const L = new Float32Array(960), R = new Float32Array(960);
      for (let i = 0; i < 960; i++) { L[i] = Math.sin(phase); R[i] = L[i]; phase += (2 * Math.PI * 1000) / prodRate; }
      b.push([L, R], 960); produced += 960;
    }
    b.pull(out, 128);
    for (let i = 0; i < 128; i++) { maxStep = Math.max(maxStep, Math.abs(out[0][i] - prev)); prev = out[0][i]; }
    if (t > seconds - 10) { fills.push(b.stats().fillMs); ppms.push(b.stats().ppm); }
  }
  return { st: b.stats(), fills, maxStep, ppm: ppms.reduce((s, v) => s + v, 0) / ppms.length };
}

describe('drift-compensated monitoring buffer', () => {
  for (const ppm of [0, 150, -300, 1000]) {
    it(`keeps the fill at the target with a ${ppm} ppm clock difference, no underruns after start`, () => {
      const { st, fills, maxStep, ppm: meanPpm } = run(ppm, 120);
      const mean = fills.reduce((s, v) => s + v, 0) / fills.length;
      expect(Math.abs(mean - 120)).toBeLessThan(15);
      expect(st.underruns).toBe(0);
      expect(st.overruns).toBe(0);
      expect(Math.abs(meanPpm - ppm)).toBeLessThan(50);
      // 1 kHz sine at 48 kHz changes by at most 2π·1000/48000 ≈ 0.131 per sample: no clicks
      expect(maxStep).toBeLessThan(0.14);
    });
  }
});
