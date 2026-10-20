// Ring buffer (#140 step 5): window, segment selection, key frame search and joining with the
// shipped ffmpeg (copy from the last key frame before the window start, post-roll, latency).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  concatList, dropOverwritten, joinSegments, keyframes, lastKeyframeBefore, ringWrap, saveWindow, selectSegments,
// @ts-expect-error plain JS module
} from '../server/ring.mjs';
import { validateCommand } from '../server/control.mjs';
import { shippedFfmpeg } from './shippedFfmpeg';

const ffmpeg = shippedFfmpeg ?? '';
const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/, (m) => m.replace('ffmpeg', 'ffprobe'));
const tmp: string[] = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'lzs-ring-')); tmp.push(d); return d; };
afterAll(() => { for (const d of tmp) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); });

type Entry = { file: string; startMs: number; endMs: number; gen: number };
const seg = (i: number, gen = 1, len = 2000, t0 = 0): Entry => ({ file: `ring${gen}_${String(i).padStart(3, '0')}.mkv`, startMs: t0 + i * len, endMs: t0 + (i + 1) * len, gen });

describe('ring buffer: pure parts', () => {
  it('number of files: window + post-roll + margin, two spare', () => {
    expect(ringWrap(60, 0)).toBe(37);
    expect(ringWrap(60, 10)).toBe(42);
  });
  it('save window follows the latency of the source', () => {
    expect(saveWindow(100_000, 60, 5, 0)).toEqual({ from: 40_000, to: 105_000 });
    // a camera 120 ms late shows the same moment 120 ms later in arrival time
    expect(saveWindow(100_000, 60, 5, 120)).toEqual({ from: 40_120, to: 105_120 });
    expect(saveWindow(100_000, 1, 0, NaN)).toEqual({ from: 99_000, to: 100_000 });
  });
  it('selects the segments of the window with offsets into first and last file', () => {
    const entries = [seg(3), seg(0), seg(1), seg(2), seg(4)];
    const s = selectSegments(entries, 1300, 7500);
    expect(s.items.map((e: Entry) => e.file)).toEqual(['ring1_000.mkv', 'ring1_001.mkv', 'ring1_002.mkv', 'ring1_003.mkv']);
    expect(s.inpoint).toBeCloseTo(1.3);
    expect(s.outpoint).toBeCloseTo(1.5);
    expect(s.complete).toBe(true);
    // window older than the ring: what is there, marked incomplete
    expect(selectSegments(entries, -5000, 3000).complete).toBe(false);
    expect(selectSegments(entries, 20_000, 30_000)).toBeNull();
  });
  it('key frame search: last one at or before t, the first one otherwise', () => {
    expect(lastKeyframeBefore([0, 1, 2, 3], 1.3)).toBe(1);
    expect(lastKeyframeBefore([0, 1, 2, 3], 2)).toBe(2);
    expect(lastKeyframeBefore([0.04, 1], 0)).toBe(0.04);
    expect(lastKeyframeBefore([], 5)).toBe(0);
  });
  it('concat list quotes paths and carries in/out points', () => {
    expect(concatList([{ path: "/a/it's/x.mkv", inpoint: 1.25 }, { path: '/a/y.mkv', outpoint: 0.5 }]))
      .toBe("file '/a/it'\\''s/x.mkv'\ninpoint 1.250000\nfile '/a/y.mkv'\noutpoint 0.500000\n");
  });
  it('a new segment line makes the same file and the next one stale (wrap)', () => {
    const e = [seg(0), seg(1), seg(2), seg(3), seg(0, 2)];
    expect(dropOverwritten(e, 'ring1_003.mkv', 4, 1).map((x: Entry) => x.file)).toEqual(['ring1_001.mkv', 'ring1_002.mkv', 'ring2_000.mkv']);
  });
  it('control API: ring and ring.save', () => {
    expect(validateCommand({ cmd: 'ring', mode: 'on' })).toEqual({ ok: true, command: { cmd: 'ring', mode: 'on' } });
    expect(validateCommand({ cmd: 'ring.save', pre: 30, post: 5 })).toEqual({ ok: true, command: { cmd: 'ring.save', pre: 30, post: 5 } });
    expect(validateCommand({ cmd: 'ring.save', pre: -1 }).ok).toBe(false);
  });
});

const probe = (file: string) => {
  const j = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_name,nb_read_frames', '-of', 'json', file]).toString());
  return { codec: j.streams[0].codec_name as string, frames: Number(j.streams[0].nb_read_frames) };
};

