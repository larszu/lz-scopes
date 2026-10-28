// File sources through the bridge (#188): a file released by the desktop app becomes the input
// `file:<name>`, so ffmpeg decodes it – the browser's <video> element always hands out 8-bit
// R′G′B′ and knows no ProRes. Checked with the shipped ffmpeg: a 10-bit ProRes clip arrives on
// the 10-bit code grid, a 16-bit TIFF as a looped still.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { addMediaFile, clearMediaFiles, mediaFile, mediaInputArgs } from '../server/media.mjs';
// @ts-expect-error plain JS module
import { ffmpegArgs, validateInput } from '../server/index.mjs';
import { shippedFfmpeg } from './shippedFfmpeg';

const ffmpeg = shippedFfmpeg ?? '';
const dir = mkdtempSync(join(tmpdir(), 'lzs-media-'));
afterAll(() => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* still held */ } });

const clip = join(dir, 'clip10.mov');
const still = join(dir, 'still16.tif');

describe('released media files', () => {
  it('only released files, addressed by name – no path finds its way in', () => {
    clearMediaFiles();
    writeFileSync(join(dir, 'take one.mov'), 'x');
    writeFileSync(join(dir, 'b.mov'), 'x');
    const a = addMediaFile(join(dir, 'take one.mov'));
    expect(a).toMatchObject({ name: 'take one.mov', url: 'file:take one.mov', file: 'take one.mov' });
    // the same file again keeps its name, a different one with the same base name gets a second
    expect(addMediaFile(join(dir, 'take one.mov')).name).toBe('take one.mov');
    expect(validateInput(a.url)).toBeNull();
    expect(validateInput('file:unknown.mov')).not.toBeNull();
    expect(mediaFile('file:/etc/passwd')).toBeNull();
    expect(mediaFile('file:../../etc/passwd')).toBeNull();
    expect(mediaFile('file:' + join(dir, 'b.mov'))).toBeNull();
    expect(() => addMediaFile(join(dir, 'gone.mov'))).toThrow();
    expect(() => addMediaFile(dir)).toThrow();
  });

  it('ffmpeg arguments: own pace, endless loop; a still is repeated', () => {
    clearMediaFiles();
    writeFileSync(join(dir, 'v.mov'), 'x');
    writeFileSync(join(dir, 's.dpx'), 'x');
    const v = addMediaFile(join(dir, 'v.mov'));
    const s = addMediaFile(join(dir, 's.dpx'));
    expect(mediaInputArgs(mediaFile(v.url))).toEqual(['-stream_loop', '-1', '-re', '-i', join(dir, 'v.mov')]);
    expect(mediaInputArgs(mediaFile(s.url))).toEqual(['-loop', '1', '-framerate', '10', '-re', '-i', join(dir, 's.dpx')]);
    // the whole command line of the stream output carries them
    const { main } = ffmpegArgs({ url: v.url, vf: 'scale=960:540', depth: 16 });
    expect(main.join(' ')).toContain(`-stream_loop -1 -re -i ${join(dir, 'v.mov')}`);
    expect(main.join(' ')).toContain('-pix_fmt rgba64le');
  });

  it.skipIf(!ffmpeg)('10-bit ProRes keeps its depth, a 16-bit still is fed as a loop', async () => {
    clearMediaFiles();
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'gradients=s=320x180:c0=0x202020:c1=0x3a3550:d=1:speed=0.1',
      '-t', '1', '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', clip]);
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'gradients=s=320x180:c0=0x101010:c1=0x404060:d=1',
      '-frames:v', '1', '-pix_fmt', 'rgb48le', still]);
    // @ts-expect-error plain JS module
    const { startBridge } = await import('../server/index.mjs');
    const { default: WebSocket } = await import('ws');
    const bridge = await startBridge({ port: 0, mediaFiles: [clip, still] });
    const open = async (url: string, q: string) => {
      const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/stream?url=${encodeURIComponent(url)}&width=320&fps=5&${q}`);
      const out: { info: Record<string, number | string> | null; frame: Uint16Array | null } = { info: null, frame: null };
      try {
        ws.on('message', (d: Buffer, bin: boolean) => {
          if (!bin) { const m = JSON.parse(String(d)); if (m.type === 'info') out.info = m; return; }
          if (!out.frame) out.frame = new Uint16Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.length));
        });
        await until(() => !!out.frame, 20_000);
      } finally { ws.close(); }
      return out;
    };
    try {
      const v = await open('file:clip10.mov', 'depth=16&format=yuv');
      expect(v.info).toMatchObject({ codec: 'prores', pixFmt: 'yuv422p10le', format: 'yuv', depth: 16, bits: 10 });
      // Y′ of the ayuv64le frame: 10-bit codes left-justified to 16 bit, so every value is a multiple of 64
      const y = [...v.frame!.filter((_, i) => i % 4 === 1)];
      expect(y.every((c) => c % 64 === 0)).toBe(true);
      expect(new Set(y).size).toBeGreaterThan(16);

      const s = await open('file:still16.tif', 'depth=16');
      expect(s.info).toMatchObject({ codec: 'tiff', pixFmt: 'rgb48le', depth: 16, sourceFps: 10 });
      // 16-bit R′G′B′: the codes are not on the 8-bit grid of a <video> element
      expect([...s.frame!].some((c) => c % 257 !== 0)).toBe(true);
    } finally { bridge.close(); }
  }, 60_000);
});

async function until(f: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!f() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  if (!f()) throw new Error('timeout');
}
