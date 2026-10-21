// Common time base (#140 steps 2 and 5): freeze all sources at one moment of the scene with
// latency compensation, and play several recordings on one clock (server/playback.mjs).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { REC_URL, frameDue, listRecordings, mediaPosition, resolveRecording, sceneTime } from '../server/playback.mjs';
import { FrameHistory, PlaybackClock, clockText, freezeMoment, pickFrame } from '../src/record/sync';
import { shippedFfmpeg } from './shippedFfmpeg';

const tmp: string[] = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'lzs-sync-')); tmp.push(d); return d; };
afterAll(() => { for (const d of tmp) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });

describe('freeze all with latency compensation', () => {
  it('common moment = now − the largest latency; unknown latency counts as 0', () => {
    expect(freezeMoment(10_000, [40, 160, null])).toBe(9_840);
    expect(freezeMoment(10_000, [null, null])).toBe(10_000);
  });
  it('each source picks the frame that shows that moment', () => {
    // frames every 40 ms; camera A 40 ms late, camera B 160 ms late
    const h = new FrameHistory<string>(600, 24);
    for (let at = 9_400; at <= 10_000; at += 40) h.push(`f${at}`, at);
    const scene = freezeMoment(10_000, [40, 160]);
    expect(pickFrame(h.frames, scene, 160)?.frame).toBe('f10000');
    expect(pickFrame(h.frames, scene, 40)?.frame).toBe('f9880');
    expect(pickFrame([], scene, 0)).toBeNull();
  });
  it('history keeps the last ms and at most max frames', () => {
    const h = new FrameHistory<number>(100, 3);
    for (let i = 0; i < 10; i++) h.push(i, i * 40);
    expect(h.frames.map((f) => f.frame)).toEqual([7, 8, 9]);
    const g = new FrameHistory<number>(100, 50);
    for (let i = 0; i < 10; i++) g.push(i, i * 40);
    expect(g.frames.map((f) => f.frame)).toEqual([7, 8, 9]);
  });
});

describe('playback clock', () => {
  it('scene time ↔ media position with latency', () => {
    // first frame at 10 000, the camera 120 ms late: the file at 0 s shows the scene at 9 880
    expect(sceneTime(0, 10_000, 120)).toBe(9_880);
    expect(mediaPosition(9_880, 10_000, 120)).toBe(0);
    expect(mediaPosition(12_000, 10_000, 0)).toBe(2);
  });
  it('frames are due on the shared clock', () => {
    const c = { pos0: 0, fps: 25, startUtcMs: 10_000, latencyMs: 0, t0: 10_000, at0: 500_000, rate: 1 };
    expect(frameDue(0, c)).toBe(500_000);
    expect(frameDue(25, c)).toBe(501_000);
    // a second recording that starts one second later in the scene shows its first frame one second later
    expect(frameDue(0, { ...c, startUtcMs: 11_000 })).toBe(501_000);
    expect(frameDue(25, { ...c, rate: 2 })).toBe(500_500);
  });
  it('PlaybackClock: play, pause, seek', () => {
    const k = new PlaybackClock();
    k.seek(1000, 0);
    k.play(0);
    expect(k.position(500)).toBe(1500);
    k.pause(500);
    expect(k.position(9999)).toBe(1500);
    k.seek(200, 10_000);
    expect(k.position(20_000)).toBe(200);
    expect(clockText(new Date(2026, 9, 10, 9, 5, 7, 42).getTime())).toBe('09:05:07.042');
  });
});

