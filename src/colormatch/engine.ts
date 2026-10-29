// Control loop of the camera colour match (docs/research/farbabgleich-werkzeug.md).
//
// Order: measure latency → black → white → pedestal → gamma → matrix → multi-axis, each step
// only with the parameters the camera offers. Every step is the same vendor-independent loop:
// the effect of each parameter is measured, not assumed (finite differences = Jacobian), then
// damped Gauss-Newton steps (Levenberg-Marquardt) with a Broyden update of the Jacobian. A step
// that makes the residual worse is undone. After every write the loop waits for the measured
// latency before it reads the picture again – so it also works when nobody knows the units of a
// parameter, which is what the guide mode (a person turning knobs) needs.
//
// Pure apart from the injected camera, measurement and clock (test/colormatch-tool.test.ts runs
// it against a simulated camera with latency).

import type { Space } from '../deltae';
import type { Rgb } from '../match/core';
import type { ChartDef } from './charts';
import { fieldDeltas, labOf, summary, type Patches } from './measure';

export type Stage = 'black' | 'white' | 'pedestal' | 'gamma' | 'matrix' | 'multiaxis';
export const STAGES: Stage[] = ['black', 'white', 'pedestal', 'gamma', 'matrix', 'multiaxis'];

export interface ParamDef {
  id: string;
  label: string;
  stage: Stage;
  min: number;
  max: number;
  /** smallest change the camera takes; values are rounded to it */
  step: number;
  /** probe step for the Jacobian (default 4 % of the range, at least `step`) */
  probe?: number;
}
export type Values = Record<string, number>;

export interface MatchCamera {
  params: ParamDef[];
  read(): Promise<Values>;
  /** writes the changed values; resolves when sent (guide mode: when the person confirms) */
  write(v: Values): Promise<void>;
}

export interface Clock { now(): number; sleep(ms: number): Promise<void> }
export const realClock: Clock = { now: () => performance.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

export type MatchEvent =
  | { kind: 'latency'; ms: number | null }
  | { kind: 'stage'; stage: Stage; params: string[] }
  | { kind: 'skip'; stage: Stage }
  | { kind: 'measure'; stage: Stage | 'start' | 'end'; de: (number | null)[]; mean: number; max: number; progress: number };

export interface MatchOptions {
  camera: MatchCamera;
  measure: () => Promise<Patches>;
  target: Patches;
  /** encoding of the target camera's picture; the target patches must be in it too */
  space: Space;
  chart: ChartDef;
  clock?: Clock;
  signal?: AbortSignal;
  onEvent?: (e: MatchEvent) => void;
  stages?: Stage[];
  maxIter?: number;
  /** fixed latency; otherwise measured */
  latencyMs?: number;
  /** guide mode: no latency probe, the person confirms every change */
  manual?: boolean;
}

export interface MatchResult { before: Values; after: Values; latencyMs: number; startDe: number; endDe: number; aborted: boolean }

class Aborted extends Error {}

/** Residual of a step: camera − target, signal units for the grey steps, CIELAB for colour. */
export function residual(stage: Stage, cam: Patches, target: Patches, chart: ChartDef, space: Space): number[] {
  const out: number[] = [];
  const sig = (i: number, ch: number[]) => { const p = cam[i], q = target[i]; for (const k of ch) out.push(p && q ? p[k] - q[k] : 0); };
  const luma = (i: number) => { const p = cam[i], q = target[i]; out.push(p && q ? (p[0] + p[1] + p[2] - q[0] - q[1] - q[2]) / 3 : 0); };
  const n = chart.neutrals;
  switch (stage) {
    case 'black': sig(chart.black, [0, 1, 2]); break;
    case 'white': sig(chart.white, [0, 1, 2]); break;
    case 'pedestal': for (const i of n.slice(0, Math.max(1, Math.ceil(n.length / 3)))) luma(i); break;
    case 'gamma': for (const i of n.length > 2 ? n.slice(1, -1) : n) luma(i); break;
    default: {
      // colour: CIELAB difference per chromatic field, scaled so 1 ΔE ≈ 0.01 like the grey steps
      const lab = labOf(space);
      for (const i of chart.chromatic) {
        const p = cam[i], q = target[i];
        if (!p || !q) { out.push(0, 0, 0); continue; }
        const a = lab(p), b = lab(q);
        out.push((a[0] - b[0]) / 100, (a[1] - b[1]) / 100, (a[2] - b[2]) / 100);
      }
    }
  }
  return out;
}

const cost = (r: number[]) => r.reduce((s, v) => s + v * v, 0);

/** Solves A x = b (n × n, row-major) by Gauss elimination with pivoting; null when singular. */
export function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => row[n] / row[i]);
}

