import { describe, expect, it } from 'vitest';
import { aliasOf, analyseFlicker, exposureResponse, shutterCheck, shutterOptions, simulateProfiles } from '../src/led/flicker';

describe('shutter finder: alias and exposure (ENTTEC examples)', () => {
  it('400 Hz at 24 fps pulses at about 8 Hz', () => {
    expect(Math.abs(aliasOf(400, 24))).toBeCloseTo(8, 6);
    expect(400 / 24).toBeCloseTo(16.67, 2);
  });
  it('whole cycles: 1/50 s spans 8 cycles of 400 Hz and cancels the flicker', () => {
    const c = shutterCheck(400, 1 / 50);
    expect(c.cycles).toBeCloseTo(8, 9);
    expect(c.whole).toBe(true);
    expect(c.response).toBeLessThan(1e-9);
    expect(exposureResponse(400, 1 / 2000)).toBeGreaterThan(0.9); // under one cycle: barely averaged
  });
  it('options list 1/400 … 1/50 for 400 Hz at 24 fps, nearest 180° first', () => {
    const o = shutterOptions(400, 24, { max: 20 });
    const xs = o.map((s) => Math.round(s.oneOver));
    for (const x of [400, 200, 100, 50]) expect(xs).toContain(x);
    // n = 8 → 1/50 s = 172.8°, n = 9 → 1/44.4 s = 194.4°
    expect(o[0].cycles).toBe(8);
    expect(o[0].angle).toBeCloseTo(172.8, 6);
    expect(o.every((s) => s.angle <= 360 + 1e-9)).toBe(true);
  });
});

describe('shutter finder: synthetic rolling-shutter camera', () => {
  const base = { rows: 540, frames: 64, fps: 50, f: 3840, duty: 0.5, readout: 0.015 };
  it('finds alias, band spacing and readout of a 3840 Hz wall at 50 fps', () => {
    const fr = simulateProfiles({ ...base, T: 1 / 100, content: (y) => 0.6 + 0.3 * Math.sin(y / 40) });
    const r = analyseFlicker(fr, { fps: 50, refreshHz: 3840, height: 540 });
    expect(aliasOf(3840, 50)).toBeCloseTo(-10, 9);
    expect(r.alias).toBeCloseTo(-10, 0);
    expect(r.ky).toBeCloseTo((3840 * 0.015) / 540, 3);
    expect(r.readoutMs).toBeCloseTo(15, 0);
    expect(r.consistent).toBe(true);
    expect(r.bandPct).toBeGreaterThan(0.5);
  });
  it('alias sign follows the direction: 3860 Hz moves the other way', () => {
    const r = analyseFlicker(simulateProfiles({ ...base, f: 3860, T: 1 / 100 }), { fps: 50, refreshHz: 3860 });
    expect(r.alias).toBeCloseTo(10, 0);
  });
  it('a shutter of whole cycles leaves no bands', () => {
    const T = 38 / 3840; // 178°
    const r = analyseFlicker(simulateProfiles({ ...base, T }), { fps: 50, refreshHz: 3840 });
    expect(r.bandPct).toBeLessThan(0.01);
  });
  it('estimates f from the readout time when the refresh is unknown', () => {
    const fr = simulateProfiles({ ...base, T: 1 / 100 });
    const r = analyseFlicker(fr, { fps: 50, height: 540, readoutMs: 15 });
    expect(r.fSource).toBe('readout');
    expect(r.f).toBeCloseTo(3840, 0);
    expect(r.candidates[0]).toBeCloseTo(40, 0);
    // a data-sheet readout 2 % off lands on a neighbouring candidate (k·fs + alias): only an estimate
    const off = analyseFlicker(fr, { fps: 50, height: 540, readoutMs: 15.3 });
    expect(Math.abs(off.f - 3840)).toBeLessThanOrEqual(2 * 50 + 1);
    expect(Math.abs(((off.f - 3840) / 50) % 1)).toBeLessThan(0.02);
  });
  it('counts skipped frames and still measures', () => {
    const r = analyseFlicker(simulateProfiles({ ...base, T: 1 / 100, skip: (n) => n % 7 === 3 }), { fps: 50, refreshHz: 3840 });
    expect(r.missing).toBeGreaterThan(5);
    expect(r.alias).toBeCloseTo(-10, 0);
  });
  it('whole-frame pulsing of a 100 Hz light seen by a fast readout', () => {
    const r = analyseFlicker(simulateProfiles({ rows: 200, frames: 96, fps: 30, f: 100, duty: 0.5, T: 1 / 1000, readout: 0.0002 }), { fps: 30 });
    expect(r.pumpHz).toBeCloseTo(Math.abs(aliasOf(100, 30)), 0);
    expect(r.pumpPct).toBeGreaterThan(20);
  });
  it('standing bands of a genlocked wall (f multiple of the frame rate)', () => {
    const r = analyseFlicker(simulateProfiles({ ...base, f: 3850, T: 1 / 1000 }), { fps: 50, refreshHz: 3850, height: 540 });
    expect(Math.abs(r.alias)).toBeLessThan(0.5);
    expect(r.staticKy).toBeCloseTo((3850 * 0.015) / 540, 3);
    expect(r.staticPct).toBeGreaterThan(3);
  });
});
