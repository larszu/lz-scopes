import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { EventLog, audioOf, eventsCsv, formatOf, observePtp, observeRtp, redactSource, tapStream, type StreamRecord } from '../server/eventlog.mjs';

const clock = () => { let t = 1_700_000_000_000; return () => (t += 1000); };

describe('EventLog (#239)', () => {
  it('writes a change only when the value differs, with the value before', () => {
    const log = new EventLog({ now: clock() });
    expect(log.change('k', 'format', 's', 'format', 'a')?.from).toBe(null);
    expect(log.change('k', 'format', 's', 'format', 'a')).toBe(null);
    const e = log.change('k', 'format', 's', 'format', 'b');
    expect(e).toMatchObject({ from: 'a', to: 'b', kind: 'format', source: 's' });
    expect(log.change('k', 'format', 's', 'format', null)).toBe(null);
    expect(log.entries).toHaveLength(2);
  });

  it('is a ring buffer and still counts everything', () => {
    const log = new EventLog({ max: 3, now: clock() });
    for (let i = 0; i < 5; i++) log.add('flow', 's', 'start', String(i));
    expect(log.entries.map((e) => e.to)).toEqual(['2', '3', '4']);
    expect(log.total).toBe(5);
    expect(log.list({ since: 3 }).map((e) => e.id)).toEqual([4, 5]);
  });

  it('keeps no credentials or query in the source', () => {
    expect(redactSource('rtsp://user:secret@cam.example:554/stream1?token=x')).toBe('rtsp://cam.example:554/stream1');
    expect(redactSource('srt://host.example:9000?passphrase=abc')).toBe('srt://host.example:9000');
    expect(redactSource('test:bars')).toBe('test:bars');
  });

  it('describes format and sound channels as comparable texts', () => {
    expect(formatOf({ sourceWidth: 1920, sourceHeight: 1080, interlaced: true, sourceFps: 25, codec: 'h264', transfer: 'bt709', primaries: 'bt709', matrix: 'bt709', range: 'tv' }))
      .toBe('1920x1080i25 h264 bt709/bt709/bt709 tv');
    expect(formatOf({ width: 0, height: 0 })).toBe(null);
    expect(audioOf({ audio: { channels: 8, layout: '7.1', sampleRate: 48000 } })).toBe('8 ch 7.1 48000 Hz');
    expect(audioOf({ audio: null })).toBe('none');
    expect(audioOf({})).toBe(null);
  });

  it('follows PTP state, grandmaster and lock; a monitor that never ran is not an event', () => {
    const log = new EventLog({ now: clock() });
    observePtp(log, null);
    expect(log.entries).toHaveLength(0);
    const st = { state: 'receiving', domain: 127, gm: { identity: 'aa:bb', clockClass: 6, utcOffsetValid: true, currentUtcOffset: 37 }, sm: { lockingText: 'locked' } };
    observePtp(log, st);
    observePtp(log, st);
    expect(log.entries.map((e) => `${e.kind}:${e.item}=${e.to}`)).toEqual(['ptp:state=receiving', 'ptp:domain=127', 'ptp:grandmaster=aa:bb', 'ptp:clockClass=6', 'ptp:utcOffset=37', 'lock:gmLocking=locked']);
    observePtp(log, { ...st, sm: { lockingText: 'free run (not locked to an external reference)' } });
    expect(log.entries.at(-1)).toMatchObject({ kind: 'lock', from: 'locked' });
    observePtp(log, null);
    expect(log.entries.at(-1)).toMatchObject({ item: 'state', from: 'receiving', to: 'off' });
  });

  it('follows the watched RTP stream', () => {
    const log = new EventLog({ now: clock() });
    observeRtp(log, { group: '239.0.0.1', port: 5004, frames: 0, payloadType: null });
    observeRtp(log, { group: '239.0.0.1', port: 5004, frames: 25, payloadType: 96 });
    expect(log.entries.map((e) => `${e.item}=${e.to}`)).toEqual(['receiving=no', 'receiving=yes', 'payloadType=96']);
  });

  it('exports CSV with quoted fields', () => {
    const log = new EventLog({ now: () => Date.UTC(2026, 10, 24, 12, 0, 0) });
    log.add('flow', 'a"b', 'error', 'x;y');
    expect(eventsCsv(log.entries)).toBe('id;time;kind;source;item;from;to\n1;2026-11-24T12:00:00.000Z;flow;"a""b";error;"";"x;y"\n');
  });
});

describe('tapStream (#239)', () => {
  class FakeWs extends EventEmitter { sent: unknown[] = []; send(d: unknown) { this.sent.push(d); } }

  it('logs flow, format and channels from what the socket sends and counts for /metrics', () => {
    const log = new EventLog({ now: clock() });
    const streams = new Map<number, StreamRecord>();
    const ws = new FakeWs();
    tapStream(ws, { log, url: 'rtsp://u:p@cam.example/x', streams, id: 1 });
    ws.send(JSON.stringify({ type: 'info', width: 960, height: 540, sourceWidth: 1920, sourceHeight: 1080, fps: 25, codec: 'h264', proto: 2, audio: { channels: 2, layout: 'stereo', sampleRate: 48000 } }));
    ws.send(Buffer.alloc(100));
    ws.send(JSON.stringify({ type: 'stats', sent: 50, dropped: 2 }));
    ws.send(JSON.stringify({ type: 'tc', tc: '10:00:00:00' }));
    expect(streams.get(1)).toMatchObject({ source: 'rtsp://cam.example/x', sent: 50, dropped: 2, bytes: 100, width: 1920, height: 1080, fps: 25 });
    ws.send(JSON.stringify({ type: 'error', code: 'x.y', message: 'failed rtsp://u:p@cam.example/x' }));
    ws.emit('close');
    expect(streams.size).toBe(0);
    expect(ws.sent).toHaveLength(5);
    expect(log.entries.map((e) => `${e.kind}:${e.item}=${e.to}`)).toEqual([
      'flow:start=open', 'format:format=1920x1080p25 h264', 'audio:channels=2 ch stereo 48000 Hz', 'flow:error=x.y: failed rtsp://cam.example/x',
    ]);
  });

  it('writes a stop when the client closes, and no format change on a reconnect with the same format', () => {
    const log = new EventLog({ now: clock() });
    const streams = new Map<number, StreamRecord>();
    for (const id of [1, 2]) {
      const ws = new FakeWs();
      tapStream(ws, { log, url: 'test:bars', streams, id });
      ws.send(JSON.stringify({ type: 'info', width: 1920, height: 1080, fps: 25 }));
      ws.emit('close');
    }
    expect(log.entries.map((e) => e.item)).toEqual(['start', 'format', 'stop', 'start', 'stop']);
  });
});
