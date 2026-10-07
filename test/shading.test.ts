import { describe, expect, it } from 'vitest';
import {
  LIMITS, NEUTRAL_PAINT, applyPaint, busCommands, busDeltaFor, clampValue, fieldAvailable, invertChannel, channelPaint,
  paintFrame, slope, vectorGesture, vectorMode, waveTarget, zoneOf,
} from '../src/shading/model';
import { CameraBridgeLink } from '../src/shading/bridge';
import { TEXTS } from '../src/shading/text';

describe('touch shading: gesture → value', () => {
  it('zones follow the shadows/mids/highlights borders of the neutral overlay (0.3 / 0.7)', () => {
    expect(zoneOf(0.1)).toBe('black');
    expect(zoneOf(0.5)).toBe('gamma');
    expect(zoneOf(0.9)).toBe('white');
  });

  it('parade selects black or white balance of exactly the grabbed channel', () => {
    expect(waveTarget('r', 0.1)).toMatchObject({ kind: 'fields', fields: ['blackR'] });
    expect(waveTarget('b', 0.9)).toMatchObject({ kind: 'fields', fields: ['whiteB'] });
    expect(waveTarget('g', 0.45)).toMatchObject({ fields: ['blackG'] });
    expect(waveTarget('g', 0.55)).toMatchObject({ fields: ['whiteG'] });
  });

  it('luma waveform: master black, master gamma, white R=G=B', () => {
    expect(waveTarget('y', 0.1)).toMatchObject({ fields: ['masterBlack'] });
    expect(waveTarget('y', 0.5)).toMatchObject({ fields: ['masterGamma'] });
    expect(waveTarget('y', 0.9)).toMatchObject({ fields: ['whiteR', 'whiteG', 'whiteB'] });
  });

  it('values stay inside the step and the session span', () => {
    expect(clampValue('whiteR', 128, 400)).toBe(128 + LIMITS.span);
    expect(clampValue('whiteR', 10, -50)).toBe(0);
    expect(clampValue('hue', 0, 100)).toBe(LIMITS.hueSpan);
    expect(busDeltaFor('whiteR', 'r', 0.8, 1, NEUTRAL_PAINT)).toBe(LIMITS.step);
    expect(busDeltaFor('whiteR', 'r', 0.8, -1, NEUTRAL_PAINT)).toBe(-LIMITS.step);
  });

  it('slope of white gain at level L is L · 0.5/128 per bus unit (model gain = 1 + 0.5·(v−128)/128)', () => {
    expect(slope('whiteR', 'r', 0.8, NEUTRAL_PAINT)).toBeCloseTo((0.8 * 0.5) / 128, 6);
    // lift pivots at white: no effect at 100 %, full effect at 0 %
    expect(slope('blackG', 'g', 0, NEUTRAL_PAINT)).toBeCloseTo(0.2 / 128, 6);
    expect(Math.abs(slope('blackG', 'g', 1, NEUTRAL_PAINT))).toBeLessThan(1e-6);
  });

  it('tone curve inversion', () => {
    const cp = channelPaint({ ...NEUTRAL_PAINT, whiteR: 160, masterGamma: 100 }, 'r');
    const v = invertChannel(0.6, cp);
    expect(Math.abs(cp.gain * v + cp.lift * (1 - v)) ** cp.exp).toBeCloseTo(0.6, 6);
  });

  it('vectorscope: a quarter turn is 90°, doubling the radius doubles saturation', () => {
    const g = vectorGesture([1, 0], [0, 2]);
    expect(g.dHue).toBeCloseTo(90, 9);
    expect(g.satFactor).toBeCloseTo(2, 9);
    expect(vectorGesture([0, 1], [0.1, -1]).dHue).toBeLessThan(-170);
    expect(vectorMode([50, 0], [50, 20])).toBe('hue');
    expect(vectorMode([50, 0], [80, 2])).toBe('saturation');
    expect(vectorMode([50, 0], [52, 1])).toBeNull();
  });
});

