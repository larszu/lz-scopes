import { describe, expect, it } from 'vitest';
import { valueCards, type ValueInput } from '../src/valueCards';
import { computeStats } from '../src/sources';
import { useLang } from '../src/i18n';

useLang('en');

const empty: ValueInput = { stats: null, kr: 0.2126, kb: 0.0722, matrix: '709', r103: null, light: null, loud: null, signal: null };

describe('explanation cards per measured value (#239)', () => {
  it('shows only the values the source has', () => {
    expect(valueCards(empty)).toEqual([]);
    expect(valueCards({ ...empty, signal: { brng: 0.03 } }).map((c) => c.id)).toEqual(['brng']);
  });

  it('fills the luma formula with the measured numbers and the matrix coefficients', () => {
    // one 2×1 picture: 100 % white and 75 % grey (8 bit RGBA)
    const px = new Uint8Array([255, 255, 255, 255, 191, 191, 191, 255]);
    const stats = computeStats(px, 2, 1, 1, 255, 0.2126, 0.0722);
    const cards = valueCards({ ...empty, stats });
    const ymax = cards.find((c) => c.id === 'ymax')!;
    expect(ymax.value).toBe('100.0 %');
    expect(ymax.formula).toContain('0.2126 · R′ + 0.7152 · G′ + 0.0722 · B′');
    expect(ymax.formula).toContain('of 2 samples');
    expect(ymax.source).toContain('BT.709');
    expect(cards.find((c) => c.id === 'yavg')!.value).toBe(`${((1 + 191 / 255) / 2 * 100).toFixed(1)} %`);
    const clip = cards.find((c) => c.id === 'clip')!;
    expect(clip.value).toBe('50.00 %');
  });

  it('loudness: PLR is true peak minus integrated, true peak judged against −1 dBTP', () => {
    const cards = valueCards({ ...empty, loud: { integrated: -23, lra: 7.5, maxTpDb: -0.5, seconds: 60 } });
    expect(cards.map((c) => c.id)).toEqual(['integrated', 'lra', 'truepeak', 'plr']);
    expect(cards[0].formula).toContain('0.0 LU from −23');
    expect(cards[2].formula).toContain('above the limit');
    expect(cards[3].value).toBe('22.5 dB');
  });

  it('EBU R 103: counts and limits in the formula', () => {
    const r103 = { pref: 0.02, total: 0, below: [0, 0, 0, 0], above: [0, 0, 0, 0], min: [0, 0, 0, 0], max: [1, 1, 1, 1], alarm: true, samples: 1000, width: 40, height: 25 };
    const c = valueCards({ ...empty, r103, matrix: '2020' }).find((x) => x.id === 'r103')!;
    expect(c.formula).toContain('20 of 1,000 samples');
    expect(c.formula).toContain('-5.02 %');
    expect(c.formula).toContain('above the limit');
  });
});
