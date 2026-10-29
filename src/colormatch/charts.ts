// Test charts of the camera colour match, data-driven (docs/research/farbabgleich-werkzeug.md,
// "Karten"). A chart is a description – aspect ratio, field rectangles in chart coordinates
// 0..1 (x to the right, y down, from the top-left corner of the chart), field type and, where a
// public source exists, a reference value per field. A new chart is one more entry in CHART_SPECS;
// detection, sampling, ΔE and the control loop take everything else from the description.
//
// Reference values: CIE xyY, XYZ or CIELAB (relative to the white point `whitePoint`, default ICC D50, Y of a
// perfect diffuse white = 1), or only Y (luminance factor = reflectance) for neutral fields. A chart without values for
// every field is compared against a reference camera only.

import { GAMUTS, bradford, inv3, linearToSignal, mul3, rgbToXyzMatrix } from '../color';
import { BABELCOLOR_AVERAGE, REF_WHITE_XY } from '../match/chartRef';
import type { Space } from '../deltae';
import type { Rgb } from '../match/core';

export type FieldKind = 'color' | 'gray' | 'black' | 'white';

export type FieldValue = { xyY: [number, number, number] } | { lab: [number, number, number] } | { XYZ: [number, number, number] } | { Y: number };

export interface FieldSpec {
  name: string;
  kind: FieldKind;
  /** rectangle in chart coordinates 0..1 */
  x: number; y: number; w: number; h: number;
  value?: FieldValue;
}

export interface ChartSpec {
  id: string;
  name: string;
  /** width : height of the chart area the four corners enclose */
  aspect: number;
  fields: FieldSpec[];
  /** where the layout and values come from */
  source: string;
  /** shown in the dialog (e.g. "template, values missing"); an i18n key or plain text */
  note?: string;
  /** xy chromaticity of the white point the values refer to; default D50 (ICC PCS) */
  whitePoint?: [number, number];
}

/** Derived view the measurement and the loop use. */
export interface ChartDef {
  id: string;
  name: string;
  aspect: number;
  /** homography target: the unit square */
  width: 1;
  height: 1;
  patches: FieldSpec[];
  /** neutral fields, dark → bright */
  neutrals: number[];
  black: number;
  white: number;
  /** xy of the white point the field values refer to */
  whitePoint: [number, number];
  chromatic: number[];
  /** reference values in an encoding, or null when not every field has a value */
  reference: ((s: Space) => Rgb[]) | null;
  note?: string;
}

// ------------------------------------------------------------------ chart descriptions

const CLASSIC_NAMES = [
  'dark skin', 'light skin', 'blue sky', 'foliage', 'blue flower', 'bluish green',
  'orange', 'purplish blue', 'moderate red', 'purple', 'yellow green', 'orange yellow',
  'blue', 'green', 'red', 'yellow', 'magenta', 'cyan',
  'white', 'neutral 8', 'neutral 6.5', 'neutral 5', 'neutral 3.5', 'black',
];

/** Regular grid of fields inside the corners, `inset` = gap around each field as part of a cell. */
export function gridFields(cols: number, rows: number, names: string[], kinds: (i: number) => FieldKind, inset = 0, values?: (i: number) => FieldValue | undefined): FieldSpec[] {
  return names.map((name, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    return { name, kind: kinds(i), x: (c + inset) / cols, y: (r + inset) / rows, w: (1 - 2 * inset) / cols, h: (1 - 2 * inset) / rows, value: values?.(i) };
  });
}

/** ColorChecker Classic: 6 × 4 fields, corners = outer corners of the field grid. */
const CLASSIC: ChartSpec = {
  id: 'classic24', name: 'ColorChecker Classic (24)', aspect: 1.5,
  source: 'Layout: manufacturer data sheet (6 × 4, row by row from "dark skin"). Values: BabelColor average, xyY D50, via colour-science (THIRD_PARTY.md).',
  fields: gridFields(6, 4, CLASSIC_NAMES, (i) => (i === 18 ? 'white' : i === 23 ? 'black' : i > 18 ? 'gray' : 'color'), 0, (i) => ({ xyY: BABELCOLOR_AVERAGE[i] })),
};

/**
 * DSC ChromaDuMonde: 24 colour chips around the edge, skin tones and a black and a white field
 * inside. Simplified 8 × 6 layout, no published values used – reference camera only.
 */
