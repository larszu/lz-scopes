import { describe, expect, it } from 'vitest';
import { S337Detector, parseDolbyBsi } from '../src/audio/dsp/s337';
import { canDownmix, listenMatrix, parseListen } from '../src/audio/dsp/downmix';
import { channelInfo } from '../src/audio/dsp/layouts';

// Fixtures from the layouts cited in src/audio/dsp/s337.ts (ST 337/338, A/52), not captured (#234).

/** MSB-first bit writer. */
function bits(fields: [number, number][]): number[] {
  const out: number[] = [];
  let acc = 0, n = 0;
  for (const [v, w] of fields) for (let i = w - 1; i >= 0; i--) { acc = (acc << 1) | ((v >> i) & 1); if (++n === 8) { out.push(acc); acc = 0; n = 0; } }
  if (n) out.push(acc << (8 - n));
  return out;
}
/** AC-3 5.1, 48 kHz, 384 kbit/s, dialnorm −27. */
const ac3 = bits([[0x0b77, 16], [0, 16], [0, 2], [28, 6], [8, 5], [0, 3], [7, 3], [1, 2], [1, 2], [1, 1], [27, 5], [0, 8]]);
/** E-AC-3 independent stream, 48 kHz, 6 blocks, frmsiz 767 (1536 bytes → 384 kbit/s), 3/2.1, dialnorm −24. */
const eac3 = bits([[0x0b77, 16], [0, 2], [0, 3], [767, 11], [0, 2], [3, 2], [7, 3], [1, 1], [16, 5], [24, 5], [0, 8]]);

/** 24-bit word → float as ffmpeg delivers it. */
const f = (w24: number) => ((w24 << 8) >> 8) / 8388608;

/** One pair with a burst every `period` frames: Pa/Pb, Pc/Pd, payload words. */
function pair(mode: 16 | 20 | 24, dataType: number, payload16: number[], frames: number, period: number, stream = 0) {
  const shift = 24 - mode;
  const pa = { 16: 0xf872, 20: 0x6f872, 24: 0x96f872 }[mode], pb = { 16: 0x4e1f, 20: 0x54e1f, 24: 0xa54e1f }[mode];
  const pc = (dataType | (mode === 16 ? 0 : mode === 20 ? 1 : 2) << 5 | stream << 13) << (mode - 16);
  const A = new Float32Array(frames), B = new Float32Array(frames);
  for (let s = 0; s + 2 + payload16.length / 2 < frames; s += period) {
    A[s] = f(pa << shift); B[s] = f(pb << shift);
    A[s + 1] = f(pc << shift); B[s + 1] = f((payload16.length * 16) << shift);
    for (let k = 0; k < payload16.length; k += 2) { A[s + 2 + k / 2] = f((payload16[k] << (mode - 16)) << shift); B[s + 2 + k / 2] = f(((payload16[k + 1] ?? 0) << (mode - 16)) << shift); }
  }
  return [A, B];
}
const words = (bytes: number[]) => { const w: number[] = []; for (let i = 0; i < bytes.length; i += 2) w.push((bytes[i] << 8) | (bytes[i + 1] ?? 0)); while (w.length < 24) w.push(0); return w; };

describe('AC-3 / E-AC-3 bit stream information (A/52)', () => {
  it('AC-3 5.1', () => {
    expect(parseDolbyBsi(ac3)).toMatchObject({ codec: 'AC-3', bsid: 8, sampleRate: 48000, kbps: 384, mode: '3/2.1', channels: 6, dialnorm: -27, bsmod: 0 });
  });
  it('E-AC-3 5.1', () => {
    expect(parseDolbyBsi(eac3)).toMatchObject({ codec: 'E-AC-3', bsid: 16, sampleRate: 48000, kbps: 384, mode: '3/2.1', dialnorm: -24, strmtyp: 0 });
  });
  it('no syncword → null', () => expect(parseDolbyBsi([0, 0, 0, 0, 0, 0, 0, 0])).toBeNull());
});

