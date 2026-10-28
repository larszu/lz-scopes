// Transport of a file in the bridge (#191, server/clip.mjs): where the playhead stands, what
// ffmpeg is started with, and what the end of a clip means – the picture must hold, the socket
// must not die when the file runs out.
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { ClipTransport } from '../server/clip.mjs';

interface Msg { type: string; state: string; pos: number; duration: number; fps: number; rate: number; loop: boolean }

function make(opts: Record<string, unknown> = {}) {
  const sent: Msg[] = [];
  let relaunches = 0;
  const c = new ClipTransport({ duration: 2, fps: 25, send: (m: Msg) => sent.push(m), relaunch: () => { relaunches++; }, ...opts });
  return { c, sent, last: () => sent[sent.length - 1], count: () => relaunches };
}

describe('clip transport', () => {
  it('plays from the start and counts the playhead from the frames handed out', () => {
    const { c } = make();
    expect(c.state).toBe('playing');
    expect(c.input()).toEqual({ pos: 0, rate: 1, frames: 0 });
    for (let i = 0; i < 25; i++) c.onFrame();
    expect(c.position()).toBeCloseTo(1, 6);
    // never beyond the end of the clip, however many frames follow
    for (let i = 0; i < 200; i++) c.onFrame();
    expect(c.position()).toBe(2);
  });

  it('pause holds one picture, step moves exactly one frame', () => {
    const { c, last, count } = make();
    for (let i = 0; i < 10; i++) c.onFrame();
    c.handle({ op: 'pause' });
    expect(c.state).toBe('paused');
    // the pause asks ffmpeg for a single picture from the middle of frame 10
    expect(c.input()).toEqual({ pos: 10.5 / 25, rate: 0, frames: 1 });
    expect(last()).toMatchObject({ type: 'clip', state: 'paused', fps: 25, duration: 2 });
    expect(count()).toBe(1);
    // the single picture arriving must not move the playhead
    c.onFrame();
    expect(c.position()).toBeCloseTo(10.5 / 25, 6);
    c.handle({ op: 'step', frames: 1 });
    expect(c.input().pos).toBeCloseTo(11.5 / 25, 6);
    c.handle({ op: 'step', frames: -3 });
    expect(c.input().pos).toBeCloseTo(8.5 / 25, 6);
    // stepping stays inside the clip: frames 0 … 49 of two seconds at 25 fps
    c.handle({ op: 'step', frames: -99 });
    expect(c.input().pos).toBeCloseTo(0.5 / 25, 6);
    c.handle({ op: 'step', frames: 999 });
    expect(c.input().pos).toBeCloseTo(49.5 / 25, 6);
  });

  it('seek keeps the state, play from the very end starts over', () => {
    const { c } = make();
    c.handle({ op: 'seek', pos: 1.2 });
    expect(c.state).toBe('playing');
    expect(c.input()).toEqual({ pos: 1.2, rate: 1, frames: 0 });
    c.handle({ op: 'pause' });
    c.handle({ op: 'seek', pos: 1.2 });
    expect(c.state).toBe('paused');
    // at the end: play begins at the start again, like the <video loop> of the browser path
    c.handle({ op: 'seek', pos: 99 });
    // paused, a seek snaps onto a frame – the last one of the clip
    expect(c.position()).toBeCloseTo(49.5 / 25, 6);
    c.handle({ op: 'play' });
    expect(c.input().pos).toBe(0);
  });

  it('shuttle rates are clamped, a pause reads at full speed', () => {
    const { c } = make();
    c.handle({ op: 'play', rate: 4 });
    expect(c.input().rate).toBe(4);
    c.handle({ op: 'play', rate: 99 });
    expect(c.input().rate).toBe(16);
    c.handle({ op: 'rate', rate: 0.01 });
    expect(c.input().rate).toBe(0.1);
    c.handle({ op: 'pause' });
    expect(c.input().rate).toBe(0);
    expect(c.handle({ op: 'nonsense' })).toBe(false);
  });

  it('the end of the clip loops, without a loop it holds there – and the socket survives both', () => {
    const { c, last } = make();
    expect(c.onExit(0)).toBe('relaunch');
    expect(c.position()).toBe(0);
    expect(last()).toMatchObject({ state: 'playing', pos: 0 });
    c.handle({ op: 'loop', loop: false });
    expect(c.onExit(0)).toBe('hold');
    expect(last()).toMatchObject({ state: 'paused', pos: 2 });
    // the single picture of a pause: ffmpeg ends on its own, that is no error
    expect(c.onExit(0)).toBe('hold');
    // a real failure reaches the page
    c.handle({ op: 'play' });
    expect(c.onExit(1)).toBe('end');
  });

  it('a clip of unknown length is not bounded at the end', () => {
    const { c } = make({ duration: 0, fps: 0 });
    expect(c.fps).toBe(25);
    c.handle({ op: 'seek', pos: 3600 });
    expect(c.position()).toBe(3600);
    c.handle({ op: 'play' });
    expect(c.input().pos).toBe(3600);
  });
});
