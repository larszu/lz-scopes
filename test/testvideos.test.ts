import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { ALLOWED_PREFIXES, TEST_VIDEOS } from '../src/testVideoCatalog';

const { unzipSingle } = createRequire(import.meta.url)('../electron/unzip.cjs') as { unzipSingle: (zip: string, out: string, e: { size: number; crc32: string }) => Promise<void> };

describe('test video catalogue (#52)', () => {
  it('every entry: official host, SHA-256, size, licence with attribution', () => {
    const ids = new Set<string>();
    for (const v of TEST_VIDEOS) {
      expect(ids.has(v.id), v.id).toBe(false); ids.add(v.id);
      expect(ALLOWED_PREFIXES.some((p) => v.url.startsWith(p)), v.url).toBe(true);
      expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(v.sha256).not.toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'); // empty stream
      expect(v.bytes).toBeGreaterThan(1e6);
      expect(['CC BY 3.0', 'CC BY 4.0']).toContain(v.licence);
      expect(v.attribution.length).toBeGreaterThan(20);
      if (v.url.endsWith('.zip')) expect(v.zip?.crc32).toMatch(/^[0-9a-f]{8}$/);
      if (v.hdr) expect([v.transfer, v.gamut]).toEqual(['pq', 'p3']);
    }
  });
  it('Big Buck Bunny in several resolutions and versions, HDR titles present', () => {
    const bbb = TEST_VIDEOS.filter((v) => v.title === 'Big Buck Bunny');
    expect(new Set(bbb.map((v) => v.height)).size).toBeGreaterThanOrEqual(5);
    expect(bbb.some((v) => v.version.startsWith('2013'))).toBe(true);
    expect(TEST_VIDEOS.filter((v) => v.hdr).length).toBeGreaterThanOrEqual(2);
  });
});

// minimal single-entry ZIP (local header + data) as the Blender files are laid out
function zip(name: string, data: Buffer, method: 0 | 8) {
  const body = method === 8 ? deflateRawSync(data) : data;
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0, 6); h.writeUInt16LE(method, 8);
  h.writeUInt32LE(crc32(data), 14); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22);
  h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
  return Buffer.concat([h, Buffer.from(name), body, Buffer.from('PK\x01\x02 central directory follows')]);
}

describe('single-entry ZIP extraction (electron/unzip.cjs)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lzs-zip-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const data = Buffer.from(Array.from({ length: 200_000 }, (_, i) => (i * 7) % 251));
  const expectOk = { size: data.length, crc32: crc32(data).toString(16).padStart(8, '0') };
  for (const method of [0, 8] as const) {
    it(`method ${method}: content, size and CRC-32`, async () => {
      const z = join(dir, `m${method}.zip`), out = join(dir, `m${method}.bin`);
      writeFileSync(z, zip('clip.mp4', data, method));
      await unzipSingle(z, out, expectOk);
      expect(readFileSync(out).equals(data)).toBe(true);
    });
  }
  it('refuses a wrong CRC-32', async () => {
    const z = join(dir, 'bad.zip');
    writeFileSync(z, zip('clip.mp4', data, 8));
    await expect(unzipSingle(z, join(dir, 'bad.bin'), { ...expectOk, crc32: '00000000' })).rejects.toThrow(/CRC/);
  });
});
