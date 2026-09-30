import { describe, expect, it } from 'vitest';
import { LtcReader, biphaseMark, decodeLtcWord, encodeLtcWord } from '../src/audio/dsp/ltc';
import { formatTc, fromFrames, rateById, toFrames } from '../src/clock/timecode';

const fs = 48000;

function words(startTc: string, n: number, rateId: string, df: boolean) {
  const r = rateById(rateId);
  const [hh, mm, ss, ff] = startTc.split(/[:;]/).map(Number);
  const f0 = toFrames({ hh, mm, ss, ff, df }, r);
  return Array.from({ length: n }, (_, i) => {
    const t = fromFrames(f0 + i, r, df);
    return { t, bits: encodeLtcWord({ ...t, userBits: [1, 2, 3, 4, 5, 6, 7, 8] }, r.nominal) };
  });
}

/** one-pole low-pass (rise time), white noise, DC offset */
function degrade(x: Float32Array, noise = 0.02, dc = 0.1, lp = 0.35) {
  let y = 0, seed = 1;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  return x.map((v) => (y += lp * (v - y)) + noise * rnd() + dc);
}

describe('LTC code word (EBU Tech 3097 §3.3, §4.5)', () => {
  it('sync word at bits 64–79 and even number of zeros', () => {
    const b = encodeLtcWord({ hh: 10, mm: 20, ss: 30, ff: 12 }, 25);
    expect(b.slice(64).join('')).toBe('0011111111111101');
    expect(b.filter((v) => v === 0).length % 2).toBe(0);
    expect(decodeLtcWord(b)).toMatchObject({ hh: 10, mm: 20, ss: 30, ff: 12, df: false });
  });
  it('drop-frame flag is bit 10', () => {
    const b = encodeLtcWord({ hh: 1, mm: 0, ss: 0, ff: 0, df: true }, 30);
    expect(b[10]).toBe(1);
    expect(decodeLtcWord(b)?.df).toBe(true);
  });
  it('biphase mark: every cell starts with a transition, "1" has one in the middle', () => {
    const x = biphaseMark([[0, 1, 0]], 8, 1);
    const s = Array.from(x).map((v) => (v > 0 ? '+' : '-')).join('');
    expect(s).toBe('++++++++----++++--------');
  });
});

describe('LTC reader with a synthetic signal', () => {
  const run = (rateId: string, df: boolean, start: string, opts: { reverse?: boolean; noise?: number; block?: number } = {}) => {
    const r = rateById(rateId);
    const w = words(start, 30, rateId, df);
    let sig = degrade(biphaseMark(w.map((x) => x.bits), fs / (80 * (r.num / r.den)), 0.4), opts.noise ?? 0.02);
    if (opts.reverse) sig = sig.slice().reverse();
    const rd = new LtcReader(fs);
    const block = opts.block ?? 128;
    const got: string[] = [];
    for (let i = 0; i < sig.length; i += block) {
      const before = rd.count;
      rd.process(sig.subarray(i, i + block));
      if (rd.count > before) got.push(...rd.frames.slice(-(rd.count - before)).map((f) => formatTc({ ...f })));
    }
    return { rd, got, expected: w.map((x) => formatTc(x.t)) };
  };

  it('25 fps: decodes every word after lock-in, fps estimate', () => {
    const { rd, got, expected } = run('25', false, '10:00:00:00');
    expect(got.length).toBeGreaterThanOrEqual(25);
    const i0 = expected.indexOf(got[0]);
    expect(got).toEqual(expected.slice(i0, i0 + got.length));
    expect(rd.errors).toBe(0);
    expect(rd.frames.at(-1)!.fps).toBeCloseTo(25, 1);
    expect(rd.frames.at(-1)!.userBits).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it('29.97 DF across a dropped minute boundary', () => {
    const { got, expected } = run('29.97', true, '00:00:59;20');
    const i0 = expected.indexOf(got[0]);
    expect(got).toEqual(expected.slice(i0, i0 + got.length));
    expect(got).toContain('00:01:00;02');
    expect(got).not.toContain('00:01:00;00');
  });
  it('reverse playback is recognised', () => {
    const { rd, got, expected } = run('25', false, '01:02:03:04', { reverse: true });
    expect(got.length).toBeGreaterThan(20);
    expect(rd.frames.at(-1)!.reverse).toBe(true);
    // newest decoded frame is an earlier one (reverse)
    expect(expected.indexOf(got.at(-1)!)).toBeLessThan(expected.indexOf(got[0]));
  });
  it('24 fps with strong noise and 1-sample blocks', () => {
    const { got, expected } = run('24', false, '23:59:59:10', { noise: 0.06, block: 1 });
    const i0 = expected.indexOf(got[0]);
    expect(got.length).toBeGreaterThan(20);
    expect(got).toEqual(expected.slice(i0, i0 + got.length));
    expect(got).toContain('00:00:00:00');
  });
  it('silence and a sine produce nothing', () => {
    const rd = new LtcReader(fs);
    rd.process(new Float32Array(fs));
    rd.process(Float32Array.from({ length: fs }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 1000 * i) / fs)));
    expect(rd.count).toBe(0);
  });
});