function cdmFields(): FieldSpec[] {
  const out: FieldSpec[] = [], ring: [number, number][] = [];
  for (let x = 0; x < 8; x++) ring.push([x, 0]);
  for (let y = 1; y < 5; y++) ring.push([7, y]);
  for (let x = 7; x >= 0; x--) ring.push([x, 5]);
  for (let y = 4; y >= 1; y--) ring.push([0, y]);
  const cell = (x: number, y: number, w: number, h: number) => ({ x: x / 8, y: y / 6, w: w / 8, h: h / 6 });
  ring.forEach(([x, y], i) => out.push({ name: `chip ${i + 1}`, kind: 'color', ...cell(x + 0.1, y + 0.1, 0.8, 0.8) }));
  for (let i = 0; i < 4; i++) out.push({ name: `skin ${i + 1}`, kind: 'color', ...cell(2 + i + 0.1, 1.1, 0.8, 0.8) });
  out.push({ name: 'black', kind: 'black', ...cell(2.2, 2.4, 1.6, 1.2) });
  out.push({ name: 'white', kind: 'white', ...cell(4.2, 2.4, 1.6, 1.2) });
  return out;
}
const CDM: ChartSpec = {
  id: 'cdm', name: 'DSC ChromaDuMonde', aspect: 8 / 6, fields: cdmFields(),
  source: 'Simplified layout, not the manufacturer drawing; no values.',
  note: 'cm.cdmNote',
};

/**
 * Template for an Image Engineering TE156 black/grey chart. No public manufacturer data sheet
 * with layout and values could be found (state 29.10.2026), so nothing is filled in: 11 grey
 * fields in a row as a placeholder, no values. Fill in `aspect`, the field rectangles and `value`
 * ({ Y: reflectance } per field) from the data sheet that comes with the chart.
 */
const TE156_TEMPLATE: ChartSpec = {
  id: 'te156', name: 'TE156 (template)', aspect: 11 / 2,
  source: 'TEMPLATE – layout and values still to be taken from the manufacturer data sheet.',
  note: 'cm.templateNote',
  fields: gridFields(11, 1, Array.from({ length: 11 }, (_, i) => `step ${i + 1}`), (i) => (i === 0 ? 'white' : i === 10 ? 'black' : 'gray'), 0.1),
};

export const CHART_SPECS: ChartSpec[] = [CLASSIC, CDM, TE156_TEMPLATE];

// ------------------------------------------------------------------ derived view

const D50_WHITE = REF_WHITE_XY as [number, number];
export type Xy = [number, number];
const labToXyz = ([L, a, b]: number[], w: Xy) => {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200, e = 6 / 29;
  const f = (t: number) => (t > e ? t ** 3 : 3 * e * e * (t - 4 / 29));
  const wx = w[0] / w[1], wz = (1 - w[0] - w[1]) / w[1];
  return [wx * f(fx), f(fy), wz * f(fz)];
};

/** XYZ (relative to `white`, default D50; white Y = 1) of a field value. */
export function valueXyz(v: FieldValue, white: Xy = D50_WHITE): number[] {
  if ('xyY' in v) { const [x, y, Y] = v.xyY; return y > 0 ? [(x * Y) / y, Y, ((1 - x - y) * Y) / y] : [0, 0, 0]; }
  if ('XYZ' in v) return [...v.XYZ];
  if ('lab' in v) return labToXyz(v.lab, white);
  const [x, y] = white;
  return [(x * v.Y) / y, v.Y, ((1 - x - y) * v.Y) / y];
}

const lum = (f: FieldSpec) => (f.value ? valueXyz(f.value)[1] : NaN);

export function deriveChart(s: ChartSpec): ChartDef {
  const idx = s.fields.map((_, i) => i);
  const neutralIdx = idx.filter((i) => s.fields[i].kind !== 'color');
  // dark → bright: by reference luminance where known, else black first, white last, gray in order
  const rank = (i: number) => { const f = s.fields[i], y = lum(f); return Number.isFinite(y) ? y : f.kind === 'black' ? -1 : f.kind === 'white' ? 2 : 0.5; };
  const neutrals = [...neutralIdx].sort((a, b) => rank(a) - rank(b) || (s.fields[a].kind === 'gray' && s.fields[b].kind === 'gray' ? b - a : 0));
  const black = idx.find((i) => s.fields[i].kind === 'black') ?? neutrals[0] ?? 0;
  const white = idx.find((i) => s.fields[i].kind === 'white') ?? neutrals[neutrals.length - 1] ?? 0;
  const full = s.fields.every((f) => f.value);
  const whitePoint = s.whitePoint ?? D50_WHITE;
  return {
    id: s.id, name: s.name, aspect: s.aspect, width: 1, height: 1, patches: s.fields, note: s.note,
    neutrals, black, white, whitePoint,
    chromatic: idx.filter((i) => s.fields[i].kind === 'color'),
    reference: full ? (space) => referenceSignals(s.fields, space, whitePoint) : null,
  };
}

/** Field values as signal in `space`: XYZ (white `white`, default D50) → Bradford to the gamut white → linear RGB → curve. */
export function referenceSignals(fields: FieldSpec[], space: Space, white: Xy = D50_WHITE): Rgb[] {
  const g = GAMUTS[space.gamut], toRgb = inv3(rgbToXyzMatrix(g)), adapt = bradford(white, g.white);
  return fields.map((f) => linearToSignal(mul3(toRgb, mul3(adapt, valueXyz(f.value!, white))), space.transfer, space.hlgLw) as Rgb);
}

export const CHARTS: Record<string, ChartDef> = Object.fromEntries(CHART_SPECS.map((s) => [s.id, deriveChart(s)]));
export type ChartId = string;
