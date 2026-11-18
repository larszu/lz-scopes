import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { FrameGate } from '../server/helper-input.mjs';

describe('FrameGate (helper → ffmpeg, feedback 11/2026)', () => {
  it('keeps at most two pictures inside ffmpeg; newer ones are dropped, not queued', () => {
    let t = 0;
    const g = new FrameGate({ now: () => t });
    expect([g.offer(), g.offer(), g.offer(), g.offer()]).toEqual(['write', 'write', 'busy', 'busy']);
    g.done();
    expect(g.offer()).toBe('write');
    expect(g.inFlight).toBe(2);
  });

  it('a slow ffmpeg never collects a backlog: delay stays bounded at two pictures', () => {
    // 50 fps in, ffmpeg needs 30 ms per picture (slower than real time)
    let t = 0;
    const g = new FrameGate({ now: () => t });
    const inside: number[] = []; let maxAge = 0, nextDone = 30;
    for (let i = 0; i < 500; i++) {
      t = i * 20;
      while (inside.length && nextDone <= t) { maxAge = Math.max(maxAge, nextDone - inside.shift()!); g.done(); nextDone += 30; }
      if (g.offer() === 'write') { if (!inside.length) nextDone = t + 30; inside.push(t); }
    }
    expect(maxAge).toBeLessThanOrEqual(90);
  });

  it('thins 50 fps out to a 25 fps cap evenly, without counting losses', () => {
    const g = new FrameGate({ fps: 50, limit: 25 });
    const r = Array.from({ length: 10 }, () => { const o = g.offer(); if (o === 'write') g.done(); return o; });
    expect(r.filter((x) => x === 'write')).toHaveLength(5);
    expect(r.filter((x) => x === 'busy')).toHaveLength(0);
  });

  it('a stalled ffmpeg (no output for a second) does not block for ever', () => {
    let t = 0;
    const g = new FrameGate({ now: () => t });
    g.offer(); g.offer();
    t = 500; expect(g.offer()).toBe('busy');
    t = 1200; expect(g.offer()).toBe('write');
  });
});
