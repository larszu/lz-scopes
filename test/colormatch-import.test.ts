import { describe, expect, it } from 'vitest';
import { CHART_SPECS, deriveChart, gridFields } from '../src/colormatch/charts';
import { addUserChart, allChartSpecs, chartDef, chartToJson, checkChartSpec, loadUserCharts, parseChartJson, removeUserChart } from '../src/colormatch/chartImport';

// Imported chart definitions (src/colormatch/chartImport.ts). The test chart is made up: a grey
// ramp with invented luminance factors – no values from any manufacturer or other software.

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

const ramp = () => ({
  id: 'ramp5', name: 'Test ramp', aspect: 5, source: 'made up for the test',
  fields: gridFields(5, 1, ['w', 'g1', 'g2', 'g3', 'b'], (i) => (i === 0 ? 'white' : i === 4 ? 'black' : 'gray'), 0.1, (i) => ({ Y: [0.9, 0.5, 0.25, 0.1, 0.03][i] })),
});

describe('chart import: schema and ranges', () => {
  it('accepts a valid chart and prefixes the id', () => {
    const r = checkChartSpec(ramp());
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.spec.id).toBe('user:ramp5'); expect(r.spec.fields).toHaveLength(5); }
  });

  it('accepts the built-in charts in their own format', () => {
    for (const s of CHART_SPECS) expect(checkChartSpec(JSON.parse(chartToJson(s))).ok, s.id).toBe(true);
  });

  it.each([
    ['not an object', [], 'JSON object'],
    ['no id', { ...ramp(), id: '' }, 'id'],
    ['bad aspect', { ...ramp(), aspect: -1 }, 'aspect'],
    ['no fields', { ...ramp(), fields: [] }, 'fields'],
    ['field out of the chart', { ...ramp(), fields: [{ name: 'x', kind: 'white', x: 0.8, y: 0, w: 0.3, h: 1 }] }, 'outside 0…1'],
    ['unknown kind', { ...ramp(), fields: [{ name: 'x', kind: 'skin', x: 0, y: 0, w: 1, h: 1 }] }, 'kind'],
    ['xy outside the diagram', { ...ramp(), fields: [{ name: 'x', kind: 'white', x: 0, y: 0, w: 1, h: 1, value: { xyY: [0.8, 0.5, 0.9] } }] }, 'chromaticity'],
    ['L out of range', { ...ramp(), fields: [{ name: 'x', kind: 'white', x: 0, y: 0, w: 1, h: 1, value: { lab: [120, 0, 0] } }] }, 'L outside'],
    ['two value types', { ...ramp(), fields: [{ name: 'x', kind: 'white', x: 0, y: 0, w: 1, h: 1, value: { Y: 0.5, lab: [50, 0, 0] } }] }, 'exactly one'],
    ['only colour fields', { ...ramp(), fields: [{ name: 'x', kind: 'color', x: 0, y: 0, w: 1, h: 1 }] }, 'gray, black or white'],
    ['bad white point', { ...ramp(), whitePoint: [0.7, 0.5] }, 'whitePoint'],
  ])('rejects %s', (_n, input, msg) => {
    const r = checkChartSpec(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toContain(msg);
  });

  it('reports broken JSON as an error', () => {
    const r = parseChartJson('{ "id": ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/^JSON/);
  });
});

describe('chart import: storage, selection, export', () => {
  it('stores, lists after the built-ins, replaces by id and removes', () => {
    const s = memory();
    const r = checkChartSpec(ramp());
    if (!r.ok) throw new Error('invalid');
    addUserChart(r.spec, s);
    addUserChart({ ...r.spec, name: 'Test ramp 2' }, s);
    expect(loadUserCharts(s).map((c) => c.name)).toEqual(['Test ramp 2']);
    expect(allChartSpecs(s).map((c) => c.id)).toEqual([...CHART_SPECS.map((c) => c.id), 'user:ramp5']);
    const def = chartDef('user:ramp5', s);
    expect(def.white).toBe(0);
    expect(def.black).toBe(4);
    expect(def.reference).not.toBeNull();
    removeUserChart('user:ramp5', s);
    expect(loadUserCharts(s)).toEqual([]);
    expect(chartDef('user:ramp5', s).id).toBe(CHART_SPECS[0].id); // gone → first built-in
  });

  it('ignores stored entries that no longer pass the check', () => {
    const s = memory();
    s.setItem('lzs.colormatch.charts', JSON.stringify([{ id: 'x' }, ramp()]));
    expect(loadUserCharts(s).map((c) => c.id)).toEqual(['user:ramp5']);
    s.setItem('lzs.colormatch.charts', 'not json');
    expect(loadUserCharts(s)).toEqual([]);
  });

  it('export and import round-trip', () => {
    const r = checkChartSpec({ ...ramp(), whitePoint: [0.3127, 0.329] });
    if (!r.ok) throw new Error('invalid');
    const back = parseChartJson(chartToJson(r.spec));
    expect(back).toEqual({ ok: true, spec: r.spec });
    expect(JSON.parse(chartToJson(r.spec)).id).toBe('ramp5');
  });

  it('honours the white point of the values: a neutral at the spec white stays neutral', () => {
    const d65: [number, number] = [0.3127, 0.329];
    const r = checkChartSpec({ ...ramp(), whitePoint: d65, fields: [{ name: 'w', kind: 'white', x: 0, y: 0, w: 1, h: 1, value: { xyY: [...d65, 0.9] } }] });
    if (!r.ok) throw new Error('invalid');
    const [rgb] = deriveChart(r.spec).reference!({ transfer: 'sdr', gamut: '709', hlgLw: 1000 });
    expect(Math.abs(rgb[0] - rgb[2])).toBeLessThan(1e-6);
    expect(Math.abs(rgb[0] - rgb[1])).toBeLessThan(1e-6);
  });
});