const clampRound = (p: ParamDef, v: number) => Math.max(p.min, Math.min(p.max, Math.round(v / p.step) * p.step));

/** Mean absolute change between two readings (signal units). */
export function change(a: Patches, b: Patches) {
  let s = 0, n = 0;
  a.forEach((p, i) => { const q = b[i]; if (p && q) for (let k = 0; k < 3; k++) { s += Math.abs(p[k] - q[k]); n++; } });
  return n ? s / n : 0;
}

/**
 * Latency: change one parameter by a large step and read the picture until it moves. Returns the
 * time in ms (null when nothing moved within `timeout`) and restores the value.
 */
export async function measureLatency(cam: MatchCamera, measure: () => Promise<Patches>, clock: Clock, o: { poll?: number; timeout?: number; threshold?: number } = {}): Promise<number | null> {
  const poll = o.poll ?? 20, timeout = o.timeout ?? 3000, thr = o.threshold ?? 0.01;
  const order: Stage[] = ['pedestal', 'black', 'gamma', 'white'];
  const p = order.map((s) => cam.params.find((x) => x.stage === s)).find(Boolean);
  if (!p) return null;
  const v0 = await cam.read(), base = await measure(), orig = v0[p.id] ?? 0;
  const span = (p.max - p.min) * 0.25, to = clampRound(p, orig + span <= p.max ? orig + span : orig - span);
  const t0 = clock.now();
  await cam.write({ [p.id]: to });
  let ms: number | null = null;
  while (clock.now() - t0 < timeout) {
    await clock.sleep(poll);
    if (change(await measure(), base) > thr) { ms = clock.now() - t0; break; }
  }
  await cam.write({ [p.id]: orig });
  await clock.sleep(ms ?? timeout);
  return ms;
}

