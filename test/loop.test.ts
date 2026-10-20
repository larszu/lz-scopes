import { describe, expect, it } from 'vitest';
import { converged, driftRows, loopErrors, loopStep, worstError } from '../src/match/loop';
import { traceLevels, type TraceLevels } from '../src/ghost';
import { LIMITS, NEUTRAL_PAINT, applyPaint, type Paint, type PaintField } from '../src/shading/model';

const KR = 0.2126, KB = 0.0722;
/** Scene: grey ramp 2…95 % plus a few colours. */
const SCENE: [number, number, number][] = [];
for (let i = 0; i < 400; i++) { const v = 0.02 + (0.93 * i) / 399; SCENE.push([v, v, v]); }
for (let i = 0; i < 100; i++) SCENE.push([0.6, 0.3, 0.2], [0.2, 0.4, 0.6]);

/** A camera: its real paint is the commanded one plus a fixed error; `gain` scales its response (real camera ≠ model). */
function camera(commanded: Paint, error: Paint, gain = 1): TraceLevels {
  const p: Paint = {};
  for (const f of Object.keys(NEUTRAL_PAINT) as PaintField[]) {
    const c = commanded[f] ?? NEUTRAL_PAINT[f];
    p[f] = NEUTRAL_PAINT[f] + (c - NEUTRAL_PAINT[f]) * gain + (error[f] ?? 0);
  }
  return traceLevels(SCENE.map((s) => applyPaint(s, p)), KR, KB)!;
}

function run(error: Paint, gain = 1, gamma = false) {
  const ref = camera(NEUTRAL_PAINT, {});
  const start: Paint = { ...NEUTRAL_PAINT };
  let cur: Paint = { ...start };
  const first = worstError(loopErrors(camera(cur, error, gain), ref, { gamma }));
  for (let i = 0; i < 40; i++) {
    const e = loopErrors(camera(cur, error, gain), ref, { gamma });
    if (converged(e)) return { steps: i, first, cur, last: worstError(e) };
    const next = loopStep(e, cur, start);
    for (const f of Object.keys(next) as PaintField[]) expect(Math.abs(next[f]! - cur[f]!)).toBeLessThanOrEqual(LIMITS.step);
    if (!Object.keys(next).length) return { steps: i, first, cur, last: worstError(e) };
    cur = { ...cur, ...next };
  }
  return { steps: 40, first, cur, last: worstError(loopErrors(camera(cur, error, gain), ref, { gamma })) };
}

describe('closed loop against the reference', () => {
  it('reference against itself: converged at once, nothing sent', () => {
    const r = run({});
    expect(r.steps).toBe(0);
  });

  it('black and white errors are pulled back under the tolerance in limited steps', () => {
    const r = run({ blackR: 10, blackB: -8, whiteR: -12, whiteB: 9 });
    expect(r.first).toBeGreaterThan(0.02);
    expect(r.last).toBeLessThanOrEqual(0.005);
    expect(r.steps).toBeGreaterThan(1);
    expect(r.steps).toBeLessThan(25);
    // the commanded paint undoes the hidden error (within a bus unit or two)
    expect(r.cur.blackR! - 128).toBeLessThan(-6);
    expect(r.cur.whiteR! - 128).toBeGreaterThan(8);
  });

  it('converges although the camera responds 1.6× stronger than the model', () => {
    const r = run({ whiteG: 14, blackG: -9 }, 1.6);
    expect(r.last).toBeLessThanOrEqual(0.005);
  });

  it('master gamma from the Y′ median', () => {
    const r = run({ masterGamma: 12 }, 1, true);
    expect(r.last).toBeLessThanOrEqual(0.005);
    expect(r.cur.masterGamma).toBeLessThan(128);
  });

  it('values the camera does not report are not moved', () => {
    const ref = camera(NEUTRAL_PAINT, {});
    const e = loopErrors(camera(NEUTRAL_PAINT, { blackR: 10 }), ref);
    expect(loopStep(e, { whiteR: 128 }, {})).toEqual({});
  });
});

describe('drift guard', () => {
  it('flags the one camera that moved away from the group', () => {
    const a = camera(NEUTRAL_PAINT, {}), b = camera(NEUTRAL_PAINT, { blackR: 1 }), c = camera(NEUTRAL_PAINT, { masterBlack: 12 });
    const rows = driftRows([{ id: 'a', levels: a }, { id: 'b', levels: b }, { id: 'c', levels: c }]);
    expect(rows.map((r) => r.alarm)).toEqual([false, false, true]);
    expect(rows[2].dBlack).toBeGreaterThan(0.01);
    const tint = driftRows([{ id: 'a', levels: a }, { id: 'b', levels: a }, { id: 'c', levels: camera(NEUTRAL_PAINT, { whiteB: 16 }) }]);
    expect(tint[2].alarm).toBe(true);
    expect(tint[2].dBg).toBeGreaterThan(0.01);
    expect(driftRows([{ id: 'a', levels: c }])[0].alarm).toBe(false);
  });
});
