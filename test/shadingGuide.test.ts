import { describe, expect, it } from 'vitest';
import { CameraBridgeLink } from '../src/shading/bridge';
import { GUIDE_STEPS, cameraDataOf, cameraDataRows, cbcr, evaluateStep, flareVector, frameStats, progress, type Means } from '../src/shading/guide';

const KR = 0.2126, KB = 0.0722;
/** Synthetic 8-bit RGBA frame, full-range codes, from a per-pixel function. */
function frame(w: number, h: number, f: (x: number, y: number) => [number, number, number]) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = f(x, y), i = (y * w + x) * 4;
    px[i] = Math.round(r * 255); px[i + 1] = Math.round(g * 255); px[i + 2] = Math.round(b * 255); px[i + 3] = 255;
  }
  return px;
}
const decode = (px: ArrayLike<number>, i: number) => [px[i] / 255, px[i + 1] / 255, px[i + 2] / 255];
const stats = (px: Uint8Array, w: number, h: number, rect: [number, number, number, number] = [0, 0, w, h], stride = 1) => frameStats(px, w, decode, KR, KB, rect, stride)!;
const flat = (r: number, g: number, b: number) => stats(frame(30, 20, () => [r, g, b]), 30, 20);
const means = (r: number, g: number, b: number): Means => ({ r, g, b, y: KR * r + (1 - KR - KB) * g + KB * b });

describe('frameStats', () => {
  it('means, peak and clipped share of a split frame', () => {
    const px = frame(40, 10, (x) => (x < 30 ? [0.5, 0.5, 0.5] : [1, 1, 1]));
    const s = stats(px, 40, 10);
    expect(s.r).toBeCloseTo(0.5 * 0.75 + 0.25, 2);
    expect(s.max).toBe(1);
    expect(s.clip).toBeCloseTo(0.25, 5);
  });
  it('only the rectangle, with a stride', () => {
    const px = frame(40, 40, (x, y) => (x >= 10 && x < 30 && y >= 10 && y < 30 ? [0.2, 0.4, 0.6] : [1, 0, 0]));
    const s = stats(px, 40, 40, [10, 10, 30, 30], 3);
    expect(s.g).toBeCloseTo(0.4, 2);
    expect(s.clip).toBe(0);
    expect(s.n).toBe(49);
  });
});

describe('guided sequence', () => {
  it('black: master black up when crushed, down when lifted, ok in between', () => {
    expect(evaluateStep('black', flat(0, 0, 0), null).advice).toEqual([{ field: 'masterBlack', dir: 1 }]);
    expect(evaluateStep('black', flat(0.1, 0.1, 0.1), null).advice).toEqual([{ field: 'masterBlack', dir: -1 }]);
    expect(evaluateStep('black', flat(0.02, 0.02, 0.02), null).state).toBe('ok');
  });
  it('black balance: a red black asks for Black R down, a blue-poor one for Black B up', () => {
    const r = evaluateStep('blackBal', flat(0.04, 0.02, 0.01), null);
    expect(r.state).toBe('adjust');
    expect(r.advice).toEqual([{ field: 'blackR', dir: -1 }, { field: 'blackB', dir: 1 }]);
    expect(evaluateStep('blackBal', flat(0.02, 0.02, 0.02), null).state).toBe('ok');
  });
  it('white: iris first, then White R/B', () => {
    const r = evaluateStep('white', flat(0.7, 0.6, 0.6), null);
    expect(r.advice[0]).toEqual({ field: 'iris', dir: 1 });
    expect(r.advice).toContainEqual({ field: 'whiteR', dir: -1 });
    expect(evaluateStep('white', flat(0.9, 0.9, 0.9), null).state).toBe('ok');
  });
  it('grey: a cast is reported without a per-channel gamma move', () => {
    const r = evaluateStep('grey', flat(0.5, 0.45, 0.45), null);
    expect(r.state).toBe('adjust');
    expect(r.advice).toEqual([]);
  });
  it('knee: whole frame clipping', () => {
    const clipped = stats(frame(40, 10, (x) => (x < 30 ? [0.5, 0.5, 0.5] : [1, 1, 1])), 40, 10);
    expect(evaluateStep('knee', null, clipped).state).toBe('adjust');
    expect(evaluateStep('knee', null, flat(0.8, 0.8, 0.8)).state).toBe('ok');
  });
  it('matrix is manual, missing picture is nodata', () => {
    expect(evaluateStep('matrix', null, null).state).toBe('manual');
    expect(evaluateStep('black', null, null).state).toBe('nodata');
  });
  it('progress counts known steps only', () => {
    expect(progress(['black', 'white', 'nonsense'])).toEqual({ done: 2, total: GUIDE_STEPS.length });
  });
});

describe('flare', () => {
  it('neutral lift: ΔY′ only, no chroma', () => {
    const f = flareVector(means(0.02, 0.02, 0.02), means(0.05, 0.05, 0.05));
    expect(f.dy).toBeCloseTo(0.03, 6);
    expect(f.chroma).toBeCloseTo(0, 6);
    expect(f.significant).toBe(true);
  });
  it('blue flare points towards +Cb (0°)', () => {
    const f = flareVector(means(0.02, 0.02, 0.02), means(0.02, 0.02, 0.06));
    expect(f.dcb).toBeGreaterThan(0);
    expect(f.angle < 30 || f.angle > 330).toBe(true);
  });
  it('flare step asks for master black down and needs the closed reference', () => {
    expect(evaluateStep('flare', flat(0.06, 0.06, 0.06), null, null).state).toBe('nodata');
    const r = evaluateStep('flare', flat(0.06, 0.06, 0.06), null, means(0.02, 0.02, 0.02));
    expect(r.advice).toEqual([{ field: 'masterBlack', dir: -1 }]);
    expect(evaluateStep('flare', flat(0.02, 0.02, 0.02), null, means(0.02, 0.02, 0.02)).state).toBe('ok');
  });
  it('cbcr of grey is zero', () => {
    const [cb, cr] = cbcr(means(0.4, 0.4, 0.4));
    expect(cb).toBeCloseTo(0, 9); expect(cr).toBeCloseTo(0, 9);
  });
});

describe('camera data', () => {
  const L = { iris: 'Iris', gain: 'Gain', nd: 'ND', shutter: 'Shutter', temp: 'Temp', tally: 'Tally', tallyText: { program: 'PGM', preview: 'PVW', off: 'off' } };
  it('reads numbers only, colour temperature under either name', () => {
    expect(cameraDataOf({ iris: 100, masterGain: 'x', colorTemperature: 5600 })).toEqual({ iris: 100, colorTemp: 5600 });
  });
  it('unknown values stay –', () => {
    const rows = cameraDataRows({ iris: 128, tally: 'program' }, L);
    expect(rows).toContainEqual(['Tally', 'PGM']);
    expect(rows).toContainEqual(['Iris', '128/255']);
    expect(rows).toContainEqual(['Gain', '–']);
  });
  it('bridge link collects state and cameraTally', () => {
    const link = new CameraBridgeLink(() => '', () => {});
    link.receive({ type: 'state', cameraNumber: 2, state: { iris: 90, ndFilter: 1, masterBlack: 130 } });
    link.receive({ type: 'cameraTally', tally: { 2: 'preview', 3: 'bogus' } });
    expect(link.data.get(2)).toEqual({ iris: 90, ndFilter: 1, tally: 'preview' });
    expect(link.data.has(3)).toBe(false);
    expect(link.states.get(2)?.paint.masterBlack).toBe(130);
  });
});
