import { describe, expect, it } from 'vitest';
import { AvHistory, slope } from '../src/audio/dsp/avhistory';

const T0 = Date.UTC(2026, 10, 25, 8, 0, 0);

describe('A/V long-run history (#236)', () => {
  it('minute buckets, mean, range, BT.1359 counts', () => {
    const h = new AvHistory();
    for (let i = 0; i < 180; i++) h.add(T0 + i * 1000, i < 179 ? 10 : 100);
    const s = h.stats();
    expect(h.buckets).toHaveLength(3);
    expect(h.buckets[0]).toMatchObject({ n: 60, min: 10, max: 10 });
    expect(s).toMatchObject({ pairs: 180, minMs: 10, maxMs: 100, beyondDetect: 1, beyondAccept: 1, from: T0 });
    expect(s.meanMs).toBeCloseTo((179 * 10 + 100) / 180, 6);
    expect(h.toCsv().split('\n')[1]).toBe('2026-11-25T08:00:00.000Z;60;10.0;10.0;10.0');
  });
  it('drift: a clock difference of 40 ppm gives +144 ms/h', () => {
    const pts = Array.from({ length: 600 }, (_, i) => ({ t: T0 + i * 1000, ms: 5 + (i / 3600) * 144 }));
    expect(slope(pts)).toBeCloseTo(144, 6);
    expect(slope(pts.slice(0, 9))).toBeNull();
    expect(slope(pts.slice(0, 100))).toBeNull(); // under 2 minutes
  });
  it('raw pairs older than one hour are dropped, buckets stay; reset clears', () => {
    const h = new AvHistory();
    for (let i = 0; i <= 120; i++) h.add(T0 + i * 60_000, 0);
    expect(h.buckets).toHaveLength(121);
    expect(h.raw[0].t).toBe(T0 + 60 * 60_000);
    h.reset();
    expect(h.stats()).toMatchObject({ pairs: 0, meanMs: null, driftMsPerHour: null });
  });
});
