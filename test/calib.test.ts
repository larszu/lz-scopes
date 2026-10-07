// Display calibration (#9): all with synthetic readings – no meter was available.
import { describe, expect, it } from 'vitest';
import { GAMUTS, D65, mul3, rgbToXyzMatrix } from '../src/color';
import { bt1886, cctDuv, patchDelta, percentile, planckUv, stats, targetXyz, type Target, type XYZ } from '../src/calib/colorimetry';
import { TEST_SETS, testSet, hdrPqSet, uniformityCells } from '../src/calib/testsets';
import { verify, defaultTarget } from '../src/calib/verify';
import { evaluateUniformity } from '../src/calib/uniformity';
import { buildCube, fitModel, modelError, predict } from '../src/calib/lut3d';
import { UntetheredDetector } from '../src/calib/untethered';
import { verifyCsv, verifyHtml, uniformityHtml } from '../src/calib/report';
import { PatchSequencer, patchRect, quantize, type PatchFrame } from '../src/patchSequencer';
import { parseCube, apply3D } from '../src/lut';
import { t } from '../src/i18n';
// @ts-expect-error plain JS module
import { parseSpotread, parseInstruments, spotreadArgs, writeCorrection, spotreadCandidates } from '../server/meter.mjs';

const uvToXy = ([u, v]: [number, number]): [number, number] => { const d = 2 * u - 8 * v + 4; return [(3 * u) / d, (2 * v) / d]; };

describe('colorimetry', () => {
  it('BT.1886 Annex 1: pure 2.4 power with Lb = 0, hits Lb and Lw at the ends', () => {
    expect(bt1886(0.5, 100, 0)).toBeCloseTo(100 * 0.5 ** 2.4, 9);
    expect(bt1886(0, 120, 0.05)).toBeCloseTo(0.05, 9);
    expect(bt1886(1, 120, 0.05)).toBeCloseTo(120, 9);
  });
  it('CCT/Duv: D65 ≈ 6504 K, Duv ≈ +0.0032 (Ohno 2014); illuminant A ≈ 2856 K; locus points exact', () => {
    const d65 = cctDuv(D65);
    expect(Math.abs(d65.cct - 6504)).toBeLessThan(15);
    expect(d65.duv).toBeCloseTo(0.0032, 3);
    const a = cctDuv([0.44757, 0.40745]);
    expect(Math.abs(a.cct - 2856)).toBeLessThan(5);
    expect(Math.abs(a.duv)).toBeLessThan(0.0005);
    for (const T of [2000, 3000, 5000, 9000]) {
      const r = cctDuv(uvToXy(planckUv(T)));
      expect(Math.abs(r.cct - T)).toBeLessThan(0.5);
      expect(Math.abs(r.duv)).toBeLessThan(1e-7);
    }
  });
  it('percentile interpolates like numpy (type 7)', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 95)).toBeCloseTo(3.85, 9);
    expect(stats([3, 1, 2]).mean).toBe(2);
  });
  it('identical XYZ gives ΔE00 = ΔITP = 0', () => {
    const d = patchDelta([40, 42, 45], [40, 42, 45], [95, 100, 109]);
    expect(d.dE00).toBe(0); expect(d.dITP).toBe(0);
  });
});

describe('test sets', () => {
  it('have the announced sizes and only 8-bit codes', () => {
    const size = (id: string) => testSet(id).patches.length;
    expect(size('grey21')).toBe(21); expect(size('video47')).toBe(47); expect(size('video81')).toBe(81);
    for (const s of [...TEST_SETS, hdrPqSet(4000)]) for (const p of s.patches) for (const v of p.rgb) expect(Math.abs(v * 255 - Math.round(v * 255))).toBeLessThan(1e-9);
  });
  it('HDR PQ set: greys stop at the peak, 203 cd/m² grey ≈ 58 % PQ', () => {
    const s = hdrPqSet(1000);
    expect(s.patches.filter((p) => p.kind === 'grey').every((p) => p.rgb[0] <= 0.753)).toBe(true);
    const g203 = s.patches.find((p) => p.label === t('calib.patch.grey', { v: '203 cd/m²' }))!;
    expect(g203.rgb[0]).toBeCloseTo(0.58, 2);
  });
  it('uniformity cells tile the output', () => {
    const c = uniformityCells(5);
    expect(c).toHaveLength(25);
    expect(c[12].rect.x).toBeCloseTo(0.4); expect(c[24].rect.x + c[24].rect.w).toBeCloseTo(1);
  });
});

