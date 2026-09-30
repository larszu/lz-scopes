import { describe, expect, it } from 'vitest';
import { D65, GAMUTS, mul3, rgbToXyzMatrix, xyToUv, type XY } from '../src/color';
import { cctDuv } from '../src/calib/colorimetry';
import { buildPlan, evaluatePoints, meterCsv, planckXy, summarize, whiteCorrection, xyOf, type MeterResults, type XYZ } from '../src/led/oppleCheck';
import { sanitizeWall } from '../src/led/wall';
import {
  FlickerAssembler, MessageAssembler, buildFlickerChunk, encapsulate, flickerMetrics, flickerRequestBody, flickerSampleRate, opcodeOf, parseFlickerChunk,
} from '../src/opple/protocol';

const wall = sanitizeWall({ name: 'T', cabW: 100, cabH: 100, cols: 3, rows: 2, offX: 50 });
const xyY = ([x, y]: XY, Y: number): XYZ => [(x * Y) / y, Y, ((1 - x - y) * Y) / y];

describe('measurement plan', () => {
  it('one rect per cabinet and colour, grouped by cabinet', () => {
    const p = buildPlan(wall, { points: 'all', white: 1, gray: 0.5, primaries: true });
    expect(p).toHaveLength(6 * 5);
    expect(p.slice(0, 5).map((s) => s.colour)).toEqual(['W', 'L', 'R', 'G', 'B']);
    expect(p[0].point).toBe('C1-R1');
    // picture 350×200, first cabinet at x = 50
    expect(p[0].frame.rect).toEqual({ x: 50 / 350, y: 0, w: 100 / 350, h: 0.5 });
    expect(p[3].frame.rgb).toEqual([0, 1, 0]);
  });
  it('selection and full field', () => {
    expect(buildPlan(wall, { points: ['c2-r2', 'C3-R1'], white: 1, gray: 0, primaries: false }).map((s) => s.point)).toEqual(['C3-R1', 'C2-R2']);
    const f = buildPlan(wall, { points: 'full', white: 0.75, gray: 0, primaries: false });
    expect(f).toHaveLength(1);
    expect(f[0].frame.window).toBe(1);
  });
});

describe('relative evaluation', () => {
  it('luminance and u′v′ against the reference cabinet', () => {
    const res: MeterResults = new Map([
      ['C1-R1', { W: xyY(D65, 100) }],
      ['C2-R1', { W: xyY(D65, 110) }],
      ['C3-R1', { W: xyY([0.3177, 0.329], 100) }],
    ]);
    const s = evaluatePoints(res, 'C1-R1');
    const by = (p: string) => s.find((x) => x.point === p)!;
    expect(by('C2-R1').dY).toBeCloseTo(10, 9);
    expect(by('C2-R1').duv).toBeCloseTo(0, 9);
    const [u0, v0] = xyToUv(D65), [u1, v1] = xyToUv([0.3177, 0.329]);
    expect(by('C3-R1').duv).toBeCloseTo(Math.hypot(u1 - u0, v1 - v0), 12);
    expect(by('C3-R1').dx).toBeCloseTo(0.005, 12);
    expect(by('C1-R1').cct).toBeGreaterThan(6450); // D65 ≈ 6504 K
    expect(by('C1-R1').cct).toBeLessThan(6560);
    const sum = summarize(s);
    expect(sum.uniformity).toBeCloseTo((100 / 110) * 100, 6);
  });
});

