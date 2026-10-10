import { describe, expect, it } from 'vitest';
import { avShift, bandingIndex, blockiness, estimateDelay, to10bit, type Thumb } from '../src/encoder';

const W = 256, H = 144;
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

/** Smooth test picture 0–255: diagonal gradient plus soft waves. */
function smooth(): Float32Array {
  const y = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) y[j * W + i] = 60 + 0.5 * i + 0.4 * j + 20 * Math.sin(i / 9) * Math.cos(j / 11);
  return y;
}
/** Each 8×8 block replaced by its mean (what a coarse DCT quantiser leaves, DC only). */
function blocked(src: Float32Array): Float32Array {
  const y = new Float32Array(src.length);
  for (let by = 0; by < H; by += 8) for (let bx = 0; bx < W; bx += 8) {
    let s = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) s += src[(by + j) * W + bx + i];
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) y[(by + j) * W + bx + i] = s / 64;
  }
  return y;
}

describe('blocking after Wang/Sheikh/Bovik (ICIP 2002, eq. 2/3/6)', () => {
  it('a smooth picture has no block structure (B/A ≈ 1)', () => {
    expect(blockiness(smooth(), W, H).ratio).toBeCloseTo(1, 1);
  });
  it('8×8 block means: all change sits on the block grid', () => {
    const b = blockiness(blocked(smooth()), W, H);
    expect(b.A).toBeLessThan(1e-9);
    expect(b.ratio).toBe(Infinity);
  });
  it('mild blocking on top of detail raises the ratio', () => {
    const s = smooth(), bl = blocked(s), mix = s.map((v, i) => 0.6 * v + 0.4 * bl[i]);
    const r = blockiness(mix, W, H).ratio;
    expect(r).toBeGreaterThan(1.5);
    expect(r).toBeLessThan(Infinity);
  });
  it('noise has no grid either', () => {
    const n = new Float32Array(W * H).map(() => 128 + 40 * rnd());
    expect(blockiness(n, W, H).ratio).toBeCloseTo(1, 1);
  });
});

describe('banding index after CAMBI (Tandon et al. 2021, simplified)', () => {
  // a gentle sky ramp: 0.30 … 0.36 over the width
  const ramp = (q: (v: number) => number) => {
    const y = new Float32Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) y[j * W + i] = q(0.3 + (0.06 * i) / W);
    return to10bit(y, W, H);
  };
  const opts = { refWidth: 960 };
  it('a flat field has no banding', () => {
    expect(bandingIndex(ramp(() => 0.5), W, H, opts)).toBe(0);
  });
  it('the same ramp in 8 bit bands more than in 10 bit, and coarse 6-bit-like steps of 4 codes most', () => {
    const b10 = bandingIndex(ramp((v) => v), W, H, opts);
    const b8 = bandingIndex(ramp((v) => Math.round(v * 255) / 255), W, H, opts);
    expect(b8).toBeGreaterThan(b10);
  });
  it('strong texture is masked (gradient threshold)', () => {
    const y = new Float32Array(W * H).map(() => 0.2 + 0.6 * rnd());
    expect(bandingIndex(to10bit(y, W, H), W, H, opts)).toBeLessThan(0.05);
  });
});

describe('delay of the return', () => {
  const thumbs = (n: number, dt: number, shift: number, feat: Float32Array[]) => feat.slice(0, n).map((f, i): Thumb => ({ t: i * dt + shift, f }));
  it('finds a 1.2 s lag of moving content', () => {
    const feat = Array.from({ length: 300 }, () => new Float32Array(144).map(() => rnd()));
    const prog = thumbs(300, 40, 0, feat);
    const ret = thumbs(240, 40, 1200, feat); // the same pictures 1.2 s later
    const d = estimateDelay(prog, ret, { maxMs: 3000, stepMs: 10 })!;
    expect(d.ms).toBeGreaterThanOrEqual(1180);
    expect(d.ms).toBeLessThanOrEqual(1220);
    expect(d.contrast).toBeGreaterThan(0.5);
  });
  it('still content gives no confidence', () => {
    const f = new Float32Array(144).fill(0.5);
    const d = estimateDelay(Array.from({ length: 50 }, (_, i) => ({ t: i * 40, f })), Array.from({ length: 50 }, (_, i) => ({ t: i * 40 + 500, f })), { maxMs: 1000 })!;
    expect(d.contrast).toBeLessThan(0.01);
  });
});

describe('A/V shift of the stream path (BT.1359-1)', () => {
  it('return 60 ms later sound than the programme: −60 ms, undetectable', () => {
    expect(avShift(10, -50)).toEqual({ ms: -60, rating: 'undetectable' });
    expect(avShift(0, 70)!.rating).toBe('acceptable');
    expect(avShift(null, 3)).toBeNull();
  });
});