// Synthetic display: primaries + per-channel power curve + black, optional non-additive ABL.
function display(gamut: keyof typeof GAMUTS, gamma: number, lw: number, black: number, abl = 0) {
  const m = rgbToXyzMatrix(GAMUTS[gamut]);
  return (rgb: number[]): XYZ => {
    const lin = rgb.map((v) => Math.pow(v, gamma));
    const f = 1 - abl * (lin[0] + lin[1] + lin[2]) / 3; // brighter content → dimmer (ABL)
    return mul3(m, lin).map((v, i) => v * lw * f + black * [0.9505, 1, 1.089][i]) as XYZ;
  };
}

describe('verification report', () => {
  const set = testSet('video47');
  it('perfect Rec.709/BT.1886 display: ΔE00 ≈ 0, white at D65', () => {
    const target = defaultTarget(false);
    const readings = set.patches.map((p) => targetXyz(p.rgb, target, 120, 0.06));
    const r = verify(set, readings, target);
    expect(r.lw).toBeCloseTo(120, 6); expect(r.lb).toBeCloseTo(0.06, 6);
    expect(r.dE00.max).toBeLessThan(1e-6); expect(r.dITP.max).toBeLessThan(1e-6);
    expect(r.grades.mean).toBe('good');
    expect(Math.abs(r.white!.cct - 6504)).toBeLessThan(15);
    expect(r.contrast).toBeCloseTo(2000, 3);
    // effective gamma of a BT.1886 curve with a small black is close to (not exactly) 2.4
    const g50 = r.grey.find((p) => Math.abs(p.signal - 0.502) < 0.01)!;
    expect(g50.gamma!).toBeGreaterThan(2.2); expect(g50.gamma!).toBeLessThan(2.45);
  });
  it('a gamma-2.0 display fails against BT.1886, and CSV/HTML contain every patch', () => {
    const target = defaultTarget(false);
    const d = display('709', 2.0, 100, 0.01);
    const r = verify(set, set.patches.map((p) => d(p.rgb)), target);
    expect(r.dE00.mean).toBeGreaterThan(1.5);
    expect(r.grades.mean).toBe('fail');
    expect(r.white!.dE00).toBeLessThan(0.01);
    expect(verifyCsv(r).trim().split('\n')).toHaveLength(48);
    expect(verifyHtml(r)).toContain(t('calib.html.greyCurve'));
  });
  it('missing readings are ignored in the statistics', () => {
    const target = defaultTarget(false);
    const readings = set.patches.map((p, i) => (i % 2 ? targetXyz(p.rgb, target, 100, 0) : null));
    readings[set.patches.findIndex((p) => p.rgb.every((v) => v === 1))] = targetXyz([1, 1, 1], target, 100, 0);
    expect(verify(set, readings, target).dE00.n).toBe(readings.filter(Boolean).length);
  });
});

