import { describe, expect, it } from 'vitest';
import { inBox, legendBox, legendPosAt, nearSplit, splitAt, splitPos } from '../src/overlayDrag';

const f = { x: 10, y: 20, w: 200, h: 100 };

describe('split line', () => {
  it('starts in the middle, old wipe keeps its position', () => {
    expect(splitPos({ mode: 'split' })).toBe(0.5);
    expect(splitPos({ mode: 'wipe', pos: 0.3 })).toBe(0.3);
    expect(splitPos({ mode: 'split', pos: 2 })).toBe(1);
  });
  it('grabs and moves', () => {
    expect(nearSplit(112, f, 0.5)).toBe(true);
    expect(nearSplit(130, f, 0.5)).toBe(false);
    expect(splitAt(60, f)).toBe(0.25);
    expect(splitAt(-50, f)).toBe(0);
  });
});

describe('legend', () => {
  it('defaults to bottom-left and round-trips', () => {
    const b = legendBox(f, 50, 20);
    expect(b).toEqual({ x: 14, y: 96, w: 50, h: 20 });
    const p = legendPosAt(f, 50, 20, 80, 40);
    const b2 = legendBox(f, 50, 20, p);
    expect(b2.x).toBeCloseTo(80); expect(b2.y).toBeCloseTo(40);
    expect(inBox(b2, 90, 50)).toBe(true);
  });
  it('stays inside the frame', () => {
    const p = legendPosAt(f, 50, 20, 999, -999);
    expect(p).toEqual({ x: 1, y: 0 });
  });
});
