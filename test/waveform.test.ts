import { describe, expect, it } from 'vitest';
import { WAVE_ZOOMS, channelLayout, waveLevel, waveTicks, waveY } from '../src/graticule';

describe('waveform zoom and channels', () => {
  it('black zoom: 1 % ticks from −5 to 15 %, majors every 5 %', () => {
    const t = waveTicks('percent', 'sdr', 1000, WAVE_ZOOMS.black);
    expect(t.map((x) => x.label)).toEqual(Array.from({ length: 21 }, (_, i) => String(i - 5)));
    expect(t.filter((x) => x.major).map((x) => x.label)).toEqual(['-5', '0', '5', '10', '15']);
    // 10-bit codes: 0 % = 64
    expect(waveTicks('bit10', 'sdr', 1000, WAVE_ZOOMS.black).find((x) => x.level === 0)!.label).toBe('64');
  });
  it('waveLevel is the inverse of waveY for every range', () => {
    const r = { x: 0, y: 10, w: 100, h: 200 };
    for (const range of Object.values(WAVE_ZOOMS)) expect(waveLevel(r, waveY(r, 0.1, range), range)).toBeCloseTo(0.1, 9);
  });
  it('parade closes up when channels are hidden', () => {
    expect(channelLayout('parade', { g: false })).toEqual({ sec: [0, -1, 1, -1], n: 2, names: ['R', 'B'] });
    expect(channelLayout('yrgb', { y: false })).toEqual({ sec: [-1, 0, 1, 2], n: 3, names: ['R', 'G', 'B'] });
    // hiding everything falls back to all channels
    expect(channelLayout('parade', { r: false, g: false, b: false }).n).toBe(3);
    expect(channelLayout('wf-rgb', { b: false })).toEqual({ sec: [0, 0, -1, -1], n: 1, names: [] });
  });
});
