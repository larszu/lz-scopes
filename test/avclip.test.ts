import { describe, expect, it } from 'vitest';
import { analyzeClip, type ClipFrame } from '../src/audio/dsp/avclip';
import { DEFAULT_GEN, ToneGenerator } from '../src/audio/dsp/signals';

const fs = 48000;

/**
 * A phone clip: the monitor fills only part of the frame, so the flash moves the mean luma
 * from 0.30 to 0.36; the beep of the generator is recorded mono with room noise.
 */
function clip(fps: number, videoDelay: number, audioDelay: number, seconds = 6) {
  const flashOn = (t: number) => { const u = t - videoDelay - Math.floor(t - videoDelay); return u < 0.08 ? 1 : 0; };
  const frames: ClipFrame[] = [];
  for (let f = 0; f / fps < seconds; f++) {
    const t0 = f / fps;
    let e = 0;
    for (let k = 0; k < 40; k++) e += flashOn(t0 + (k + 0.5) / (40 * fps));
    frames.push({ t: t0, y: 0.3 + 0.06 * (e / 40) });
  }
  const g = new ToneGenerator(fs, 1, { ...DEFAULT_GEN, signal: 'avsync', level: -20, running: true });
  g.avFrame0 = Math.round(audioDelay * fs); g.avPeriod = fs;
  const a = new Float32Array(seconds * fs);
  g.render([a], a.length, 0);
  let rng = 7;
  for (let i = 0; i < a.length; i++) { rng = (rng * 16807) % 2147483647; a[i] += 0.003 * (rng / 2147483647 - 0.5); }
  return analyzeClip(frames, [a], fs);
}

describe('A/V offset of a dropped clip (#153)', () => {
  it('in sync at 30 fps', () => {
    const r = clip(30, 0, 0);
    expect(r.fps).toBeCloseTo(30, 1);
    expect(r.pairs).toBeGreaterThanOrEqual(4);
    expect(r.verdict).toBe('sync');
    expect(Math.abs(r.offsetMs!)).toBeLessThan(4);
  });
  it('sound 100 ms late at 25 fps → −100 ms, −2.5 frames, late', () => {
    const r = clip(25, 0, 0.1);
    expect(r.fps).toBeCloseTo(25, 1);
    expect(r.offsetMs!).toBeGreaterThan(-104);
    expect(r.offsetMs!).toBeLessThan(-96);
    expect(r.frames!).toBeCloseTo(-2.5, 0);
    expect(r.verdict).toBe('late');
  });
  it('sound 60 ms early at 59.94 fps → +60 ms, early', () => {
    const r = clip(59.94, 0.06, 0);
    expect(r.fps).toBeCloseTo(59.94, 1);
    expect(r.offsetMs!).toBeGreaterThan(56);
    expect(r.offsetMs!).toBeLessThan(64);
    expect(r.frames!).toBeCloseTo(3.6, 0);
    expect(r.verdict).toBe('early');
  });
  it('no beep → no result, frame rate still known', () => {
    const r = analyzeClip([{ t: 0, y: 0 }, { t: 0.04, y: 1 }, { t: 0.08, y: 0 }], [new Float32Array(fs)], fs);
    expect(r.fps).toBe(25);
    expect(r.offsetMs).toBeNull();
    expect(r.verdict).toBeNull();
    expect(r.frameCount).toBe(3);
    expect(r.lumaSpan).toBe(1);
  });
});
