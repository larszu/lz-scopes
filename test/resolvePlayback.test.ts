import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { createPlaybackWatch } from '../server/resolveWatch.mjs';
// @ts-expect-error plain JS module
import { resolveState } from '../server/resolve.mjs';
import { resolveLines } from '../src/resolveLive';
import { cropRect, isLocalHost, pickResolveWindow, routeFor, routeText } from '../src/resolvePlayback';
import { findViewer, resample, toGray, type Gray } from '../src/resolveViewer';
import { setLang } from '../src/i18n';

describe('Resolve playback detection (#88)', () => {
  // Measured with Resolve Studio 21.1.1 (07.10.2026): paused, one export takes 7–16 ms; while
  // playing, every scripting call blocks until the timeline stops.
  it('silence of the helper means playing; a moved time code confirms it', () => {
    const w = createPlaybackWatch({ fps: 10 });
    expect(w.thresholdMs).toBe(800);
    let t = 0;
    for (; t <= 1000; t += 100) expect(w.line(t, '00:00:47:10')).toBeNull();
    expect(w.check(t + 500)).toBeNull();
    expect(w.check(t + 900)).toEqual({ state: 'playing' });
    expect(w.check(t + 2000)).toBeNull(); // reported once
    expect(w.playing).toBe(true);
    expect(w.line(t + 5000, '00:00:52:03')).toEqual({ state: 'paused', played: true });
    expect(w.thresholdMs).toBe(800);
  });
  it('a slow export (time code unchanged) raises the threshold instead', () => {
    const w = createPlaybackWatch({ fps: 10 });
    w.line(0, '01:00:00:00');
    expect(w.check(1000)).toEqual({ state: 'playing' });
    expect(w.line(1200, '01:00:00:00')).toEqual({ state: 'paused', played: false });
    expect(w.thresholdMs).toBe(1800);
    expect(w.check(2900)).toBeNull();
  });
  it('low still rates wait longer', () => {
    expect(createPlaybackWatch({ fps: 1 }).thresholdMs).toBe(4000);
  });
  it('probe timeout during playback is "busy", not "no Python"', () => {
    const last = { running: true, scripting: true, project: 'P', timeline: 'T', product: 'DaVinci Resolve Studio', version: '21.1.1.10' };
    expect(resolveState(true, null, true, last)).toMatchObject({ running: true, scripting: true, busy: true, project: 'P' });
    expect(resolveState(true, null, true, null)).toMatchObject({ scripting: true, busy: true });
    expect(resolveState(true, null)).toMatchObject({ reason: 'python' });
    setLang('de');
    expect(resolveLines(resolveState(true, null, true, last))).toEqual({ title: 'DaVinci Resolve Studio 21.1.1 läuft', detail: 'P / T – Die Timeline läuft – Resolve beantwortet Skriptanfragen erst nach der Pause', canConnect: true });
    setLang('en');
    expect(resolveLines(resolveState(true, null, true, last))!.detail).toMatch(/^P \/ T – The timeline is playing/);
  });
});

