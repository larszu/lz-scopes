import { describe, expect, it } from 'vitest';
import { EV_C, TARGET_SCHEMA, evFromLux, lightControlState, lightDelta, matchesSearch, targetRecord } from '../src/opple/target';
import { isothermXy, planckXy } from '../src/opple/lightScience';
import type { Reading } from '../src/opple/photometry';
import type { LightPoint } from '../src/opple/store';

const reading = (x: number, y: number, lux: number, ts = Date.UTC(2026, 10, 24, 10, 0)): Reading => {
  const Y = lux, X = (x * Y) / y, Z = ((1 - x - y) * Y) / y;
  return { model: 'lm3', lux, X, Y, Z, x, y, u: 0, v: 0, cct: 0, duv: 0, mode: 3, bands: [], wavelengths: [], raw: [], calibrated: true, battery: null, temperature: null, ts };
};

describe('EV from illuminance (ISO 2720, flat receptor C = 250)', () => {
  it('EV 0 at 2.5 lx, one stop per doubling, ISO shifts', () => {
    expect(EV_C).toBe(250);
    expect(evFromLux(2.5)).toBeCloseTo(0, 12);
    expect(evFromLux(2560)).toBeCloseTo(10, 12);
    expect(evFromLux(1000) - evFromLux(500)).toBeCloseTo(1, 12);
    expect(evFromLux(2.5, 200)).toBeCloseTo(1, 12);
    expect(evFromLux(0)).toBeNaN();
  });
});

describe('distance of a reading to the target (#184)', () => {
  it('ΔCCT, ΔDuv and stops; Δu′v′ 0 for the same light', () => {
    const [x0, y0] = planckXy(5600), [x1, y1] = isothermXy(5000, 0.004);
    const d = lightDelta(reading(x0, y0, 1000), reading(x1, y1, 500));
    expect(d.dCct).toBeCloseTo(-600, -1);
    expect(d.dDuv).toBeCloseTo(0.004, 4);
    expect(d.dEv).toBeCloseTo(-1, 12);
    expect(d.duv).toBeGreaterThan(0);
    expect(lightDelta(reading(x0, y0, 800), reading(x0, y0, 800)).duv).toBe(0);
  });
});

describe('shared target record', () => {
  const [x, y] = planckXy(3200);
  const p: LightPoint = { id: 'p1', label: 'Key', place: 'Stage left', note: 'CTO ½', reading: reading(x, y, 1200) };
  it('schema, metadata and JSON-safe numbers', () => {
    const rec = targetRecord(p, 'LM3 A');
    expect(rec.schema).toBe(TARGET_SCHEMA);
    expect(rec).toMatchObject({ label: 'Key', place: 'Stage left', note: 'CTO ½', device: 'LM3 A', lux: 1200, quantity: 'lx', time: '2026-11-24T10:00:00.000Z' });
    expect(rec.cct).toBeCloseTo(3200, -1);
    expect(rec.ev100).toBeCloseTo(Math.log2(1200 / 2.5), 2);
    expect(JSON.parse(JSON.stringify(rec))).toEqual(rec);
  });
  it('no light: no CCT, no EV, still valid JSON', () => {
    const rec = targetRecord({ id: 'd', label: 'dark', reading: reading(0.3, 0.3, 0) });
    expect(rec.cct).toBeNull(); expect(rec.ev100).toBeNull();
    expect(JSON.stringify(rec)).not.toMatch(/NaN|null,"duv":NaN/);
  });
  it('control state: target, latest reading and the distance between them', () => {
    const [lx, ly] = planckXy(3400);
    const live = reading(lx, ly, 600);
    const st = lightControlState({ target: p, active: 'a', latest: () => live, label: (k) => k || '-', points: [p] });
    expect(st.target?.label).toBe('Key');
    expect(st.latest?.lux).toBe(600);
    expect(st.delta?.cct).toBeCloseTo(200, -1);
    expect(st.delta?.ev).toBeCloseTo(-1, 2);
    expect(lightControlState({ target: null, active: '', latest: () => null, label: () => '', points: [] })).toEqual({ target: null, latest: null, delta: null, points: 0 });
  });
});

describe('searching the measurements', () => {
  const p: LightPoint = { id: 'p', label: 'Fill', place: 'Studio 2', note: 'with diffusion', reading: reading(0.31, 0.32, 300) };
  it('every word has to match somewhere', () => {
    expect(matchesSearch(p, '')).toBe(true);
    expect(matchesSearch(p, 'studio fill')).toBe(true);
    expect(matchesSearch(p, 'DIFFUSION')).toBe(true);
    expect(matchesSearch(p, '2026-11-24')).toBe(true);
    expect(matchesSearch(p, 'lm4', 'LM4 B')).toBe(true);
    expect(matchesSearch(p, 'studio key')).toBe(false);
  });
});
