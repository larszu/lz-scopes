import { describe, expect, it } from 'vitest';
import { homography, invertHomography, project, type Frame, type Pt } from '../src/led/analysis';
import { CHARTS, CHART_SPECS, deriveChart, gridFields } from '../src/colormatch/charts';
import { detectChart } from '../src/colormatch/detect';
import { fieldDeltas, measureChart, summary } from '../src/colormatch/measure';
import { measureLatency, residual, runMatch, solve, type MatchEvent } from '../src/colormatch/engine';
import { SIM_PARAMS, SimCamera, render, sceneOf, virtualClock } from '../src/colormatch/sim';
import { bmdRestBody, BMD_PARAMS } from '../src/colormatch/adapters';
import type { Space } from '../src/deltae';
import type { Rgb } from '../src/match/core';

const SP: Space = { transfer: 'sdr', gamut: '709', hlgLw: 1000 };
const classic = CHARTS.classic24;
const scene = sceneOf(classic);
const target = render(scene, {});

describe('homography', () => {
  it('maps the four corners exactly and keeps straight lines straight', () => {
    const to: Pt[] = [[60, 40], [330, 70], [320, 240], [50, 200]];
    const H = homography([[0, 0], [6, 0], [6, 4], [0, 4]], to);
    [[0, 0], [6, 0], [6, 4], [0, 4]].forEach(([x, y], i) => {
      const [u, v] = project(H, x, y);
      expect(u).toBeCloseTo(to[i][0], 6); expect(v).toBeCloseTo(to[i][1], 6);
    });
    const a = project(H, 0, 2), b = project(H, 3, 2), c = project(H, 6, 2);
    expect((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).toBeCloseTo(0, 6);
  });
});

/** Chart in perspective on a grey frame, with a few hot pixels. */
function chartFrame(colours: Rgb[], corners: Pt[], chart = classic): Frame {
  const width = 420, height = 300, rgb = new Float32Array(width * height * 3).fill(0.6);
  const Hinv = invertHomography(homography([[0, 0], [chart.width, 0], [chart.width, chart.height], [0, chart.height]], corners));
  let seed = 7;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [u, v] = project(Hinv, x + 0.5, y + 0.5);
    const i = chart.patches.findIndex((p) => u >= p.x && u < p.x + p.w && v >= p.y && v < p.y + p.h);
    if (u < -0.03 || v < -0.03 || u > 1.03 || v > 1.03) continue;
    const o0 = (y * width + x) * 3;
    if (i < 0) { rgb[o0] = rgb[o0 + 1] = rgb[o0 + 2] = 0.03; continue; } // black chart frame
    seed = (seed * 16807) % 2147483647;
    const o = (y * width + x) * 3;
    for (let k = 0; k < 3; k++) rgb[o + k] = seed % 97 === 0 ? 1 : colours[i][k];
  }
  return { width, height, rgb };
}

describe('field evaluation', () => {
  const corners: Pt[] = [[40, 30], [380, 60], [370, 270], [30, 240]];
  it('reads every Classic field through the homography, robust against hot pixels', () => {
    const got = measureChart(chartFrame(target, corners), corners, classic);
    got.forEach((p, i) => p!.forEach((v, k) => expect(v).toBeCloseTo(target[i][k], 5)));
  });
  it('reads the ChromaDuMonde layout too', () => {
    const cdm = CHARTS.cdm, cols = sceneOf(cdm).map((l) => l.map((v) => v ** 0.45) as Rgb);
    const got = measureChart(chartFrame(cols, corners, cdm), corners, cdm);
    expect(got).toHaveLength(30);
    got.forEach((p, i) => expect(p![1]).toBeCloseTo(cols[i][1], 5));
  });
  it('ΔE per field is 0 against itself and grows with a colour error', () => {
    expect(summary(fieldDeltas(target, target, SP)).max).toBeCloseTo(0, 9);
    const off = render(scene, { 'matrix.rg': 30 });
    const de = fieldDeltas(off, target, SP);
    expect(summary(de).mean).toBeGreaterThan(1);
    expect(de[classic.white]!).toBeLessThan(0.1); // matrix keeps neutrals (the white field is nearly neutral)
  });
});