describe('touch shading: simulator picture model', () => {
  it('neutral paint is the identity', () => {
    const v = applyPaint([0.2, 0.5, 0.9], NEUTRAL_PAINT);
    v.forEach((x, i) => expect(x).toBeCloseTo([0.2, 0.5, 0.9][i], 9));
    const src = new Uint8Array([0, 64, 128, 255, 255, 1, 2, 255]);
    const out = new Uint8Array(8);
    paintFrame(src, out, NEUTRAL_PAINT);
    expect([...out]).toEqual([...src]);
  });

  it('saturation 0 gives BT.709 luma (red → 0.2126, ITU-R BT.709-6 item 3.2)', () => {
    const [r, g, b] = applyPaint([1, 0, 0], { ...NEUTRAL_PAINT, saturation: 0 });
    for (const x of [r, g, b]) expect(x).toBeCloseTo(0.2126, 9);
  });

  it('hue 180° keeps luma and negates Cb/Cr', () => {
    const y = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const inp: [number, number, number] = [0.6, 0.4, 0.3];
    const out = applyPaint(inp, { ...NEUTRAL_PAINT, hue: 180 });
    expect(y(out)).toBeCloseTo(y(inp), 9);
    expect(out[0] - y(out)).toBeCloseTo(-(inp[0] - y(inp)), 9);
    expect(out[2] - y(out)).toBeCloseTo(-(inp[2] - y(inp)), 9);
  });

  it('white R up raises only the red channel', () => {
    const [r, g, b] = applyPaint([0.8, 0.8, 0.8], { ...NEUTRAL_PAINT, whiteR: 160 });
    expect(r).toBeCloseTo(0.8 * (1 + 0.5 * 32 / 128), 9);
    expect(g).toBeCloseTo(0.8, 9);
    expect(b).toBeCloseTo(0.8, 9);
  });
});

describe('touch shading: texts', () => {
  it('every text exists in German and English', () => {
    expect(Object.keys(TEXTS.en).sort()).toEqual(Object.keys(TEXTS.de).sort());
    for (const k of Object.keys(TEXTS.de) as (keyof typeof TEXTS.de)[]) expect(typeof TEXTS.en[k]).toBe(typeof TEXTS.de[k]);
  });
});

describe('touch shading: lz-camera-bridge vocabulary', () => {
  it('balance travels as an RGB triple with the current values of the other axes', () => {
    const r = busCommands(['whiteR'], { whiteR: 140, whiteG: 128, whiteB: 120 });
    expect(r).toEqual({ commands: [{ cmd: 'setWhiteBalance', params: { r: 140, g: 128, b: 120 } }] });
    expect(busCommands(['masterBlack', 'saturation'], { masterBlack: 130, saturation: 100 }).commands).toEqual([
      { cmd: 'setMasterBlack', params: { value: 130 } }, { cmd: 'setSaturation', params: { value: 100 } },
    ]);
  });

  it('refuses a triple with an unknown axis and hue (not on the bus)', () => {
    expect(busCommands(['blackR'], { blackR: 130 }).error).toBe('black');
    expect(busCommands(['hue'], { hue: 5 }).error).toBe('hue');
  });

  it('capabilities per bridge mode: VISCA and HTTP-CGI carry no paint, the simulator everything', () => {
    expect(fieldAvailable('whiteR', 'visca')).toBe(false);
    expect(fieldAvailable('saturation', 'http-cgi')).toBe(false);
    expect(fieldAvailable('blackR', 'blackmagic')).toBe(true);
    expect(fieldAvailable('blackR', 'lumix-http')).toBe(false);
    expect(fieldAvailable('hue', 'blackmagic')).toBe(false);
    expect(fieldAvailable('hue', 'sim')).toBe(true);
  });

  it('reads camera list (label only) and merges state', () => {
    const link = new CameraBridgeLink(() => 'ws://x', () => {});
    link.receive({ type: 'cameras', cameras: [{ cameraNumber: 2, connected: true, config: { connectionMode: 'blackmagic', label: 'Bühne', bmHost: '10.0.0.9' } }] });
    expect(link.cameras).toEqual([{ cameraNumber: 2, label: 'Bühne', mode: 'blackmagic', connected: true }]);
    link.receive({ type: 'state', cameraNumber: 2, state: { whiteR: 130, iris: 40 }, origins: { whiteR: 'confirmed' } });
    link.receive({ type: 'state', cameraNumber: 2, state: { whiteG: 128 } });
    expect(link.states.get(2)).toEqual({ paint: { whiteR: 130, whiteG: 128 }, origins: { whiteR: 'confirmed' } });
  });
});