describe('3D LUT from measurements', () => {
  const set = testSet('video81');
  const target: Target = defaultTarget(false);
  it('P3 display, γ 2.2: model fits exactly, LUT reproduces the Rec.709/BT.1886 target', () => {
    const d = display('p3', 2.2, 150, 0.08);
    const readings = set.patches.map((p) => d(p.rgb));
    const model = fitModel(set, readings);
    if (typeof model === 'string') throw new Error(model);
    expect(modelError(model, set, readings).max).toBeLessThan(0.6); // piecewise-linear curves between grey steps
    const c = buildCube(set, readings, target, 33);
    if (typeof c === 'string') throw new Error(c);
    const lut = parseCube(c.text, 'x.cube').cube!;
    expect(lut.size).toBe(33);
    // red fastest: second data row is (1/32, 0, 0)
    const rows = c.text.split('\n').filter((l) => /^[\d.]+ [\d.]+ [\d.]+$/.test(l));
    expect(rows).toHaveLength(33 ** 3);
    const lw = 150 * c.whiteScale + 0.08 * (1 - c.whiteScale), lb = d([0, 0, 0])[1];
    const white = targetXyz([1, 1, 1], target, lw, lb);
    for (const src of [[0.5, 0.5, 0.5], [0.75, 0.25, 0.25], [0.2, 0.6, 0.4], [1, 1, 1]]) {
      const shown = d(apply3D(lut, src));
      const want = targetXyz(src, target, lw, lb);
      expect(patchDelta(shown, want, white).dE00).toBeLessThan(1);
    }
  });
  it('refuses a non-additive (ABL) display and HDR targets', () => {
    const d = display('709', 2.4, 150, 0.05, 0.5);
    expect(typeof buildCube(set, set.patches.map((p) => d(p.rgb)), target, 33)).toBe('string');
    expect(buildCube(set, set.patches.map((p) => d(p.rgb)), defaultTarget(true), 33)).toMatch(/HDR/);
  });
  it('needs black and the primaries', () => {
    const g = testSet('grey21');
    expect(fitModel(g, g.patches.map(() => [1, 1, 1] as XYZ))).toBe(t('calib.lut.missing'));
  });
  it('predict() reproduces the fitted display at a grey step', () => {
    const d = display('709', 2.4, 100, 0.1);
    const readings = set.patches.map((p) => d(p.rgb));
    const m = fitModel(set, readings);
    if (typeof m === 'string') throw new Error(m);
    const p = set.patches[10].rgb;
    predict(m, p).forEach((v, i) => expect(v).toBeCloseTo(d(p)[i], 6));
  });
});

describe('uniformity', () => {
  const levels = [1, 0.75, 0.5, 0.25];
  const cell = (k: number, tint = 0): XYZ[] => levels.map((l) => { const y = 120 * k * l ** 2.2; return [0.9505 * y * (1 + tint), y, 1.089 * y]; });
  it('uniform panel: ΔE 0, T 0, grade gut; a dim corner with a tint shows up', () => {
    const flat = evaluateUniformity(5, Array.from({ length: 25 }, () => cell(1)));
    expect(flat.maxDE00).toBeLessThan(1e-9); expect(flat.maxT).toBeLessThan(1e-9); expect(flat.grade).toBe('good');
    const readings = Array.from({ length: 25 }, (_, i) => (i === 0 ? cell(0.8, 0.05) : cell(1)));
    const u = evaluateUniformity(5, readings);
    expect(u.cells[0].lumDev[0]).toBeCloseTo(-20, 6);
    expect(u.cells[0].dE00[0]).toBeGreaterThan(4);
    expect(u.grade).toBe('fail');
    expect(u.cells[12].dE00.every((d) => d === 0)).toBe(true);
    expect(uniformityHtml(u)).toContain('5×5');
  });
  it('contrast deviation T = |R/R_ref − 1| with R = Y50/Y100', () => {
    const readings = Array.from({ length: 9 }, () => cell(1));
    readings[0] = readings[0].map((x, i) => (i === 2 ? x.map((v) => v * 1.2) : x)) as XYZ[]; // 50 % step 20 % brighter
    const u = evaluateUniformity(3, readings);
    expect(u.cells[0].contrastT).toBeCloseTo(0.2, 9);
    expect(u.contrastOk).toBe(false);
    expect(u.warnings.join()).toMatch(/5×5/);
  });
});

describe('untethered detection', () => {
  it('accepts a new patch on the second agreeing reading, ignores noise', () => {
    const d = new UntetheredDetector();
    const w: XYZ = [95, 100, 108], g: XYZ = [20, 21, 22.7];
    expect(d.push(w)).toEqual(w); // first reading = first patch
    expect(d.push([95.1, 100.05, 108.1])).toBeNull(); // noise
    expect(d.push(g)).toBeNull(); // changed, not yet confirmed
    expect(d.push([20.02, 21.01, 22.71])).not.toBeNull(); // confirmed
    expect(d.push([20.03, 21, 22.7])).toBeNull(); // same patch
  });
});