describe('route of the picture (#88)', () => {
  it('paused = exact still; playing = window when possible, else held with a reason', () => {
    expect(routeFor({ playing: false, local: false, desktop: false, picked: false })).toEqual({ route: 'still', playing: false });
    expect(routeFor({ playing: true, local: false, desktop: true, picked: false })).toMatchObject({ route: 'none', why: 'remote' });
    expect(routeFor({ playing: true, local: true, desktop: false, picked: false })).toMatchObject({ route: 'none', why: 'browser' });
    expect(routeFor({ playing: true, local: true, desktop: false, picked: true, found: 'ok' })).toMatchObject({ route: 'window' });
    expect(routeFor({ playing: true, local: true, desktop: true, picked: false, found: 'noViewer' })).toMatchObject({ route: 'none', why: 'noViewer' });
  });
  it('texts say how colour-accurate each route is, in both languages', () => {
    setLang('en');
    expect(routeText({ route: 'still', playing: false }).detail).toMatch(/16 bit.*Colour-accurate/);
    expect(routeText({ route: 'window', playing: true }).detail).toMatch(/8 bit.*colour management.*not for colour judgement/);
    expect(routeText({ route: 'none', why: 'remote', playing: true }).detail).toMatch(/clean feed/);
    setLang('de');
    expect(routeText({ route: 'window', playing: true }).detail).toMatch(/8 bit.*Farbmanagement.*nicht für Farburteile/);
    expect(routeText({ route: 'none', why: 'denied', playing: true }).detail).toMatch(/Bildschirm- & Systemaudioaufnahme/);
  });
  it('picks the window titled like the project, else any Resolve window; never a screen', () => {
    const list = [{ id: 'screen:1:0', name: 'Entire screen' }, { id: 'window:7:0', name: 'DaVinci Resolve' }, { id: 'window:9:0', name: 'lz-scopes-test-88' }];
    expect(pickResolveWindow(list, 'lz-scopes-test-88')?.id).toBe('window:9:0');
    expect(pickResolveWindow(list, 'other')?.id).toBe('window:7:0');
    expect(pickResolveWindow([list[0]], 'x')).toBeNull();
  });
  it('local bridge addresses', () => {
    expect(isLocalHost('ws://localhost:4192')).toBe(true);
    expect(isLocalHost('ws://127.0.0.1:4192')).toBe(true);
    expect(isLocalHost('ws://[::1]:4192')).toBe(true);
    expect(isLocalHost('ws://studio.local:4192')).toBe(false);
    expect(isLocalHost('nonsense')).toBe(false);
  });
  it('crop is inset slightly and clamped', () => {
    expect(cropRect({ x: 0.225, y: 0.118, w: 0.1656, h: 0.1642 }, 2690, 1520)).toEqual([608, 181, 1048, 427]);
    expect(cropRect({ x: 0, y: 0, w: 1, h: 1 }, 100, 50, 0)).toEqual([0, 0, 100, 50]);
  });
});

describe('finding the viewer in the window capture (#88)', () => {
  // deterministic noise picture as "still"
  const rnd = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const r = rnd(7);
  const still: Gray = resample({ w: 32, h: 18, px: Float32Array.from({ length: 32 * 18 }, r) }, 64, 36);
  /** window 1600×900 RGBA: grey UI, the still at (x, y, w) with gain and offset (display colour management) */
  function windowWith(x: number, y: number, w: number, gain: number, offset: number) {
    const W = 1600, H = 900, h = Math.round((w * 9) / 16), px = new Uint8ClampedArray(W * H * 4);
    const big = resample(still, w, h);
    const ui = rnd(3);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const inside = i >= x && i < x + w && j >= y && j < y + h;
      const v = inside ? big.px[(j - y) * w + (i - x)] * gain + offset : 0.15 + (((i >> 5) + (j >> 5)) % 7 === 0 ? 0.3 * ui() : 0);
      const k = (j * W + i) * 4;
      px[k] = px[k + 1] = px[k + 2] = Math.round(v * 255); px[k + 3] = 255;
    }
    return { px, W, H };
  }
  it('locates a scaled still within a few pixels despite gain/offset', () => {
    const { px, W, H } = windowWith(412, 120, 560, 0.8, 0.05);
    const levels = [96, 320].map((w) => toGray(px, W, H, w));
    const f = findViewer(levels, still)!;
    expect(f.score).toBeGreaterThan(0.8);
    expect(Math.abs(f.x * W - 412)).toBeLessThan(8);
    expect(Math.abs(f.y * H - 120)).toBeLessThan(8);
    expect(Math.abs(f.w * W - 560)).toBeLessThan(12);
  });
  it('reports nothing when the still is not on screen', () => {
    const W = 320, H = 180, px = new Uint8ClampedArray(W * H * 4).fill(40);
    const g = rnd(11);
    for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = Math.round(g() * 255);
    expect(findViewer([toGray(px, W, H, 96)], still)).toBeNull();
  });
});