describe('ΔE2000', () => {
  it('matches Sharma, Wu & Dalal pair 1', async () => {
    const { deltaE2000 } = await import('../src/color');
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
  });
});

describe('control loop with a simulated camera', () => {
  const bias = { blackR: 6, blackB: -5, whiteR: 14, whiteB: -11, pedestal: 4, gamma: 18, 'matrix.rg': 20, 'matrix.bg': -15, 'axis1.hue': 6, 'axis4.sat': -10 };

  it('measures the latency', async () => {
    const clock = virtualClock(), cam = new SimCamera(scene, {}, clock, 180);
    const ms = await measureLatency(cam, async () => cam.patches(), clock, { poll: 10 });
    expect(ms).toBeGreaterThanOrEqual(180);
    expect(ms).toBeLessThanOrEqual(200);
  });

  it('brings a mismatched camera onto the reference and waits for the latency', async () => {
    const clock = virtualClock(), cam = new SimCamera(scene, bias, clock, 120);
    const events: MatchEvent[] = [];
    const r = await runMatch({ camera: cam, measure: async () => cam.patches(), target, space: SP, chart: classic, clock, onEvent: (e) => events.push(e) });
    expect(r.aborted).toBe(false);
    expect(r.startDe).toBeGreaterThan(3);
    expect(r.endDe).toBeLessThan(0.6);
    expect(r.latencyMs).toBeGreaterThanOrEqual(120);
    expect(events.filter((e) => e.kind === 'stage').map((e) => (e as { stage: string }).stage)).toEqual(['black', 'white', 'pedestal', 'gamma', 'matrix', 'multiaxis']);
    // with the measured wait, every reading saw the camera settled: the final picture is the written state
    await clock.sleep(1000);
    expect(summary(fieldDeltas(cam.patches(), target, SP)).mean).toBeCloseTo(r.endDe, 1);
  });

  it('skips steps the camera cannot do', async () => {
    const clock = virtualClock(), few = SIM_PARAMS.filter((p) => p.stage === 'white' || p.stage === 'gamma');
    const cam = new SimCamera(scene, { whiteR: 15, gamma: 10 }, clock, 0, few);
    const events: MatchEvent[] = [];
    const r = await runMatch({ camera: cam, measure: async () => cam.patches(), target, space: SP, chart: classic, clock, latencyMs: 0, onEvent: (e) => events.push(e) });
    expect(events.filter((e) => e.kind === 'skip').length).toBe(4);
    expect(r.endDe).toBeLessThan(r.startDe / 3);
  });

  it('cancels and keeps the values reached so far', async () => {
    const clock = virtualClock(), cam = new SimCamera(scene, bias, clock, 0), ac = new AbortController();
    const r = await runMatch({ camera: cam, measure: async () => cam.patches(), target, space: SP, chart: classic, clock, latencyMs: 0, signal: ac.signal, onEvent: (e) => { if (e.kind === 'stage' && e.stage === 'gamma') ac.abort(); } });
    expect(r.aborted).toBe(true);
    expect(r.after.whiteR).not.toBe(0);
  });

  it('works without knowing the parameter scale (guide mode: unknown units)', async () => {
    const clock = virtualClock();
    const scaled = SIM_PARAMS.filter((p) => p.stage !== 'multiaxis').map((p) => ({ ...p, min: p.min * 3, max: p.max * 3 }));
    const inner = new SimCamera(scene, bias, clock, 0, scaled);
    const cam = { params: scaled, read: inner.read.bind(inner), write: (v: Record<string, number>) => inner.write(Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x / 3]))) };
    const r = await runMatch({ camera: cam, measure: async () => inner.patches(), target, space: SP, chart: classic, clock, manual: true });
    expect(r.endDe).toBeLessThan(r.startDe / 2);
  });

  it('residual of the grey steps is zero on a match', () => {
    for (const s of ['black', 'white', 'pedestal', 'gamma', 'matrix'] as const) expect(residual(s, target, target, classic, SP).every((v) => Math.abs(v) < 1e-12)).toBe(true);
  });

  it('solves a linear system', () => {
    expect(solve([[2, 1], [1, 3]], [3, 5])!.map((v) => +v.toFixed(9))).toEqual([0.8, 1.4]);
    expect(solve([[1, 2], [2, 4]], [1, 2])).toBeNull();
  });
});

