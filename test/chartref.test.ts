// ColorChecker reference values (#200): the chart as it should be, in the encoding of the
// source. Data: BabelColor Average under ICC D50 (colour-science, BSD-3-Clause).
import { describe, expect, it } from 'vitest';
import { BABELCOLOR_AVERAGE, REF_WHITE_XY, WHITE_PATCH, chartReference, normaliseExposure, xyYToXyz } from '../src/match/chartRef';
import { matchMatrix, suggestMatrix } from '../src/match/chart';
import type { Space } from '../src/deltae';

const REC709: Space = { transfer: 'sdr', gamut: '709', hlgLw: 1000 };

describe('ColorChecker reference', () => {
  it('24 patches, the greyscale at the end, the white the brightest', () => {
    expect(BABELCOLOR_AVERAGE).toHaveLength(24);
    const Y = BABELCOLOR_AVERAGE.map((p) => p[2]);
    // bottom row: white → black, each step darker
    for (let i = 18; i < 23; i++) expect(Y[i]).toBeGreaterThan(Y[i + 1]);
    expect(Y[WHITE_PATCH]).toBe(Math.max(...Y));
    // the greys sit near the D50 white point of the data
    for (let i = 18; i < 24; i++) {
      expect(BABELCOLOR_AVERAGE[i][0]).toBeCloseTo(REF_WHITE_XY[0], 1);
      expect(BABELCOLOR_AVERAGE[i][1]).toBeCloseTo(REF_WHITE_XY[1], 1);
    }
  });

  it('xyY → XYZ keeps the luminance and the chromaticity', () => {
    const [X, Y, Z] = xyYToXyz([0.3127, 0.329, 0.5]);
    expect(Y).toBe(0.5);
    expect(X / (X + Y + Z)).toBeCloseTo(0.3127, 6);
    expect(Y / (X + Y + Z)).toBeCloseTo(0.329, 6);
    expect(xyYToXyz([0.3, 0, 0.5])).toEqual([0, 0, 0]);
  });

  it('in Rec.709: greys stay neutral, the white lands near 90 %', () => {
    const ref = chartReference(REC709);
    expect(ref.patches).toHaveLength(24);
    // the real chart's greys are not perfectly neutral; after the D50 → D65 adaptation they
    // stay within a couple of percent of each other, which is what a grey scale looks like
    for (let i = 18; i < 24; i++) {
      const [r, g, b] = ref.patches[i]!;
      expect(Math.abs(r - g)).toBeLessThan(0.02);
      expect(Math.abs(g - b)).toBeLessThan(0.02);
    }
    const white = ref.patches[WHITE_PATCH]!;
    // Y 0.9129 through the BT.1886 curve ≈ 0.96 signal; definitely in the upper tenth, not clipped
    expect(white[0]).toBeGreaterThan(0.9);
    expect(white[0]).toBeLessThan(1.001);
    // the dark skin patch is reddish: more red than blue
    expect(ref.patches[0]![0]).toBeGreaterThan(ref.patches[0]![2]);
  });

  it('patches that Rec.709 cannot hold are marked, not silently clipped', () => {
    const ref = chartReference(REC709);
    const n = ref.outside.filter(Boolean).length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(12);
    // the greyscale always fits
    for (let i = 18; i < 24; i++) expect(ref.outside[i]).toBe(false);
  });

  it('a wider gamut holds more of them', () => {
    const n709 = chartReference(REC709).outside.filter(Boolean).length;
    const n2020 = chartReference({ ...REC709, gamut: '2020' }).outside.filter(Boolean).length;
    expect(n2020).toBeLessThan(n709);
  });

  it('works as a reference for the match matrix and the matrix suggestion', () => {
    const ref = chartReference(REC709, 'soll');
    // a camera that is 4 % too green
    const cam = { id: 'cam', space: REC709, patches: ref.patches.map((p) => [p![0], Math.min(1, p![1] * 1.04), p![2]] as [number, number, number]) };
    const rows = matchMatrix([ref, cam], 'soll');
    expect(rows.find((r) => r.id === 'soll')!.mean).toBeCloseTo(0, 6);
    const camRow = rows.find((r) => r.id === 'cam')!;
    expect(camRow.mean).toBeGreaterThan(0.5);
    const fix = suggestMatrix(cam, ref);
    expect(fix).not.toBeNull();
    expect(fix!.after).toBeLessThan(fix!.before);
  });
});