describe('white point correction', () => {
  // A wall with BT.709 primaries whose channels are out of balance by (1, 0.9, 1.05).
  const M = rgbToXyzMatrix(GAMUTS['709']); // white = D65 at Y = 1 for (1,1,1)
  const scale = 500, bal = [1, 0.9, 1.05];
  const col = (i: number): XYZ => [M[i] * scale * bal[i], M[3 + i] * scale * bal[i], M[6 + i] * scale * bal[i]];
  const W = mul3(M, bal).map((v) => v * scale) as XYZ;

  it('gains undo the imbalance (measured primaries)', () => {
    const c = whiteCorrection(W, D65, { measured: [col(0), col(1), col(2)] });
    const expected = [1 / 1, 1 / 0.9, 1 / 1.05].map((v) => (v / (1 / 0.9)) * 100);
    c.gains!.forEach((g, i) => expect(g).toBeCloseTo(expected[i], 6));
    expect(c.additivity).toBeCloseTo(0, 9);
    // applying the gains lands on D65
    const after = mul3(M, bal.map((b, i) => b * c.gains![i] / 100)).map((v) => v * scale);
    const xy = xyOf(after);
    expect(xy[0]).toBeCloseTo(D65[0], 9); expect(xy[1]).toBeCloseTo(D65[1], 9);
    expect(c.luminanceAfter).toBeCloseTo((after[1] / W[1]) * 100, 6);
    expect(c.duv).toBeGreaterThan(0.001);
  });
  it('same gains from primary chromaticities plus the measured white', () => {
    const g = GAMUTS['709'];
    const c = whiteCorrection(W, D65, { xy: [g.r, g.g, g.b] });
    const expected = [1 / 1, 1 / 0.9, 1 / 1.05].map((v) => (v / (1 / 0.9)) * 100);
    c.gains!.forEach((x, i) => expect(x).toBeCloseTo(expected[i], 6));
    expect(c.primariesSource).toBe('eingegeben');
  });
  it('warns when R+G+B ≠ W and without primaries only shows Δ', () => {
    const c = whiteCorrection(W, D65, { measured: [col(0), col(1), col(2).map((v) => v * 1.3) as XYZ] });
    expect(c.additivity).toBeGreaterThan(5);
    expect(c.warnings.join(' ')).toMatch(/nicht additiv/);
    const d = whiteCorrection(W, D65, {});
    expect(d.gains).toBeNull();
    expect(d.duv).toBeGreaterThan(0);
  });
  it('Planckian target: 6500 K lies on the locus', () => {
    const r = cctDuv(planckXy(6500));
    expect(r.cct).toBeCloseTo(6500, -1);
    expect(Math.abs(r.duv)).toBeLessThan(1e-6);
  });
  it('CSV report contains points, delta and gains', () => {
    const res: MeterResults = new Map([['C1-R1', { W, R: col(0), G: col(1), B: col(2) }], ['C2-R1', { W: W.map((v) => v * 0.9) as XYZ }]]);
    const s = evaluatePoints(res, 'C1-R1');
    const csv = meterCsv(wall, res, 'C1-R1', s, whiteCorrection(W, D65, { measured: [col(0), col(1), col(2)] }), '', '5 cm');
    expect(csv).toMatch(/^C2-R1,.*,-10\.00,/m);
    expect(csv).toMatch(/^gains_prozent_rgb,90\.0,100\.0,85\.7/m);
  });
});

describe('flicker (LM4 format after opple-bridge)', () => {
  const N = 1024, dc = 13.8447265625; // data_type 2 baseline
  // square wave, 50 % duty, bin 100 → 100·fs/1024 Hz
  const k = 100, lo = 100, hi = 1100;
  const wave = Array.from({ length: N }, (_, t) => Math.round((Math.floor((2 * k * t) / N) % 2 ? lo : hi)));
  const pages = [0, 1, 2, 3].map((p) => buildFlickerChunk(p, 2, wave.slice(p * 260, p * 260 + (p === 3 ? 244 : 260))));

  it('request body and sample rates', () => {
    expect([...flickerRequestBody(146)]).toEqual([0, 0, 146]);
    expect(flickerSampleRate(25)).toBeCloseTo(1048576 / 26, 6);
  });
  it('packs, fragments, reassembles and parses 4 pages', () => {
    const asm = new MessageAssembler(), fl = new FlickerAssembler();
    let out: number[] | null = null;
    for (const msg of pages) {
      let whole: Uint8Array | null = null;
      for (const f of encapsulate(msg)) whole = asm.feed(f) ?? whole;
      expect(opcodeOf(whole)).toBe(0x0a0b);
      out = fl.feed(parseFlickerChunk(whole)!) ?? out;
    }
    expect(out).toEqual(wave);
  });
  it('percent flicker, flicker index (ENERGY STAR Eq. 1, 2) and frequency', () => {
    const m = flickerMetrics(wave, 2, 25);
    const a = lo - dc, b = hi - dc, mean = (a + b) / 2;
    expect(m.percent).toBeCloseTo(((b - a) / (b + a)) * 100, 9);
    expect(m.index).toBeCloseTo(((b - mean) / 2) / mean, 9); // half the samples above the mean
    expect(m.frequency).toBeCloseTo((k * flickerSampleRate(25)) / N, 6);
    const flat = flickerMetrics(Array(N).fill(500), 2, 25);
    expect(flat.percent).toBe(0); expect(flat.index).toBe(0);
  });
});
