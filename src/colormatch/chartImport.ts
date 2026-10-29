// Imported chart definitions (docs/research/farbabgleich-werkzeug.md, "Eigene Karten"). Reference
// values from other software must not go into this public repository, so a user loads them as a
// JSON file in the same format as the entries in charts.ts; it is checked here, kept in this
// browser's localStorage and listed next to the built-in charts. Export writes the same format.

import { CHART_SPECS, deriveChart, type ChartDef, type ChartSpec, type FieldKind, type FieldSpec, type FieldValue } from './charts';

export const USER_PREFIX = 'user:';
const KEY = 'lzs.colormatch.charts';
const KINDS: FieldKind[] = ['color', 'gray', 'black', 'white'];
const MAX_FIELDS = 400;

export type CheckResult = { ok: true; spec: ChartSpec } | { ok: false; errors: string[] };

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const tuple = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every(num);

function checkValue(v: unknown, at: string, err: string[]): FieldValue | undefined {
  if (v == null) return undefined;
  if (typeof v !== 'object') { err.push(`${at}: value must be an object`); return undefined; }
  // the first known encoding wins; other keys (notes, raw data of the exporting tool) are ignored
  const o = v as Record<string, unknown>;
  if ('XYZ' in o) {
    if (!tuple(o.XYZ, 3)) { err.push(`${at}: XYZ must be [X, Y, Z]`); return undefined; }
    if (o.XYZ.some((c) => c < 0 || c > 2)) err.push(`${at}: XYZ outside 0…2 (white Y = 1)`);
    return { XYZ: [o.XYZ[0], o.XYZ[1], o.XYZ[2]] };
  }
  if ('xyY' in o) {
    if (!tuple(o.xyY, 3)) { err.push(`${at}: xyY must be [x, y, Y]`); return undefined; }
    const [x, y, Y] = o.xyY;
    if (x < 0 || x > 1 || y <= 0 || y > 1 || x + y > 1) err.push(`${at}: xyY chromaticity outside the diagram`);
    if (Y < 0 || Y > 2) err.push(`${at}: xyY luminance Y outside 0…2`);
    return { xyY: [x, y, Y] };
  }
  if ('lab' in o) {
    if (!tuple(o.lab, 3)) { err.push(`${at}: lab must be [L, a, b]`); return undefined; }
    const [L, a, b] = o.lab;
    if (L < 0 || L > 100) err.push(`${at}: L outside 0…100`);
    if (Math.abs(a) > 200 || Math.abs(b) > 200) err.push(`${at}: a/b outside −200…200`);
    return { lab: [L, a, b] };
  }
  if ('Y' in o) {
    if (!num(o.Y) || o.Y < 0 || o.Y > 2) { err.push(`${at}: Y must be a number 0…2`); return undefined; }
    return { Y: o.Y };
  }
  err.push(`${at}: value needs one of XYZ, xyY, lab, Y`);
  return undefined;
}

/** Schema and range check of one chart description (JSON already parsed). */
export function checkChartSpec(input: unknown): CheckResult {
  const err: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['chart must be a JSON object'] };
  const o = input as Record<string, unknown>;
  const id = typeof o.id === 'string' ? o.id.trim() : '', name = typeof o.name === 'string' ? o.name.trim() : '';
  if (!id || id.length > 64 || !/^[\w.:-]+$/.test(id)) err.push('id: 1…64 characters of letters, digits, _ . : -');
  if (!name || name.length > 80) err.push('name: 1…80 characters');
  if (!num(o.aspect) || o.aspect < 0.1 || o.aspect > 20) err.push('aspect: number 0.1…20 (width : height)');
  if (o.source != null && typeof o.source !== 'string') err.push('source: text');
  if (o.note != null && typeof o.note !== 'string') err.push('note: text');
  let whitePoint: [number, number] | undefined;
  if (o.whitePoint != null) {
    if (!tuple(o.whitePoint, 2) || o.whitePoint[0] <= 0 || o.whitePoint[1] <= 0 || o.whitePoint[0] + o.whitePoint[1] >= 1) err.push('whitePoint: [x, y] chromaticity');
    else whitePoint = [o.whitePoint[0], o.whitePoint[1]];
  }
  const fields: FieldSpec[] = [];
  if (!Array.isArray(o.fields) || o.fields.length === 0 || o.fields.length > MAX_FIELDS) err.push(`fields: list of 1…${MAX_FIELDS} fields`);
  else o.fields.forEach((f: unknown, i: number) => {
    const at = `fields[${i}]`;
    if (!f || typeof f !== 'object') { err.push(`${at}: object expected`); return; }
    const q = f as Record<string, unknown>;
    if (typeof q.name !== 'string' || !q.name.trim()) err.push(`${at}.name: text`);
    if (!KINDS.includes(q.kind as FieldKind)) err.push(`${at}.kind: one of ${KINDS.join(', ')}`);
    const r = [q.x, q.y, q.w, q.h];
    if (!r.every(num)) { err.push(`${at}: x, y, w, h must be numbers`); return; }
    let [x, y, w, h] = r as number[];
    // rounding in exported layouts: up to 1 % past the edge is clipped, more is an error
    const TOL = 0.01;
    if (w <= 0 || h <= 0 || x < -TOL || y < -TOL || x + w > 1 + TOL || y + h > 1 + TOL) err.push(`${at}: rectangle outside 0…1`);
    else { const x1 = Math.min(1, x + w), y1 = Math.min(1, y + h); x = Math.max(0, x); y = Math.max(0, y); w = x1 - x; h = y1 - y; }
    const value = checkValue(q.value, `${at}.value`, err);
    fields.push({ name: String(q.name ?? '').trim(), kind: q.kind as FieldKind, x, y, w, h, ...(value ? { value } : {}) });
  });
  if (fields.length && !fields.some((f) => f.kind !== 'color')) err.push('fields: at least one gray, black or white field (needed for white and black balance)');
  if (err.length) return { ok: false, errors: err };
  const spec: ChartSpec = {
    id: id.startsWith(USER_PREFIX) ? id : USER_PREFIX + id, name, aspect: o.aspect as number, fields,
    source: typeof o.source === 'string' ? o.source : 'imported',
    ...(typeof o.note === 'string' && o.note ? { note: o.note } : {}),
    ...(whitePoint ? { whitePoint } : {}),
  };
  return { ok: true, spec };
}