// Cross-check with independent data: the widely published sRGB approximations of the same chart
// (src/patterns.ts MACBETH, 8-bit values from X-Rite's own publications). They describe the same
// 24 patches, so they have to land near the BabelColor reference – if the adaptation or the
// encoding were wrong, ΔE would explode instead of staying in the single digits.
const MACBETH_SRGB: [number, number, number][] = [
  [115, 82, 68], [194, 150, 130], [98, 122, 157], [87, 108, 67], [133, 128, 177], [103, 189, 170],
  [214, 126, 44], [80, 91, 166], [193, 90, 99], [94, 60, 108], [157, 188, 64], [224, 163, 46],
  [56, 61, 150], [70, 148, 73], [175, 54, 60], [231, 199, 31], [187, 86, 149], [8, 133, 161],
  [243, 243, 242], [200, 200, 200], [160, 160, 160], [122, 122, 121], [85, 85, 85], [52, 52, 52],
];

describe('reference against the published sRGB values', () => {
  const SRGB: Space = { transfer: 'srgb', gamut: '709', hlgLw: 1000 };
  const cam = { id: 'srgb-table', space: SRGB, patches: MACBETH_SRGB.map((p) => p.map((v) => v / 255) as [number, number, number]) };

  it('lands within a few ΔE of the measured average', () => {
    const ref = chartReference(SRGB, 'soll');
    const row = matchMatrix([ref, normaliseExposure(cam, ref).cam], 'soll').find((r) => r.id === 'srgb-table')!;
    expect(row.mean).toBeLessThan(8);
    // the greyscale is where both agree best
    const greys = row.de.slice(18).filter((v): v is number => v != null);
    expect(Math.max(...greys)).toBeLessThan(6);
  });

  it('a camera that is clearly off is clearly worse', () => {
    const ref = chartReference(SRGB, 'soll');
    const good = matchMatrix([ref, normaliseExposure(cam, ref).cam], 'soll').find((r) => r.id === 'srgb-table')!.mean!;
    const tinted = { ...cam, id: 'tinted', patches: cam.patches.map(([r, g, b]) => [Math.min(1, r * 1.15), g, Math.min(1, b * 0.85)] as [number, number, number]) };
    const bad = matchMatrix([ref, normaliseExposure(tinted, ref).cam], 'soll').find((r) => r.id === 'tinted')!.mean!;
    expect(bad).toBeGreaterThan(good * 1.5);
  });

  it('exposure is taken out: half a stop down barely changes ΔE', () => {
    const ref = chartReference(SRGB, 'soll');
    const dark = { ...cam, id: 'dark', patches: cam.patches.map((p) => p.map((v) => Math.pow(Math.pow(v, 2.2) * 0.7, 1 / 2.2)) as [number, number, number]) };
    const a = matchMatrix([ref, normaliseExposure(cam, ref).cam], 'soll').find((r) => r.id === 'srgb-table')!.mean!;
    const b = matchMatrix([ref, normaliseExposure(dark, ref).cam], 'soll').find((r) => r.id === 'dark')!.mean!;
    expect(Math.abs(b - a)).toBeLessThan(1.5);
    // without the normalisation the same picture would look much worse
    const raw = matchMatrix([ref, dark], 'soll').find((r) => r.id === 'dark')!.mean!;
    expect(raw).toBeGreaterThan(b * 1.5);
  });
});