/** a recording folder as the bridge writes it: segments + companion file */
function fakeTake(root: string, take: string, name: string, startUtcMs: number, latencyMs: number, seconds = 3) {
  const dir = join(root, take);
  mkdirSync(dir, { recursive: true });
  const file = `${name}_000.mkv`;
  if (shippedFfmpeg) {
    const r = spawnSync(shippedFfmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=320x180:rate=25:duration=${seconds}`, '-c:v', 'ffv1', join(dir, file)]);
    if (r.status !== 0) throw new Error(String(r.stderr));
  } else writeFileSync(join(dir, file), '');
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({
    format: 'lz-scopes-recording', version: 1, take, source: { name }, latencyMs,
    start: { utcMs: startUtcMs }, segments: [{ file, start: 0, end: seconds, utcMs: startUtcMs }], markers: [], events: [],
  }));
}

describe('recordings as sources', () => {
  it('rec: URLs resolve only inside released folders', () => {
    const root = tempDir();
    fakeTake(root, 't1', 'Cam_A', 10_000, 0);
    const roots = [{ name: 'Rec', dir: root }];
    expect(REC_URL.test('rec:Rec/t1/Cam_A')).toBe(true);
    expect(resolveRecording('rec:Rec/t1/Cam_A', roots)).toMatchObject({ name: 'Cam_A', startUtcMs: 10_000, latencyMs: 0 });
    for (const bad of ['rec:Rec/../t1/Cam_A', 'rec:Rec/t1/../../x', 'rec:Other/t1/Cam_A', 'rec:Rec/t1/Missing', 'rec:Rec/.hidden/Cam_A']) expect(resolveRecording(bad, roots)).toBeNull();
    const list = listRecordings(roots);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ root: 'Rec', take: 't1', recordings: [{ name: 'Cam_A', url: 'rec:Rec/t1/Cam_A', seconds: 3 }] });
  });

  it.skipIf(!shippedFfmpeg || !existsSync(String(shippedFfmpeg).replace(/ffmpeg(\.exe)?$/, 'ffprobe$1')))('two recordings play on one clock: the later one starts one second later', async () => {
    const root = tempDir();
    fakeTake(root, 't1', 'Cam_A', 10_000, 0);
    fakeTake(root, 't1', 'Cam_B', 11_000, 0);
    // @ts-expect-error plain JS module
    const { startBridge } = await import('../server/index.mjs');
    const { default: WebSocket } = await import('ws');
    const bridge = await startBridge({ port: 0, recordDirs: [root] });
    const name = root.split(/[\\/]/).pop()!.replace(/[^\w .-]/g, '_');
    const open = (n: string) => new WebSocket(`ws://127.0.0.1:${bridge.port}/stream?url=${encodeURIComponent(`rec:${name}/t1/${n}`)}&width=160`);
    const a = open('Cam_A'), b = open('Cam_B');
    const arrivals: Record<string, number[]> = { a: [], b: [] };
    const infos: Record<string, Record<string, unknown>> = {};
    try {
      for (const [k, ws] of [['a', a], ['b', b]] as const) {
        ws.on('message', (d: Buffer, bin: boolean) => {
          if (bin) arrivals[k].push(Date.now());
          else { const m = JSON.parse(String(d)); if (m.type === 'info') infos[k] = m; }
        });
        await new Promise((ok) => ws.once('open', ok));
      }
      await until(() => !!infos.a && !!infos.b && arrivals.a.length >= 1 && arrivals.b.length >= 1, 15_000);
      expect(infos.a.playback).toMatchObject({ startUtcMs: 10_000, latencyMs: 0, duration: 3 });
      arrivals.a = []; arrivals.b = [];
      const at = Date.now() + 300;
      for (const ws of [a, b]) ws.send(JSON.stringify({ type: 'play', t: 10_000, at }));
      await new Promise((r) => setTimeout(r, 3800));
      // A: 3 s from `at`; B: its scene starts 1 s later, so its first frame comes 1 s after A's
      expect(Math.abs(arrivals.a[0] - at)).toBeLessThan(120);
      expect(Math.abs(arrivals.b[0] - arrivals.a[0] - 1000)).toBeLessThan(120);
      // paced at 25 fps, not as fast as ffmpeg decodes
      expect(arrivals.a.length).toBeGreaterThan(65);
      expect(arrivals.a.length).toBeLessThanOrEqual(76);
      // seek while paused: exactly one picture
      const n = arrivals.b.length;
      b.send(JSON.stringify({ type: 'seek', t: 12_000 }));
      await new Promise((r) => setTimeout(r, 1500));
      expect(arrivals.b.length - n).toBe(1);
    } finally { bridge.close(); }
    // closing the bridge ends the decoders of both players, also with the clients still connected
    await until(() => childFfmpeg() === 0, 10_000).catch(() => {});
    expect(childFfmpeg()).toBe(0);
    a.close(); b.close();
  }, 60_000);
});

async function until(f: () => boolean, ms = 10_000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** ffmpeg/ffprobe processes started by this test process. */
function childFfmpeg(): number {
  const out = process.platform === 'win32'
    ? execFileSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${process.pid}" | Where-Object { $_.Name -match '^ff(mpeg|probe)' }).Count`], { encoding: 'utf8' })
    : (() => { try { return execFileSync('pgrep', ['-P', String(process.pid), 'ff'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).length.toString(); } catch { return '0'; } })();
  return Number(out.trim()) || 0;
}
