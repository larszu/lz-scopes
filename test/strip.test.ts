import { describe, expect, it } from 'vitest';
import { StillRing, ageLabel, stillEveryMs, stillFrom, stripOpts, tileAges } from '../src/strip';
import { Envelope, ENV_STEPS } from '../src/audio/dsp/envelope';
import { AudioAnalysis } from '../src/audio/analysis';
import { rgbDecoder } from '../src/ycbcr';

describe('picture history (strip.ts, #196)', () => {
  it('tiles: oldest left, now right, n × step', () => {
    expect(tileAges(6, 1)).toEqual([5, 4, 3, 2, 1, 0]);
    expect(tileAges(3, 0.5)).toEqual([1, 0.5, 0]);
    expect(ageLabel(0)).toBe('0');
    expect(ageLabel(2)).toBe('−2 s');
    expect(ageLabel(0.5)).toBe('−0.5 s');
  });
  it('options are clamped; stills every step / 10, at most ten a second', () => {
    expect(stripOpts()).toEqual({ count: 6, step: 1, wave: 'auto', channels: 'stereo' });
    expect(stripOpts({ count: 99, step: 60 })).toMatchObject({ count: 12, step: 5 });
    expect(stillEveryMs(1)).toBe(100);
    expect(stillEveryMs(0.5)).toBe(100);
    expect(stillEveryMs(5)).toBe(500);
  });
  it('a still keeps the aspect and averages 2 × 2 points per cell', () => {
    // 4 × 2 RGBA frame: left half black, right half white
    const w = 4, h = 2, px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 2; x < 4; x++) px.set([255, 255, 255, 255], (y * w + x) * 4);
    const s = stillFrom(px, w, h, rgbDecoder(255), 2);
    expect([s.w, s.h]).toEqual([2, 1]);
    expect(Array.from(s.px)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
    // never wider than the frame
    expect(stillFrom(px, w, h, rgbDecoder(255), 160).w).toBe(4);
  });
  it('the ring keeps only the span and finds the still nearest to an age', () => {
    const r = new StillRing(), still = (t: number) => ({ t, w: 1, h: 1, px: new Uint8ClampedArray(4) });
    for (let t = 0; t <= 10000; t += 100) r.push(still(t), 6000);
    expect(r.stills[0].t).toBe(4000);
    expect(r.near(9000 + 30, 75)?.t).toBe(9000);
    expect(r.near(1000, 75)).toBeNull();
  });
});

describe('audio envelope (audio/dsp/envelope.ts)', () => {
  it('reduces samples to min/max per 10 ms with the time of the last sample', () => {
    const e = new Envelope(1000, 2); // 10 samples per step
    const l = new Float32Array(25), r = new Float32Array(25);
    l[3] = 0.5; l[14] = -1; r[21] = 0.25;
    e.push([l, r], 25, 1000);
    expect(e.len).toBe(2);
    expect([e.min[0][0], e.max[0][0]]).toEqual([0, 0.5]);
    expect([e.min[0][1], e.max[0][1]]).toEqual([-1, 0]);
    // step 2 ends with sample 19; the last sample (24) arrived at t = 1000 → 995 ms
    expect(e.time[1]).toBeCloseTo(995, 6);
    // the rest (samples 20–24, peak 0.25 on the right) completes with the next push
    e.push([new Float32Array(5), new Float32Array(5)], 5, 1010);
    expect(e.max[1][2]).toBe(0.25);
    expect(e.since(996)).toEqual([2]);
    expect(e.since(0)).toEqual([0, 1, 2]);
  });
  it('is a ring of 60 s and is fed by the audio analysis', () => {
    const e = new Envelope(100, 1); // 1 sample per step
    const x = new Float32Array(ENV_STEPS + 10).map((_, i) => (i % 2 ? 0.1 : -0.1));
    e.push([x], x.length, 0);
    expect(e.len).toBe(ENV_STEPS);
    const a = new AudioAnalysis(48000, 2);
    a.push([new Float32Array(4800).fill(0.3), new Float32Array(4800).fill(-0.2)], 4800);
    expect(a.env.len).toBe(10);
    expect(a.env.max[0][9]).toBeCloseTo(0.3, 6);
    expect(a.env.min[1][9]).toBeCloseTo(-0.2, 6);
  });
});
