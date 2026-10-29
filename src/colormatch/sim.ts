// Simulated camera for the colour match: a picture model with every parameter the loop knows,
// a hidden mismatch (`bias`) and a latency on a virtual or real clock. Test bench and demo, not
// a model of any real camera.

import { GAMUTS, linearToSignal, mul3, rgbToXyzMatrix, inv3, bradford } from '../color';
import { REF_WHITE_XY } from '../match/chartRef';
import type { Rgb } from '../match/core';
import { valueXyz, type ChartDef } from './charts';
import type { Clock, MatchCamera, ParamDef, Values } from './engine';
import type { Patches } from './measure';

const AXES = 6;
export const SIM_PARAMS: ParamDef[] = [
  ...(['R', 'G', 'B'] as const).map((c): ParamDef => ({ id: `black${c}`, label: `Black ${c}`, stage: 'black', min: -50, max: 50, step: 1 })),
  ...(['R', 'G', 'B'] as const).map((c): ParamDef => ({ id: `white${c}`, label: `White ${c}`, stage: 'white', min: -50, max: 50, step: 1 })),
  { id: 'pedestal', label: 'Pedestal', stage: 'pedestal', min: -50, max: 50, step: 1 },
  { id: 'gamma', label: 'Gamma', stage: 'gamma', min: -50, max: 50, step: 1 },
  ...['rg', 'rb', 'gr', 'gb', 'br', 'bg'].map((k): ParamDef => ({ id: `matrix.${k}`, label: `Matrix ${k.toUpperCase()}`, stage: 'matrix', min: -50, max: 50, step: 1 })),
  ...Array.from({ length: AXES }, (_, i): ParamDef[] => [
    { id: `axis${i}.hue`, label: `Axis ${i + 1} hue`, stage: 'multiaxis', min: -30, max: 30, step: 1 },
    { id: `axis${i}.sat`, label: `Axis ${i + 1} sat`, stage: 'multiaxis', min: -30, max: 30, step: 1 },
  ]).flat(),
];

/** Scene light of the chart fields, linear Rec.709: the field values where the chart has them, else a spread. */
export function sceneOf(chart: ChartDef): number[][] {
  const g = GAMUTS['709'], toRgb = inv3(rgbToXyzMatrix(g)), adapt = bradford(REF_WHITE_XY, g.white);
  return chart.patches.map((f, i) => {
    if (f.value) return mul3(toRgb, mul3(adapt, valueXyz(f.value))).map((v) => Math.max(0, v));
    if (f.kind === 'black') return [0.02, 0.02, 0.02];
    if (f.kind === 'white') return [0.9, 0.9, 0.9];
    if (f.kind === 'gray') { const y = 0.9 * 0.7 ** (i % 12); return [y, y, y]; }
    const a = (i / 28) * Math.PI * 2;
    return [0.25 + 0.15 * Math.cos(a), 0.25 + 0.15 * Math.cos(a - 2.1), 0.25 + 0.15 * Math.cos(a + 2.1)];
  });
}

/** The picture model: linear scene → R′G′B′ signal (Rec.709) under parameter values `v`. */
export function render(scene: number[][], v: Values): Rgb[] {
  const g = (k: string) => v[k] ?? 0;
  return scene.map((lin0) => {
    const gain = ['R', 'G', 'B'].map((c) => 2 ** (g(`white${c}`) / 100));
    let lin = lin0.map((x, i) => x * gain[i]);
    const m = (a: number, b: number, k: string) => (g(`matrix.${k}`) / 200) * (lin[b] - lin[a]);
    lin = [lin[0] + m(0, 1, 'rg') + m(0, 2, 'rb'), lin[1] + m(1, 0, 'gr') + m(1, 2, 'gb'), lin[2] + m(2, 0, 'br') + m(2, 1, 'bg')];
    const ex = 2 ** (-g('gamma') / 200);
    let s = linearToSignal(lin.map((x) => Math.max(0, x)), 'sdr').map((x) => Math.max(0, x) ** ex);
    // multi-axis: hue rotation and saturation per axis in Cb/Cr, smooth weights between axes
    const y = 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
    let cb = (s[2] - y) / 1.8556, cr = (s[0] - y) / 1.5748;
    const ang = Math.atan2(cr, cb);
    let rot = 0, sat = 0;
    for (let k = 0; k < AXES; k++) {
      const d = Math.cos(ang - (k * Math.PI * 2) / AXES), w = d > 0 ? d * d : 0;
      rot += w * g(`axis${k}.hue`); sat += w * g(`axis${k}.sat`);
    }
    const r = (rot * Math.PI) / 180, f = 1 + sat / 100;
    [cb, cr] = [f * (cb * Math.cos(r) - cr * Math.sin(r)), f * (cb * Math.sin(r) + cr * Math.cos(r))];
    s = [y + 1.5748 * cr, y - (0.2126 * 1.5748 * cr + 0.0722 * 1.8556 * cb) / 0.7152, y + 1.8556 * cb];
    return ['R', 'G', 'B'].map((c, i) => s[i] + (g(`black${c}`) + g('pedestal')) * 0.002) as Rgb;
  });
}

/** A simulated camera: `bias` is its hidden mismatch, added to every written value. */
export class SimCamera implements MatchCamera {
  params: ParamDef[];
  private values: Values = {};
  private pending: { at: number; v: Values }[] = [];
  private shown: Values = {};
  writes = 0;
  constructor(private scene: number[][], private bias: Values, private clock: Clock, private latency = 0, params: ParamDef[] = SIM_PARAMS) {
    this.params = params;
    for (const p of params) this.values[p.id] = 0;
    this.shown = { ...this.values };
  }
  async read() { return { ...this.values }; }
  async write(v: Values) {
    this.writes++;
    this.values = { ...this.values, ...v };
    this.pending.push({ at: this.clock.now() + this.latency, v: { ...this.values } });
  }
  /** What the picture shows now (writes appear after the latency). */
  patches(): Patches {
    const now = this.clock.now();
    while (this.pending.length && this.pending[0].at <= now) this.shown = this.pending.shift()!.v;
    const eff: Values = { ...this.bias };
    for (const [k, x] of Object.entries(this.shown)) eff[k] = (eff[k] ?? 0) + x;
    return render(this.scene, eff);
  }
}

/** Virtual clock for tests: sleep advances time without waiting. */
export function virtualClock(): Clock & { t: number } {
  const c = { t: 0, now: () => c.t, sleep: async (ms: number) => { c.t += ms; } };
  return c;
}
