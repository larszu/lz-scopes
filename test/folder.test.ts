import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { applyDecodeOverride, deviceOptions } from '../server/devices.mjs';
// @ts-expect-error plain JS module
import { newestStill, resolveFolder, startFolderStream, watchRoots } from '../server/folder.mjs';
// @ts-expect-error plain JS module
import { decodeParams, ffmpegCandidates, outputSize, validateInput } from '../server/index.mjs';

const dir = mkdtempSync(join(tmpdir(), 'lzs-watch-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('bridge watch folders', () => {
  it('only released folders, addressed by name', () => {
    const roots = watchRoots(['--port', '1', '--watch-dir', '/data/Exports', '--watch-dir', '/other/Exports'], { LZS_WATCH_DIRS: '' });
    expect(roots.map((r: { name: string }) => r.name)).toEqual(['Exports', 'Exports-2']);
    expect(resolveFolder('folder:Exports-2', roots)?.dir).toMatch(/other/);
    expect(resolveFolder('folder:../etc', roots)).toBeNull();
    expect(validateInput('folder:Exports')).toBeNull();
    expect(validateInput('folder:../../etc')).not.toBeNull();
  });
  it('newest still by modification time; other files ignored', async () => {
    writeFileSync(join(dir, 'a.tif'), 'x'); utimesSync(join(dir, 'a.tif'), 1000, 1000);
    writeFileSync(join(dir, 'b.DPX'), 'x'); utimesSync(join(dir, 'b.DPX'), 2000, 2000);
    writeFileSync(join(dir, 'c.txt'), 'x'); utimesSync(join(dir, 'c.txt'), 3000, 3000);
    writeFileSync(join(dir, '.hidden.png'), 'x'); utimesSync(join(dir, '.hidden.png'), 4000, 4000);
    expect((await newestStill(dir)).name).toBe('b.DPX');
    for (const f of ['a.tif', 'b.DPX', 'c.txt', '.hidden.png']) rmSync(join(dir, f));
  });

  const ffmpeg = ffmpegCandidates()[0];
  it.skipIf(!ffmpeg)('16-bit TIFF and 10-bit DPX arrive with full precision', async () => {
    // 16-bit grey 0x8000 (TIFF, rgb48) and 10-bit 512 (DPX) → both ≈ 0.5 in rgba64le
    const raw = Buffer.alloc(64 * 36 * 6);
    for (let i = 0; i < raw.length; i += 2) raw.writeUInt16LE(0x8000, i);
    writeFileSync(join(dir, 'grey.rgb48'), raw);
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb48le', '-s', '64x36', '-i', join(dir, 'grey.rgb48'), '-pix_fmt', 'rgb48le', join(dir, 'still.tif')]);
    rmSync(join(dir, 'grey.rgb48'));
    const got: { info: Record<string, unknown>[]; frames: Uint16Array[] } = { info: [], frames: [] };
    const ws = Object.assign(new EventEmitter(), {
      OPEN: 1, readyState: 1,
      send(d: Buffer | string) {
        if (typeof d === 'string') { const m = JSON.parse(d); if (m.type === 'info') got.info.push(m); return; }
        got.frames.push(new Uint16Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.length)));
      },
    });
    startFolderStream(ws, {
      root: { name: 'test', dir }, params: new URLSearchParams('width=0&depth=16'), pollMs: 100,
      ctx: { ffmpeg, outputSize, decodeParams, applyDecodeOverride, deviceOptions },
    });
    const wait = async (n: number) => { for (let i = 0; i < 80 && got.frames.length < n; i++) await new Promise((r) => setTimeout(r, 100)); };
    await wait(1);
    expect(got.info[0]).toMatchObject({ width: 64, height: 36, depth: 16, decodeMatrix: 'rgb' });
    expect(got.frames[0][0]).toBe(0x8000);
    // a newer DPX replaces it
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x808080:s=32x18,format=gbrp10le', '-frames:v', '1', '-pix_fmt', 'gbrp10le', join(dir, 'next.dpx')]);
    await wait(2);
    ws.emit('close');
    expect(got.info.at(-1)).toMatchObject({ width: 32, height: 18, sourceWidth: 32 });
    // 0x80 in 8 bit → 514 in 10 bit (bit replication) → 514/1023 in 16 bit
    expect(Math.abs(got.frames.at(-1)![0] / 65535 - 514 / 1023)).toBeLessThan(0.002);
  }, 20000);
});
