// Signal and display per panel (#179): what the panel has to admit about its own reading.
// Smoothing is useful and dangerous at the same time – the note is the honest part.
import { describe, expect, it } from 'vitest';
import { defaultPanel, smoothNote } from '../src/panel';

const panel = (patch: object) => ({ ...defaultPanel('wf-luma'), ...patch });

describe('note about smoothing', () => {
  it('nothing smoothed, nothing said', () => {
    expect(smoothNote(panel({}))).toBe('');
    expect(smoothNote(panel({ smooth: 0, persist: 0 }))).toBe('');
  });

  it('names the grid of the signal low-pass', () => {
    expect(smoothNote(panel({ smooth: 1 }))).toContain('3×3');
    expect(smoothNote(panel({ smooth: 2 }))).toContain('5×5');
  });

  it('names the age of a smoothed trace', () => {
    expect(smoothNote(panel({ persist: 1000 }))).toMatch(/1[.,]0 s/);
    expect(smoothNote(panel({ persist: -1 }))).toContain('∞');
  });

  it('both at once in one line', () => {
    const n = smoothNote(panel({ smooth: 2, persist: 300 }));
    expect(n).toContain('5×5');
    expect(n).toMatch(/0[.,]3 s/);
    expect(n.split('·')).toHaveLength(2);
  });

  it('the CRT look is a look, not a filter', () => {
    expect(smoothNote(panel({ persist: 1000, crt: { on: true, phosphor: 'P31', persist: 1000, glow: 0, beam: 1 } }))).toBe('');
    // but a signal low-pass stays a filter, whatever the trace looks like
    expect(smoothNote(panel({ smooth: 1, crt: { on: true, phosphor: 'P31', persist: 1000, glow: 0, beam: 1 } }))).toContain('3×3');
  });
});

import { waveLowPass } from '../src/panel';

describe('waveform Low Pass like Tektronix (#246)', () => {
  const src = (w: number, sw: number) => ({ width: w, info: { sourceWidth: sw } }) as unknown as Parameters<typeof waveLowPass>[0];
  it('≈ 2.2 source pixels at native width (−3 dB at 0.06 × sample rate)', () => {
    expect(waveLowPass(src(1920, 1920))).toBeCloseTo(2.19, 1);
  });
  it('less where the bridge already scaled down (box filter counted)', () => {
    const s = waveLowPass(src(960, 1920));
    expect(s).toBeLessThan(1.2); expect(s).toBeGreaterThan(0.9);
  });
  it('the note says the trace is filtered', () => {
    expect(smoothNote(panel({ scope: 'wf-luma', waveFilter: 'lowpass' } as never))).toMatch(/Tiefpass|Low Pass/);
  });
});
