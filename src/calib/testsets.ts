// Own verification patch sets (DisplayCAL's .ti1 files are GPL data and not used; only the
// field counts 47/81 serve as orientation). All levels are 8-bit quantised, because that is
// what the canvas output shows. docs/research/display-kalibrierung.md

import { GAMUTS, gamutConvert, mul3, pqEncode } from '../color';
import { quantize, type RGB } from '../patchSequencer';
import { t } from '../i18n';

export interface TestPatch { rgb: RGB; label: string; kind: 'grey' | 'primary' | 'colour' }
export interface TestSet { id: string; name: string; hdr: boolean; patches: TestPatch[] }

const pct = (v: number) => `${Math.round(v * 1000) / 10} %`;
const grey = (v: number): TestPatch => ({ rgb: quantize([v, v, v]), label: t('calib.patch.grey', { v: pct(v) }), kind: 'grey' });
const HUES6: [string, RGB][] = [[t('calib.hue.red'), [1, 0, 0]], [t('calib.hue.green'), [0, 1, 0]], [t('calib.hue.blue'), [0, 0, 1]], [t('calib.hue.cyan'), [0, 1, 1]], [t('calib.hue.magenta'), [1, 0, 1]], [t('calib.hue.yellow'), [1, 1, 0]]];
const primaries = (levels: number[]): TestPatch[] => levels.flatMap((l) => HUES6.map(([n, c]) => ({ rgb: quantize(c.map((v) => v * l) as RGB), label: `${n} ${pct(l)}`, kind: 'primary' as const })));

/** Fully saturated colour of hue h (0…360°, HSV wheel, R at 0°). */
function hueRgb(h: number): RGB {
  const k = (n: number) => (n + h / 60) % 6;
  const f = (n: number) => 1 - Math.max(0, Math.min(k(n), 4 - k(n), 1));
  return [f(5), f(3), f(1)];
}
/** Signal level `level` with saturation `sat` (mix towards grey of the same level). */
const wheel = (count: number, level: number, sat: number): TestPatch[] => Array.from({ length: count }, (_, i) => {
  const h = (360 / count) * i, c = hueRgb(h);
  return { rgb: quantize(c.map((v) => level * (1 - sat + sat * v)) as RGB), label: t('calib.patch.hue', { h: Math.round(h), level: pct(level), sat: Math.round(sat * 100) }), kind: 'colour' as const };
});
const steps = (n: number) => Array.from({ length: n }, (_, i) => i / (n - 1));

/** PQ code of a luminance in a Rec.2020 container for linear RGB of another gamut scaled to `nits` white. */
function pqPatch(label: string, rgbLin: RGB, gamut: '709' | 'p3' | '2020', nits: number): TestPatch {
  const c = mul3(gamutConvert(GAMUTS[gamut], GAMUTS['2020']), rgbLin).map((v) => pqEncode(Math.max(0, v) * nits));
  return { rgb: quantize(c as RGB), label, kind: rgbLin[0] === rgbLin[1] && rgbLin[1] === rgbLin[2] ? 'grey' : 'colour' };
}
const HDR_GREY_NITS = [0, 0.5, 1, 2, 5, 10, 20, 50, 100, 203, 300, 400, 500, 600, 800, 1000, 1500, 2000, 4000, 10000];

export function hdrPqSet(peak: number): TestSet {
  const greys = HDR_GREY_NITS.filter((n) => n <= peak).map((n) => pqPatch(t('calib.patch.grey', { v: `${n} cd/m²` }), [1, 1, 1], '2020', n));
  const cols = [
    ...HUES6.map(([n, c]) => pqPatch(t('calib.patch.p3', { c: n }), c, 'p3', 203)),
    ...HUES6.map(([n, c]) => pqPatch(t('calib.patch.rec709', { c: n }), c, '709', 100)),
  ];
  return { id: `hdr-pq-${peak}`, name: t('calib.set.hdr', { peak, n: greys.length + cols.length }), hdr: true, patches: [...greys, ...cols] };
}

export const TEST_SETS: TestSet[] = [
  { id: 'grey21', name: t('calib.set.grey21'), hdr: false, patches: steps(21).map(grey) },
  { id: 'video47', name: 'Video 47', hdr: false, patches: [...steps(11).map(grey), ...primaries([1, 0.75, 0.5, 0.25]), ...wheel(12, 0.75, 0.5)] },
  {
    id: 'video81', name: t('calib.set.video81'), hdr: false,
    patches: [...steps(21).map(grey), ...primaries([1, 0.75, 0.5, 0.25, 0.1]), ...wheel(12, 0.75, 0.5), ...wheel(12, 0.5, 0.75), ...wheel(6, 1, 0.25)],
  },
  hdrPqSet(1000),
];
export const HDR_PEAKS = [100, 200, 500, 1000, 2000, 4000, 10000];

export function testSet(id: string): TestSet {
  const m = /^hdr-pq-(\d+)$/.exec(id);
  if (m) return hdrPqSet(Number(m[1]));
  return TEST_SETS.find((s) => s.id === id) ?? TEST_SETS[1];
}

// ---------------------------------------------------------------- uniformity

/** Levels measured per cell (DisplayCAL: white, 192, 128, 64 of 255 = 100/75/50/25 %). */
export const UNIFORMITY_LEVELS = [1, 0.75, 0.5, 0.25];
export const UNIFORMITY_GRIDS = [3, 5, 7, 9];

/** Cells row by row, fractions of the output. */
export function uniformityCells(n: number) {
  return Array.from({ length: n * n }, (_, i) => ({ row: Math.floor(i / n), col: i % n, rect: { x: (i % n) / n, y: Math.floor(i / n) / n, w: 1 / n, h: 1 / n } }));
}
