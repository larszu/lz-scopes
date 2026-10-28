// Alarm frame per panel (#182): red while a QC condition holds, amber for the hold time after
// it, green when clean. The hold time is the point of the whole thing – a flash that is over
// before anyone looks up must still be visible.
import { describe, expect, it } from 'vitest';
import { QC_TYPES, QcLog, alarmColor, type QcCondition, type QcType } from '../src/qclog';

const off: QcCondition = { on: false, value: 0, detail: '' };
// every type, so a new condition cannot make this helper lie
const cond = (on: Partial<Record<QcType, boolean>>) => Object.fromEntries(
  QC_TYPES.map((k) => [k, on[k] ? { on: true, value: 1, detail: '' } : off]),
) as Record<QcType, QcCondition>;

describe('alarm frame', () => {
  it('red while it holds, amber in the hold time, green afterwards', () => {
    const log = new QcLog();
    const all = ['clip'] as QcType[];
    log.update('s1', 'Kamera 1', cond({}), null, 1000);
    expect(log.alarm('s1', all, 5000, 1000)).toBe('ok');
    log.update('s1', 'Kamera 1', cond({ clip: true }), null, 2000);
    expect(log.alarm('s1', all, 5000, 2000)).toBe('alarm');
    // still red while it lasts, however long
    expect(log.alarm('s1', all, 5000, 9000)).toBe('alarm');
    log.update('s1', 'Kamera 1', cond({}), null, 3000);
    expect(log.alarm('s1', all, 5000, 3000)).toBe('hold');
    expect(log.alarm('s1', all, 5000, 7999)).toBe('hold');
    expect(log.alarm('s1', all, 5000, 8001)).toBe('ok');
    // without a hold time it is over at once
    expect(log.alarm('s1', all, 0, 3001)).toBe('ok');
  });

  it('only this source and only the ticked conditions', () => {
    const log = new QcLog();
    log.update('s1', 'Kamera 1', cond({ clip: true }), null, 1000);
    log.update('s2', 'Kamera 2', cond({ black: true }), null, 1000);
    expect(log.alarm('s1', ['clip'], 5000, 1500)).toBe('alarm');
    expect(log.alarm('s1', ['black'], 5000, 1500)).toBe('ok');
    expect(log.alarm('s2', ['black'], 5000, 1500)).toBe('alarm');
    expect(log.alarm('s2', ['clip'], 5000, 1500)).toBe('ok');
    expect(log.alarm('s3', ['clip', 'black'], 5000, 1500)).toBe('ok');
  });

  it('a source that is removed closes its events, the hold time still runs', () => {
    const log = new QcLog();
    log.update('s1', 'Kamera 1', cond({ freeze: true }), null, 1000);
    log.closeSource('s1', 2000);
    expect(log.alarm('s1', ['freeze'], 3000, 2500)).toBe('hold');
    expect(log.alarm('s1', ['freeze'], 3000, 5001)).toBe('ok');
  });

  it('colours: off stays off, green can be switched off', () => {
    expect(alarmColor('alarm', { on: true })).toBe('#ff3b30');
    expect(alarmColor('hold', { on: true })).toBe('#ffb300');
    expect(alarmColor('ok', { on: true })).toBe('#1f9d55');
    expect(alarmColor('ok', { on: true, green: false })).toBe('');
    expect(alarmColor('alarm', { on: true, green: false })).toBe('#ff3b30');
    expect(alarmColor('alarm', { on: false })).toBe('');
  });
});
