import { describe, expect, it } from 'vitest';
import { AvSyncMeter, rateAv } from '../src/audio/dsp/avsync';
import { DEFAULT_GEN, ToneGenerator } from '../src/audio/dsp/signals';

const fs = 48000;

/**
 * A camera at `fps` sees an 80 ms flash starting at every whole second + videoDelay;
 * the microphone hears the generator's A/V-sync beep at every whole second + audioDelay.
 * Each frame integrates the light over its full frame time (exposure = 1/fps).
 */
function simulate(fps: number, videoDelay: number, audioDelay: number, seconds = 6, noise = 0.001) {
  const m = new AvSyncMeter(fs);
  const flashOn = (t: number) => { const u = t - videoDelay - Math.floor(t - videoDelay); return u < 0.08 ? 1 : 0; };
  const g = new ToneGenerator(fs, 2, { ...DEFAULT_GEN, signal: 'avsync', level: -12, running: true });
  g.avFrame0 = Math.round(audioDelay * fs); g.avPeriod = fs;
  const block = 960; // 20 ms packets as from the bridge
  let frame = 0;
  let rng = 1;
  const rnd = () => { rng = (rng * 16807) % 2147483647; return rng / 2147483647 - 0.5; };
  for (let off = 0; off < seconds * fs; off += block) {
    const L = new Float32Array(block), R = new Float32Array(block);
    g.render([L, R], block, off);
    for (let i = 0; i < block; i++) { L[i] += noise * rnd(); R[i] += noise * rnd(); }
    m.pushAudio([L, R], block, off / fs);
    // frames whose exposure ended before the end of this audio packet
    while ((frame + 1) / fps <= (off + block) / fs) {
      const t0 = frame / fps;
      let e = 0;
      for (let k = 0; k < 40; k++) e += flashOn(t0 + (k + 0.5) / (40 * fps));
      // PTS = start of the exposure; luma 0.05 dark, 0.95 bright
      m.pushVideo(t0, 0.05 + 0.9 * (e / 40));
      frame++;
    }
  }
  return m.result();
}

describe('A/V offset (flash ↔ beep, ITU-R BT.1359-1 sign)', () => {
  it('in sync reads 0 ms (± 3 ms with the exposure model)', () => {
    const r = simulate(25, 0, 0);
    expect(r.pairs.length).toBeGreaterThanOrEqual(4);
    expect(Math.abs(r.medianMs!)).toBeLessThan(3);
    expect(r.frameMs!).toBeCloseTo(40, 3);
  });
  it('sound 100 ms late reads about −100 ms (sound delayed = negative)', () => {
    const r = simulate(50, 0, 0.1);
    expect(r.medianMs!).toBeGreaterThan(-103);
    expect(r.medianMs!).toBeLessThan(-97);
    expect(rateAv(r.medianMs!)).toBe('undetectable');
  });
  it('picture 60 ms late reads about +60 ms (sound advanced = positive)', () => {
    const r = simulate(50, 0.06, 0);
    expect(r.medianMs!).toBeGreaterThan(57);
    expect(r.medianMs!).toBeLessThan(63);
    expect(rateAv(r.medianMs!)).toBe('acceptable');
  });
  it('a flash starting inside a frame is placed within the frame (25 fps, +13 ms)', () => {
    const r = simulate(25, 0.013, 0);
    expect(r.medianMs!).toBeGreaterThan(10);
    expect(r.medianMs!).toBeLessThan(16);
  });
  it('ratings follow BT.1359-1 (+45/−125 detectability, +90/−185 acceptability)', () => {
    expect(rateAv(45)).toBe('undetectable');
    expect(rateAv(46)).toBe('acceptable');
    expect(rateAv(-125)).toBe('undetectable');
    expect(rateAv(-126)).toBe('acceptable');
    expect(rateAv(90)).toBe('acceptable');
    expect(rateAv(91)).toBe('unacceptable');
    expect(rateAv(-186)).toBe('unacceptable');
  });
  it('without timestamps nothing is measured and the reason is named', () => {
    const m = new AvSyncMeter(fs);
    m.pushVideo(NaN, 0.5);
    expect(m.result().problem).toContain('PTS');
  });
});
