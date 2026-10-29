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
    ['no known value type', { ...ramp(), fields: [{ name: 'x', kind: 'white', x: 0, y: 0, w: 1, h: 1, value: { rgb8: [1, 2, 3] } }] }, 'one of XYZ'],
    ['XYZ out of range', { ...ramp(), fields: [{ name: 'x', kind: 'white', x: 0, y: 0, w: 1, h: 1, value: { XYZ: [0.9, 3, 1] } }] }, 'XYZ outside'],
    ['field far out of the chart', { ...ramp(), fields: [{ name: 'x', kind: 'white', x: -0.05, y: 0, w: 0.5, h: 1 }] }, 'outside 0…1'],
    ['only colour fields', { ...ramp(), fields: [{ name: 'x', kind: 'color', x: 0, y: 0, w: 1, h: 1 }] }, 'gray, black or white'],
    ['bad white point', { ...ramp(), whitePoint: [0.7, 0.5] }, 'whitePoint'],
  ])('rejects %s', (_n, input, msg) => {
    const r = checkChartSpec(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join('\n')).toContain(msg);
  });

  it('ignores unknown extra keys and clips rounding past the edge', () => {
    const r = checkChartSpec({ ...ramp(), tool: { version: 3 }, fields: [{ name: 'w', kind: 'white', x: -0.002, y: 0, w: 1.004, h: 1, extra: 1, value: { Y: 0.9, raw: [1, 2], rgb8: [230, 230, 230] } }] });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.spec.fields[0]).toEqual({ name: 'w', kind: 'white', x: 0, y: 0, w: 1, h: 1, value: { Y: 0.9 } }); expect('tool' in r.spec).toBe(false); }
  });

  it('converts the field-list format (centre/size, XYZ, D65) – synthetic values', () => {
    const file = {
      karte: 'Synthetic Card', seitenverhaeltnis: 2, sollwerte: { weisspunkt: 'D65 (assumed)' }, extra_top: true,
      felder: [
        { name: 'White', typ: 'weiss', mitte: [0.25, 0.5], groesse: [0.4, 0.8], XYZ: [0.9505, 1, 1.089], sampler_roh: { center: [0, 0] }, XYZ_xml: [1, 1, 1] },
        { name: 'Patch', typ: 'farbe', mitte: [0.75, 0.5], groesse: [0.4, 0.8], XYZ: [0.2, 0.15, 0.1], rgb8: [1, 2, 3] },
        { name: 'No area', typ: 'grau', mitte: [0.5, 0.5], groesse: [0, 0], XYZ: [0.2, 0.2, 0.2] },
      ],
    };
    const r = parseChartJson(JSON.stringify(file), 'synth.json');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec).toMatchObject({ id: 'user:synthetic-card', name: 'Synthetic Card', aspect: 2, whitePoint: [0.3127, 0.329], note: '1 / 3 fields without area left out.' });
    expect(r.spec.fields).toHaveLength(2);
    expect(r.spec.fields[0]).toMatchObject({ kind: 'white', value: { XYZ: [0.9505, 1, 1.089] } });
    expect(r.spec.fields[0].x).toBeCloseTo(0.05); expect(r.spec.fields[0].w).toBeCloseTo(0.4);
    // the D65 white field renders neutral in Rec.709
    const [w] = deriveChart(r.spec).reference!({ transfer: 'sdr', gamut: '709', hlgLw: 1000 });
    expect(Math.abs(w[0] - w[2])).toBeLessThan(2e-3);
    expect(Math.abs(w[0] - w[1])).toBeLessThan(2e-3);
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
