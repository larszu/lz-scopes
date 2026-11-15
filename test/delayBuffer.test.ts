import { describe, expect, it } from 'vitest';
import { DelayBuffer } from '../src/delayBuffer';

describe('DelayBuffer: fixed delay instead of the fastest possible (#244)', () => {
  it('shows every picture the same time after capture although arrival jitters', () => {
    const b = new DelayBuffer<number>(200);
    const shown: number[] = [];
    // 50 fps, network/processing jitter 0…150 ms
    const arrivals = Array.from({ length: 100 }, (_, i) => ({ i, pts: i * 0.02, at: 1000 + i * 20 + ((i * 37) % 150) }));
    for (let now = 1000; now < 4000; now++) {
      for (const a of arrivals) if (a.at === now) b.push(a.i, a.pts, now);
      const f = b.take(now);
      if (f !== null) shown.push(now - (1000 + f * 20));
    }
    // delay after capture: constant once the minimum offset is known (first frame had none)
    const steady = shown.slice(10);
    expect(Math.max(...steady) - Math.min(...steady)).toBeLessThanOrEqual(1);
    expect(steady[0]).toBe(200);
    expect(b.late).toBe(0);
  });

  it('without PTS the caller shows the picture at once', () => {
    expect(new DelayBuffer<number>(100).push(1, NaN, 0)).toBe(false);
  });

  it('a picture later than its slot is shown at once and counted', () => {
    const b = new DelayBuffer<string>(50);
    b.push('a', 0, 1000);
    b.push('b', 0.02, 1300);
    expect(b.late).toBe(1);
    expect(b.take(1300)).toBe('b');
  });

  it('a PTS jump (new stream) resets the time base', () => {
    const b = new DelayBuffer<string>(100);
    b.push('a', 10, 1000);
    b.push('b', 500, 1020);
    expect(b.take(1120)).toBe('b');
  });
});