/** The whole match. Writes only parameters the camera declares. */
export async function runMatch(o: MatchOptions): Promise<MatchResult> {
  const clock = o.clock ?? realClock, cam = o.camera, maxIter = o.maxIter ?? 8;
  const stages = (o.stages ?? STAGES).filter((s) => STAGES.includes(s));
  const before = await cam.read();
  let cur: Values = { ...before };
  const check = () => { if (o.signal?.aborted) throw new Aborted(); };
  let latency = o.latencyMs ?? 0;
  const emit = (e: MatchEvent) => o.onEvent?.(e);
  const total = stages.length + 2;
  let done = 0;

  const read = async () => { const a = await o.measure(); if (o.manual) return a; const b = await o.measure(); return a.map((p, i) => (p && b[i] ? p.map((v, k) => (v + b[i]![k]) / 2) as Rgb : p)); };
  const setAndRead = async (v: Values) => {
    check();
    const diff: Values = {};
    for (const k of Object.keys(v)) if (v[k] !== cur[k]) diff[k] = v[k];
    if (Object.keys(diff).length) { await cam.write(diff); cur = { ...cur, ...diff }; await clock.sleep(latency); }
    check();
    return read();
  };
  const report = (stage: Stage | 'start' | 'end', p: Patches) => {
    const de = fieldDeltas(p, o.target, o.space), s = summary(de);
    emit({ kind: 'measure', stage, de, mean: s.mean, max: s.max, progress: done / total });
    return s.mean;
  };

  try {
    if (o.latencyMs == null && !o.manual) {
      const ms = await measureLatency(cam, o.measure, clock);
      check();
      // margin: one more poll interval and 20 % for jitter
      latency = ms == null ? 500 : Math.ceil(ms * 1.2 + 40);
      emit({ kind: 'latency', ms });
    }
    done++;
    let patches = await read();
    const startDe = report('start', patches);

    for (const stage of stages) {
      const params = cam.params.filter((p) => p.stage === stage);
      const noFields = (stage === 'matrix' || stage === 'multiaxis') && !o.chart.chromatic.length;
      if (!params.length || noFields) { emit({ kind: 'skip', stage }); done++; continue; }
      emit({ kind: 'stage', stage, params: params.map((p) => p.id) });
      patches = await optimise(stage, params);
      done++;
      report(stage, patches);
    }
    done++;
    const endDe = report('end', patches);
    return { before, after: cur, latencyMs: latency, startDe, endDe, aborted: false };
  } catch (e) {
    if (!(e instanceof Aborted)) throw e;
    return { before, after: cur, latencyMs: latency, startDe: NaN, endDe: NaN, aborted: true };
  }

  async function optimise(stage: Stage, params: ParamDef[]): Promise<Patches> {
    const res = (p: Patches) => residual(stage, p, o.target, o.chart, o.space);
    let x = params.map((p) => cur[p.id] ?? (p.min + p.max) / 2);
    let p0 = await setAndRead(Object.fromEntries(params.map((p, i) => [p.id, x[i]])));
    let r = res(p0), c = cost(r);
    // Jacobian by finite differences, one parameter at a time
    const J: number[][] = r.map(() => params.map(() => 0));
    for (let j = 0; j < params.length; j++) {
      const p = params[j];
      let h = Math.max(p.step, p.probe ?? (p.max - p.min) * 0.04);
      if (x[j] + h > p.max) h = -h;
      const xs = [...x]; xs[j] = clampRound(p, x[j] + h);
      const rj = res(await setAndRead(Object.fromEntries(params.map((q, i) => [q.id, xs[i]]))));
      const dh = xs[j] - x[j] || h;
      rj.forEach((v, i) => { J[i][j] = (v - r[i]) / dh; });
    }
    p0 = await setAndRead(Object.fromEntries(params.map((p, i) => [p.id, x[i]])));
    r = res(p0); c = cost(r);
    let lambda = 1e-3;
    for (let it = 0; it < maxIter; it++) {
      const n = params.length;
      const JtJ = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J.reduce((s, row) => s + row[a] * row[b], 0)));
      const Jtr = Array.from({ length: n }, (_, a) => J.reduce((s, row, i) => s + row[a] * r[i], 0));
      for (let a = 0; a < n; a++) JtJ[a][a] += lambda * (JtJ[a][a] || 1e-9) + 1e-12;
      const d = solve(JtJ, Jtr.map((v) => -v));
      if (!d) break;
      const xn = x.map((v, i) => clampRound(params[i], v + d[i]));
      const step = xn.map((v, i) => v - x[i]);
      if (step.every((v) => v === 0)) break;
      const pn = await setAndRead(Object.fromEntries(params.map((p, i) => [p.id, xn[i]])));
      const rn = res(pn), cn = cost(rn);
      if (cn < c) {
        // Broyden: J += (Δr − J·Δx) Δxᵀ / |Δx|²
        const dd = step.reduce((s, v) => s + v * v, 0);
        rn.forEach((v, i) => { const pred = J[i].reduce((s, jv, k) => s + jv * step[k], 0), e = (v - r[i] - pred) / dd; for (let k = 0; k < n; k++) J[i][k] += e * step[k]; });
        const gain = (c - cn) / (c || 1);
        x = xn; r = rn; c = cn; p0 = pn; lambda = Math.max(1e-6, lambda / 3);
        if (gain < 0.01) break;
      } else {
        lambda *= 6;
        p0 = await setAndRead(Object.fromEntries(params.map((p, i) => [p.id, x[i]])));
        if (lambda > 1e3) break;
      }
    }
    return p0;
  }
}
