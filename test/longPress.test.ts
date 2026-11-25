import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LONG_MS, LONG_PX, longPress } from '../src/longPress';

describe('long press (#185)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('a finger held still is a long press once the hold time has passed', () => {
    const arm = vi.fn();
    const lp = longPress(arm);
    lp.down(1, 100, 100);
    vi.advanceTimersByTime(LONG_MS - 1);
    expect(arm).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(arm).toHaveBeenCalledOnce();
    expect(lp.up(1)).toBe(true);
  });

  it('a short tap is not', () => {
    const lp = longPress();
    lp.down(1, 0, 0);
    vi.advanceTimersByTime(LONG_MS / 2);
    expect(lp.up(1)).toBe(false);
    vi.advanceTimersByTime(LONG_MS);
    expect(lp.armed).toBe(false);
  });

  it('moving beyond the tolerance cancels it, a small wobble does not', () => {
    const lp = longPress();
    lp.down(1, 0, 0);
    lp.move(1, LONG_PX - 1, 0);
    vi.advanceTimersByTime(LONG_MS);
    expect(lp.up(1)).toBe(true);
    lp.down(2, 0, 0);
    lp.move(2, LONG_PX + 1, 0);
    vi.advanceTimersByTime(LONG_MS);
    expect(lp.up(2)).toBe(false);
  });

  it('a second finger (pinch) cancels it', () => {
    const arm = vi.fn();
    const lp = longPress(arm);
    lp.down(1, 0, 0);
    lp.down(2, 50, 0);
    vi.advanceTimersByTime(LONG_MS * 2);
    expect(arm).not.toHaveBeenCalled();
    expect(lp.up(2)).toBe(false);
    expect(lp.up(1)).toBe(false);
    expect(lp.active).toBe(false);
  });

  it('the browser contextmenu arms it early, once', () => {
    const arm = vi.fn();
    const lp = longPress(arm);
    lp.down(1, 0, 0);
    lp.arm();
    vi.advanceTimersByTime(LONG_MS);
    expect(arm).toHaveBeenCalledOnce();
    expect(lp.up(1)).toBe(true);
  });
});