describe('patch sequencer', () => {
  it('shows every frame, measures after the settle time, inserts full fields, ends with null', async () => {
    let t = 0;
    const shown: (PatchFrame | null)[] = [];
    const frames: PatchFrame[] = [0, 0.5, 1].map((v) => ({ rgb: [v, v, v] }));
    const seq = new PatchSequencer<number>(frames, async (f) => f.rgb[0], { settleMs: 1000, insertion: { everyS: 1.5, durationS: 2, level: 0.15 } },
      (f) => shown.push(f), () => t, async (ms) => { t += ms; });
    const out = await seq.run();
    expect(out).toEqual([0, 0.5, 1]);
    expect(shown.filter((f) => f?.window === 1)).toHaveLength(1);
    expect(shown[shown.length - 1]).toBeNull();
  });
  it('stop() ends the run', async () => {
    const seq: PatchSequencer<number> = new PatchSequencer<number>([{ rgb: [0, 0, 0] }, { rgb: [1, 1, 1] }], async () => { seq.stop(); return 1; }, {}, () => {}, () => 0, async () => {});
    expect((await seq.run()).length).toBe(1);
  });
  it('patch rectangle: 25 % area is half width and height, centred; quantize to 8 bit', () => {
    expect(patchRect(1920, 1080, { rgb: [1, 1, 1], window: 0.25 })).toEqual({ x: 480, y: 270, w: 960, h: 540 });
    expect(quantize([0.5, 0.1, 1])).toEqual([128 / 255, 26 / 255, 1]);
  });
});

describe('spotread bridge', () => {
  it('parses readings, failures and the prompt (format as parsed by DisplayCAL)', () => {
    expect(parseSpotread(' Result is XYZ: 95.123456 100.000000 108.765432, D50 Lab: 100.000000 0.000000 0.000000')).toEqual([{ type: 'reading', xyz: [95.123456, 100, 108.765432] }]);
    expect(parseSpotread('Spot read failed due to misread')[0].type).toBe('error');
    expect(parseSpotread('Place instrument on spot to be read, and hit [A-Z,a-z] or [SPACE] key to take a reading:')[0].type).toBe('ready');
    expect(parseInstruments(" -c listno  Set communication port from the following list (default 1)\n    1 = 'usb:/bus2/dev4/ (i1 DisplayPro, ColorMunki Display)'\n")).toEqual([{ port: 1, name: 'usb:/bus2/dev4/ (i1 DisplayPro, ColorMunki Display)' }]);
  });
  it('builds only validated arguments', () => {
    expect(spotreadArgs({ port: 2, displayType: 'l', skipCal: true })).toEqual(['-e', '-c', '2', '-y', 'l', '-N']);
    expect(() => spotreadArgs({ port: '1; rm -rf' })).toThrow();
    expect(() => spotreadArgs({ displayType: '-X /etc/passwd' })).toThrow();
  });
  it('accepts only CGATS CCMX/CCSS corrections', () => {
    expect(() => writeCorrection({ name: 'a.txt', text: 'CCMX' })).toThrow();
    expect(() => writeCorrection({ name: 'a.ccmx', text: 'hello' })).toThrow();
    const w = writeCorrection({ name: 'wled.ccss', text: 'CCSS\n\nDESCRIPTOR "x"\n' });
    expect(w.file).toMatch(/korrektur\.ccss$/);
  });
  it('looks for spotread.exe on Windows and in the PATH', () => {
    // path.join of the test machine: backslashes when the suite runs on Windows
    expect(spotreadCandidates({ PATH: '/x/bin' }, 'linux')[0].replace(/\\/g, '/')).toBe('/x/bin/spotread');
    expect(spotreadCandidates({ Path: 'C:\\Argyll\\bin' }, 'win32').some((p: string) => p.endsWith('spotread.exe'))).toBe(true);
  });
});

describe('ICtCp sanity', () => {
  it('ΔITP of a 1 % luminance change at 100 cd/m² is small but non-zero', () => {
    const w = targetXyz([1, 1, 1], { transfer: 'g24', gamut: '709', white: D65 }, 100, 0);
    const d = patchDelta(w.map((v) => v * 1.01), w, w);
    expect(d.dITP).toBeGreaterThan(0.5); expect(d.dITP).toBeLessThan(5);
  });
});
