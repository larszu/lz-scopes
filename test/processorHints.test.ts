import { describe, expect, it } from 'vitest';
import { D65, GAMUTS, mul3, rgbToXyzMatrix } from '../src/color';
import { whiteCorrection, xyOf, type MeterResults, type XYZ } from '../src/led/oppleCheck';
import { cabinetMatch, cabinetMatchHint, kelvinSuggestion, whitePointHints } from '../src/led/processorHints';
import { DEFAULT_WALL, sanitizeWall } from '../src/led/wall';

const M = rgbToXyzMatrix(GAMUTS['709']);
const g = GAMUTS['709'];
/** cabinet with channel balance b and overall level L (XYZ of W, R, G, B) */
const cab = (b: number[], L: number) => {
  const col = (i: number): XYZ => [M[i] * L * b[i], M[3 + i] * L * b[i], M[6 + i] * L * b[i]];
  return { W: mul3(M, b).map((v) => v * L) as XYZ, R: col(0), G: col(1), B: col(2) };
};

describe('processor selection', () => {
  it('defaults to NovaLCT, keeps a stored choice, rejects unknown', () => {
    expect(DEFAULT_WALL.processor).toBe('novastar-lct');
    expect(sanitizeWall({ processor: 'brompton' }).processor).toBe('brompton');
    expect(sanitizeWall({ processor: 'foo' as never }).processor).toBe('novastar-lct');
  });
});

describe('Brompton colour-temperature suggestion (mired)', () => {
  it('moves the setting by the measured error in mired', () => {
    // slider 6504 K, measured 6000 K, target 6504 K → 10⁶/(153.75 + 153.75 − 166.67) ≈ 7100 K
    expect(kelvinSuggestion(6504, 6000, 6504)).toBeCloseTo(1e6 / (2e6 / 6504 - 1e6 / 6000), 6);
    expect(kelvinSuggestion(6504, 6504, 6504)).toBeCloseTo(6504, 9);
  });
  it('hints per processor name the documented menu paths', () => {
    const c = whiteCorrection(cab([1, 0.9, 1.05], 500).W, D65, { xy: [g.r, g.g, g.b] });
    const lct = whitePointHints('novastar-lct', c).flatMap((x) => x.lines).join(' ');
    expect(lct).toMatch(/Brightness Component/);
    expect(lct).toMatch(/Precise Adjustment/);
    const vx = whitePointHints('novastar-vx', c).flatMap((x) => x.lines).join(' ');
    expect(vx).toMatch(/Screen Configuration › More Settings › LED Screen Color › Temperature › Custom/);
    const br = whitePointHints('brompton', c, 6504).flatMap((x) => x.lines).join(' ');
    expect(br).toMatch(/nächster Versuch \d+ K/);
    expect(br).toMatch(/DynaCal/);
    expect(br).toMatch(/OSCA Red\/Green\/Blue Gain/);
    expect(cabinetMatchHint('novastar-lct')).toMatch(/Manage Coefficients/);
    expect(cabinetMatchHint('brompton')).toMatch(/OSCA/);
  });
  it('without primaries only Δ, no channel values', () => {
    const c = whiteCorrection(cab([1, 0.9, 1.05], 500).W, D65, {});
    expect(whitePointHints('novastar-vx', c)[0].lines.join(' ')).toMatch(/nur Δ/);
  });
});

describe('cabinet matching to the reference', () => {
  it('equalises chromaticity and luminance; darkest cabinet sets the level', () => {
    const res: MeterResults = new Map([
      ['C1-R1', cab([1, 1, 1], 500)],
      ['C2-R1', cab([1, 0.9, 1.05], 500)],
      ['C3-R1', cab([1, 1, 1], 450)], // 10 % darker
    ]);
    const m = cabinetMatch(res, 'C1-R1');
    // all gains ≤ 100 %, darkest needs 100 %
    const all = m.rows.flatMap((r) => r.gains!);
    expect(Math.max(...all)).toBeCloseTo(100, 6);
    expect(m.scale).toBeCloseTo(0.9, 9);
    // apply: every cabinet ends at the same XYZ
    const after = m.rows.map((r) => {
      const bal = r.point === 'C2-R1' ? [1, 0.9, 1.05] : [1, 1, 1], L = r.point === 'C3-R1' ? 450 : 500;
      return mul3(M, bal.map((b, i) => (b * r.gains![i]) / 100)).map((v) => v * L);
    });
    for (const a of after) a.forEach((v, i) => expect(v).toBeCloseTo(after[0][i], 6));
    expect(xyOf(after[0])[0]).toBeCloseTo(D65[0], 9);
  });
  it('uses entered primaries when a cabinet has no measured R/G/B', () => {
    const c2 = cab([1, 0.9, 1.05], 500);
    const res: MeterResults = new Map([['A', { W: cab([1, 1, 1], 500).W }], ['B', { W: c2.W }]]);
    expect(cabinetMatch(res, 'A').rows.every((r) => r.gains === null)).toBe(true);
    const m = cabinetMatch(res, 'A', [g.r, g.g, g.b]);
    const b = m.rows.find((r) => r.point === 'B')!.gains!;
    expect(b[1] / b[0]).toBeCloseTo(1 / 0.9, 9);
    expect(b[2] / b[0]).toBeCloseTo(1 / 1.05, 9);
  });
});