describe.skipIf(!shippedFfmpeg || !existsSync(ffprobe))('ring buffer with the shipped ffmpeg', () => {
  it('copy: joined from the last key frame before the window start, cut at the post-roll end', async () => {
    const dir = tempDir();
    // 6 s H.264, key frame every second, no B-frames, 2-s segments like the ring
    const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=6',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '25', '-bf', '0', '-f', 'segment', '-segment_time', '2', '-reset_timestamps', '1', join(dir, 'ring1_%03d.mkv')]);
    expect(r.status).toBe(0);
    expect(await keyframes(ffprobe, join(dir, 'ring1_000.mkv'))).toEqual([0, 1]);
    const sel = selectSegments([seg(0), seg(1), seg(2)], 1300, 5000);
    const out = join(dir, 'out.mkv');
    const res = await joinSegments({ ffmpeg, ffprobe, dir, sel, out });
    expect(res).toMatchObject({ ok: true, startOffset: 1, files: 3 });
    // from the key frame at 1.0 s to 5.0 s: 4 s at 25 fps
    expect(probe(out)).toEqual({ codec: 'h264', frames: 100 });
    // the stage folder is gone, the ring files stay
    expect(readdirSync(dir).sort()).toEqual(['out.mkv', 'ring1_000.mkv', 'ring1_001.mkv', 'ring1_002.mkv']);
  }, 30_000);

  it('bridge: ring of a test pattern (ProRes), save with post-roll, companion file of the window', async () => {
    const dir = tempDir();
    // @ts-expect-error plain JS module
    const { startBridge } = await import('../server/index.mjs');
    const { default: WebSocket } = await import('ws');
    const bridge = await startBridge({ port: 0, recordDirs: [dir] });
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/stream?url=test:testsrc&width=160`);
    const msgs: Record<string, unknown>[] = [];
    try {
      ws.on('message', (d: Buffer, bin: boolean) => { if (!bin) msgs.push(JSON.parse(String(d))); });
      await new Promise((ok) => ws.once('open', ok));
      await until(() => msgs.some((m) => m.type === 'info'));
      ws.send(JSON.stringify({ type: 'ring', on: true, pre: 4, post: 1, codec: 'prores', name: 'Cam' }));
      await new Promise((r) => setTimeout(r, 8000));
      ws.send(JSON.stringify({ type: 'mark', label: 'in' }));
      ws.send(JSON.stringify({ type: 'ring.save', take: 't1', at: Date.now(), name: 'Cam', latencyMs: 0 }));
      await until(() => msgs.some((m) => m.type === 'ring' && (m.state === 'saved' || m.state === 'error')), 20_000);
      ws.send(JSON.stringify({ type: 'ring', on: false }));
      await until(() => msgs.some((m) => m.type === 'ring' && m.state === 'stopped'), 10_000);
      await new Promise((r) => setTimeout(r, 1500));
    } finally { ws.close(); bridge.close(); }
    const saved = msgs.find((m) => m.type === 'ring' && m.state === 'saved');
    // complete: the ring covers the whole window; a runner encoding below real time leaves gaps and reports false
    expect(saved).toMatchObject({ file: 'Cam_ring.mkv' });
    expect(typeof saved?.complete).toBe('boolean');
    const v = probe(join(dir, 't1', 'Cam_ring.mkv'));
    expect(v.codec).toBe('prores');
    // 4 s before + 1 s post-roll at 25 fps = 125 frames (intra codec: starts at the window, ±1 frame); a slow
    // CI runner encodes 1080p ProRes below real time and fills the same wall-clock window with fewer frames
    expect(v.frames).toBeLessThanOrEqual(127);
    expect(v.frames).toBeGreaterThan(40);
    const j = JSON.parse(readFileSync(join(dir, 't1', 'Cam_ring.json'), 'utf8'));
    expect(j).toMatchObject({ kind: 'ring', window: { preSeconds: 4, postSeconds: 1, complete: saved?.complete }, video: { codec: 'prores' } });
    expect(j.markers.map((m: { label: string }) => m.label)).toEqual(['in']);
    // the ring folder is removed after the ring stops
    await until(() => readdirSync(join(dir, '.lzs-ring')).length === 0).catch(() => {});
    expect(readdirSync(join(dir, '.lzs-ring'))).toEqual([]);
  }, 60_000);
});

async function until(f: () => boolean, ms = 10_000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
}