describe('Blackmagic camera REST mapping', () => {
  it('groups values per colour-correction endpoint', () => {
    const body = bmdRestBody({ 'lift.red': 0.01, 'lift.luma': -0.02, 'gain.blue': 1.1, 'gamma.luma': 0.2 });
    expect(body).toEqual({ lift: { red: 0.01, luma: -0.02 }, gain: { blue: 1.1 }, gamma: { luma: 0.2 } });
  });
  it('declares only documented parameters within their ranges', () => {
    for (const p of BMD_PARAMS) {
      const [ep] = p.id.split('.');
      expect(['lift', 'gamma', 'gain', 'color']).toContain(ep);
    }
    expect(BMD_PARAMS.find((p) => p.id === 'gain.red')!.min).toBeGreaterThanOrEqual(0);
  });
});

describe('data-driven charts and detection', () => {
  const corners: Pt[] = [[60, 50], [360, 70], [350, 260], [50, 240]];
  it('finds the chart corners in the picture (classic, no model)', () => {
    const d = detectChart(chartFrame(target, corners), { aspect: classic.aspect })!;
    expect(d).not.toBeNull();
    // the frame reaches 3 % beyond the field grid, so allow a few pixels
    d.corners.forEach((p, i) => { expect(Math.abs(p[0] - corners[i][0])).toBeLessThan(14); expect(Math.abs(p[1] - corners[i][1])).toBeLessThan(14); });
  });
  it('finds nothing in a flat picture', () => {
    expect(detectChart({ width: 200, height: 100, rgb: new Float32Array(200 * 100 * 3).fill(0.4) })).toBeNull();
  });
  it('a grey-scale chart from a description: neutrals sorted by reflectance, loop skips colour steps', async () => {
    const Ys = [0.89, 0.6, 0.4, 0.25, 0.15, 0.09, 0.05, 0.02];
    const grey = deriveChart({ id: 'g', name: 'grey', aspect: 4, source: 'test', fields: gridFields(8, 1, Ys.map((_, i) => `s${i}`), (i) => (i === 0 ? 'white' : i === 7 ? 'black' : 'gray'), 0.1, (i) => ({ Y: Ys[i] })) });
    expect(grey.neutrals).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    expect(grey.chromatic).toEqual([]);
    const ref = grey.reference!(SP);
    expect(ref[0][0]).toBeCloseTo(ref[0][1], 3); // neutral
    const sc = sceneOf(grey), clock = virtualClock();
    const cam = new SimCamera(sc, { gamma: 20, pedestal: 5, whiteR: 10 }, clock, 0);
    const events: MatchEvent[] = [];
    const r = await runMatch({ camera: cam, measure: async () => cam.patches(), target: render(sc, {}), space: SP, chart: grey, clock, latencyMs: 0, onEvent: (e) => events.push(e) });
    expect(events.filter((e) => e.kind === 'skip').map((e) => (e as { stage: string }).stage)).toEqual(['matrix', 'multiaxis']);
    expect(r.endDe).toBeLessThan(0.5);
  });
  it('the TE156 entry is a template without values', () => {
    const te = CHART_SPECS.find((c) => c.id === 'te156')!;
    expect(te.fields.every((f) => f.value === undefined)).toBe(true);
    expect(CHARTS.te156.reference).toBeNull();
  });
  it('Classic reference from the description equals the BabelColor reference', async () => {
    const { chartReference } = await import('../src/match/chartRef');
    const a = CHARTS.classic24.reference!(SP), b = chartReference(SP).patches;
    a.forEach((p, i) => p.forEach((v, k) => expect(v).toBeCloseTo(b[i]![k], 9)));
  });
});