// ------------------------------------------------------------------ converter: German field-list format
//
// A second layout some extraction tools write: `karte` (name), `seitenverhaeltnis` (aspect),
// `sollwerte.weisspunkt` (text naming D50 or D65), `felder[]` with `name`, `typ`
// (farbe/grau/weiss/schwarz), `mitte` and `groesse` (centre and size, 0..1, origin top left) and
// `XYZ` (white Y = 1). Everything else in those files is ignored.

const KIND_DE: Record<string, FieldKind> = { farbe: 'color', grau: 'gray', weiss: 'white', 'weiß': 'white', schwarz: 'black' }; // lang-ok: keys of the imported field-list format, not UI text
const WHITES: [RegExp, [number, number]][] = [[/\bD65\b/i, [0.3127, 0.329]], [/\bD50\b/i, [0.3457, 0.3585]]];

export function isFieldListFormat(j: unknown): boolean {
  return !!j && typeof j === 'object' && Array.isArray((j as Record<string, unknown>).felder);
}

/** Field-list format → chart description (unchecked; checkChartSpec does the checking). */
export function fromFieldList(j: Record<string, unknown>, fallbackId = 'chart'): Record<string, unknown> {
  const name = typeof j.karte === 'string' ? j.karte : fallbackId;
  const soll = (j.sollwerte ?? {}) as Record<string, unknown>;
  const wp = typeof soll.weisspunkt === 'string' ? WHITES.find(([re]) => re.test(soll.weisspunkt as string))?.[1] : undefined;
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'chart';
  // fields with size 0 have no sampling area in the source: they cannot be measured, so they are left out
  const all = j.felder as Record<string, unknown>[];
  const usable = all.filter((f) => !Array.isArray(f.groesse) || ((f.groesse as number[])[0] > 0 && (f.groesse as number[])[1] > 0));
  const skipped = all.length - usable.length;
  return {
    id: slug, name, aspect: j.seitenverhaeltnis,
    source: 'imported (field-list format)',
    ...(skipped ? { note: `${skipped} / ${all.length} fields without area left out.` } : {}),
    ...(wp ? { whitePoint: wp } : {}),
    fields: usable.map((f) => {
      const [cx, cy] = Array.isArray(f.mitte) ? (f.mitte as number[]) : [NaN, NaN];
      const [w, h] = Array.isArray(f.groesse) ? (f.groesse as number[]) : [NaN, NaN];
      return {
        name: f.name, kind: KIND_DE[String(f.typ).toLowerCase()] ?? f.typ,
        x: cx - w / 2, y: cy - h / 2, w, h,
        ...(Array.isArray(f.XYZ) ? { value: { XYZ: f.XYZ } } : {}),
      };
    }),
  };
}

/** Parse a file's text (native or field-list format); JSON errors become check errors. */
export function parseChartJson(text: string, fileName = ''): CheckResult {
  let j: unknown;
  try { j = JSON.parse(text); } catch (e) { return { ok: false, errors: [`JSON: ${(e as Error).message}`] }; }
  if (isFieldListFormat(j)) j = fromFieldList(j as Record<string, unknown>, fileName.replace(/\.json$/i, ''));
  return checkChartSpec(j);
}

/** The JSON that export writes (and import reads back): the plain description, id without prefix. */
export function chartToJson(s: ChartSpec): string {
  const { id, ...rest } = s;
  return JSON.stringify({ id: id.startsWith(USER_PREFIX) ? id.slice(USER_PREFIX.length) : id, ...rest }, null, 2);
}

// ------------------------------------------------------------------ local storage

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const store = (): Store | null => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } };

export function loadUserCharts(s: Store | null = store()): ChartSpec[] {
  try {
    const list = JSON.parse(s?.getItem(KEY) ?? '[]') as unknown[];
    return Array.isArray(list) ? list.map(checkChartSpec).flatMap((r) => (r.ok ? [r.spec] : [])) : [];
  } catch { return []; }
}

function saveUserCharts(list: ChartSpec[], s: Store | null) {
  try { s?.setItem(KEY, JSON.stringify(list)); } catch { /* storage full or blocked: kept for this session only */ }
}

/** Add or replace (same id) an imported chart; returns the stored spec. */
export function addUserChart(spec: ChartSpec, s: Store | null = store()): ChartSpec {
  const list = loadUserCharts(s).filter((c) => c.id !== spec.id);
  list.push(spec);
  saveUserCharts(list, s);
  return spec;
}

export function removeUserChart(id: string, s: Store | null = store()) {
  saveUserCharts(loadUserCharts(s).filter((c) => c.id !== id), s);
}

/** Built-in charts first, then the imported ones. */
export function allChartSpecs(s: Store | null = store()): ChartSpec[] { return [...CHART_SPECS, ...loadUserCharts(s)]; }

export function chartDef(id: string, s: Store | null = store()): ChartDef {
  const spec = allChartSpecs(s).find((c) => c.id === id) ?? CHART_SPECS[0];
  return deriveChart(spec);
}
