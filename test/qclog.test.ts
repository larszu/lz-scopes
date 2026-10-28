import { describe, expect, it } from 'vitest';
import { DEFAULT_QC, QcLog, evaluate, frameFingerprint, toCsv, type QcInput } from '../src/qclog';
import { rgbDecoder } from '../src/ycbcr';

const stats = (o: Partial<{ yMin: number; yMax: number; clip: number }>) => ({
  hist: [], yMin: o.yMin ?? 0.1, yMax: o.yMax ?? 0.9, yAvg: 0.4, rgbAvg: [0.4, 0.4, 0.4] as [number, number, number],
  clipLow: [0, 0, 0], clipHigh: [o.clip ?? 0, 0, 0], samples: 100,
});
const input = (o: Partial<QcInput>): QcInput => ({
  signal: null, stats: stats({}), r103: null, peakDb: null, unchangedMs: 0, freezeApplies: true, ...o });

describe('QC conditions', () => {
  it('detects black frame, clipping, super-white, sub-black, silence and freeze by their thresholds', () => {
    const c = evaluate(input({ stats: stats({ yMax: 0.01 }) }), DEFAULT_QC);
    expect(c.black.on).toBe(true);
    expect(evaluate(input({ stats: stats({ clip: 0.02 }) }), DEFAULT_QC).clip.on).toBe(true);
    expect(evaluate(input({ stats: stats({ clip: 0.001 }) }), DEFAULT_QC).clip.on).toBe(false);
    expect(evaluate(input({ stats: stats({ yMax: 1.09 }) }), DEFAULT_QC).superwhite.on).toBe(true);
    expect(evaluate(input({ stats: stats({ yMin: -0.04 }) }), DEFAULT_QC).subblack.on).toBe(true);
    expect(evaluate(input({ peakDb: -70 }), DEFAULT_QC).silence.on).toBe(true);
    expect(evaluate(input({ peakDb: -20 }), DEFAULT_QC).silence.on).toBe(false);
    expect(evaluate(input({ peakDb: null }), DEFAULT_QC).silence.on).toBe(false); // no sound track: nothing to report
    expect(evaluate(input({ unchangedMs: 2500 }), DEFAULT_QC).freeze.on).toBe(true);
    expect(evaluate(input({ unchangedMs: 2500, freezeApplies: false }), DEFAULT_QC).freeze.on).toBe(false);
  });
});

describe('QC log', () => {
  it('opens an event when a condition starts, keeps the worst value, closes it with duration and time code', () => {
    const log = new QcLog();
    log.update('s1', 'Kamera 1', evaluate(input({ stats: stats({ yMax: 0.015 }) }), DEFAULT_QC), '10:00:00:00', 1000);
    log.update('s1', 'Kamera 1', evaluate(input({ stats: stats({ yMax: 0.005 }) }), DEFAULT_QC), '10:00:00:12', 1500);
    log.update('s1', 'Kamera 1', evaluate(input({}), DEFAULT_QC), '10:00:01:00', 2000);
    expect(log.events).toHaveLength(1);
    const e = log.events[0];
    expect(e.type).toBe('black'); expect(e.start).toBe(1000); expect(e.end).toBe(2000);
    expect(e.worst).toBeCloseTo(0.005, 9); expect(e.tcStart).toBe('10:00:00:00'); expect(e.tcEnd).toBe('10:00:01:00');
  });
  it('CSV export with the chosen types', () => {
    const log = new QcLog();
    log.update('s1', 'Cam "A"', evaluate(input({ stats: stats({ yMax: 0.01, clip: 0.5 }) }), DEFAULT_QC), null, 0);
    const csv = toCsv(log.events, ['black']);
    expect(csv.split('\n')).toHaveLength(2);
    expect(csv).toContain('"Cam ""A"""');
    expect(csv).toContain(';black;');
  });
  it('frame fingerprint changes with the picture', () => {
    const a = new Float32Array(32 * 32 * 4).fill(0.2), b = a.slice(); b[(17 * 32 + 17) * 4] = 0.9;
    const d = rgbDecoder(1);
    expect(frameFingerprint(a, 32, 32, d)).toBe(frameFingerprint(a.slice(), 32, 32, d));
    expect(frameFingerprint(a, 32, 32, d)).not.toBe(frameFingerprint(b, 32, 32, d));
  });
});

describe('QC metrics of the bridge (#202)', () => {
  it('TOUT, VREP and the broadcast range trip at their thresholds', () => {
    const under = evaluate(input({ signal: { tout: 0.0001, vrep: 0.001, brng: 0.001 } }), DEFAULT_QC);
    expect(under.tout.on).toBe(false);
    expect(under.vrep.on).toBe(false);
    expect(under.brng.on).toBe(false);
    const over = evaluate(input({ signal: { tout: 0.01, vrep: 0.2, brng: 0.3 } }), DEFAULT_QC);
    expect(over.tout.on).toBe(true);
    expect(over.vrep.on).toBe(true);
    expect(over.brng.on).toBe(true);
    expect(over.brng.detail).toContain('30');
  });

  it('without the metrics the conditions simply do not hold', () => {
    const c = evaluate(input({ signal: null }), DEFAULT_QC);
    for (const k of ['tout', 'vrep', 'brng'] as const) {
      expect(c[k].on).toBe(false);
      expect(c[k].detail).toBe('');
    }
  });
});