describe('ST 337 bursts in PCM pairs', () => {
  it('Dolby E (type 28) in 20-bit mode on channels 3/4, period 1920 = 25 fps', () => {
    const d = new S337Detector();
    const silent = [new Float32Array(4000), new Float32Array(4000)];
    d.push([...silent, ...pair(20, 28, new Array(24).fill(0x1234), 4000, 1920, 2)], 4000);
    const r = d.result();
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ pair: 1, bits: 20, dataType: 28, name: 'Dolby E', stream: 2, period: 1920, error: false });
  });
  it('AC-3 in 16-bit mode with its header, across chunk boundaries', () => {
    const d = new S337Detector();
    const [A, B] = pair(16, 1, words(ac3), 3072, 1536);
    for (let i = 0; i < 3072; i += 100) d.push([A.subarray(i, i + 100), B.subarray(i, i + 100)], Math.min(100, 3072 - i));
    const r = d.result();
    expect(r[0]).toMatchObject({ pair: 0, name: 'AC-3', bits: 16, period: 1536 });
    expect(r[0].bsi).toMatchObject({ codec: 'AC-3', mode: '3/2.1' });
  });
  it('plain PCM: nothing found', () => {
    const d = new S337Detector();
    const A = Float32Array.from({ length: 4800 }, (_, i) => 0.5 * Math.sin(i / 7)), B = A.slice();
    d.push([A, B], 4800);
    expect(d.result()).toEqual([]);
  });
});

describe('monitor downmix (BS.775-3, A/52 §7.8.2)', () => {
  const info51 = channelInfo(6, '5.1');
  const K = Math.SQRT1_2;
  it('Lo/Ro of 5.1: L + .707 C + .707 Ls, LFE dropped', () => {
    const [L, R] = listenMatrix(info51, { kind: 'loro' });
    expect(L.map((v) => +v.toFixed(4))).toEqual([1, 0, +K.toFixed(4), 0, +K.toFixed(4), 0]);
    expect(R.map((v) => +v.toFixed(4))).toEqual([0, 1, +K.toFixed(4), 0, 0, +K.toFixed(4)]);
  });
  it('Lt/Rt of 5.1: surrounds as mono S, −S left, +S right', () => {
    const [L, R] = listenMatrix(info51, { kind: 'ltrt' });
    expect(L[4]).toBeCloseTo(-K); expect(L[5]).toBeCloseTo(-K);
    expect(R[4]).toBeCloseTo(K); expect(R[5]).toBeCloseTo(K);
    expect(L[2]).toBeCloseTo(K); expect(L[3]).toBe(0);
  });
  it('solo, pairs, parsing, when a downmix is offered', () => {
    expect(listenMatrix(info51, { kind: 'solo', ch: 2 })).toEqual([[0, 0, 1, 0, 0, 0], [0, 0, 1, 0, 0, 0]]);
    expect(listenMatrix(info51, { kind: 'pair', pair: 1 })).toEqual([[0, 0, 1, 0, 0, 0], [0, 0, 0, 1, 0, 0]]);
    expect(parseListen('s5')).toEqual({ kind: 'solo', ch: 5 });
    expect(parseListen('ltrt')).toEqual({ kind: 'ltrt' });
    expect(parseListen('x')).toEqual({ kind: 'pair', pair: 0 });
    expect(canDownmix(info51)).toBe(true);
    expect(canDownmix(channelInfo(2, 'stereo'))).toBe(false);
    expect(canDownmix(channelInfo(16, ''))).toBe(false);
  });
  it('7.1.4: every channel except LFE ends up in the downmix', () => {
    const info = channelInfo(12, '7.1.4');
    const [L, R] = listenMatrix(info, { kind: 'loro' });
    info.forEach((c, i) => expect(c.lfe ? L[i] + R[i] : L[i] + R[i] > 0).toBe(c.lfe ? 0 : true));
  });
});
