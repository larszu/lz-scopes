import { describe, expect, it } from 'vitest';
import { unpackV210, v210Bytes, v210Message } from '../src/v210';

/** Packs 4:2:2 10-bit rows into v210 (reference for the test). */
function pack(Y: number[][], Cb: number[][], Cr: number[][], w: number): Uint32Array {
  const rowWords = Math.ceil(w / 48) * 32, out = new Uint32Array(rowWords * Y.length);
  Y.forEach((y, r) => {
    const s: number[] = [];
    for (let i = 0; i < Math.ceil(w / 6) * 6; i += 2) s.push(Cb[r][i / 2] ?? 0, y[i] ?? 0, Cr[r][i / 2] ?? 0, y[i + 1] ?? 0);
    for (let k = 0; k * 3 < s.length; k++) out[r * rowWords + k] = ((s[k * 3] ?? 0) | ((s[k * 3 + 1] ?? 0) << 10) | ((s[k * 3 + 2] ?? 0) << 20)) >>> 0;
  });
  return out;
}

describe('v210 transport (#258)', () => {
  it('unpacks Y′ exactly and co-sited chroma, odd pixels interpolated', () => {
    const w = 10, h = 2;
    const Y = [Array.from({ length: w }, (_, i) => 64 + i * 80), Array.from({ length: w }, (_, i) => 940 - i)];
    const Cb = [[100, 200, 300, 400, 500], [512, 512, 512, 512, 512]], Cr = [[900, 800, 700, 600, 500], [4, 1019, 4, 1019, 4]];
    const out = unpackV210(pack(Y, Cb, Cr, w), w, h, new Uint16Array(w * h * 4));
    for (let r = 0; r < h; r++) for (let x = 0; x < w; x++) {
      const q = (r * w + x) * 4;
      expect(out[q]).toBe(65535);
      expect(out[q + 1]).toBe(Y[r][x] * 64);
      const i = x >> 1;
      const cb = x & 1 && i + 1 < 5 ? (Cb[r][i] + Cb[r][i + 1]) / 2 : Cb[r][i];
      expect(out[q + 2]).toBe(Math.round(cb * 64));
    }
    // padding: a 10-px row still takes one 128-byte block
    expect(v210Bytes(w, h)).toBe(256);
  });

  it('a message keeps its 16-byte header', () => {
    const w = 6, h = 1;
    const v = pack([[940, 940, 940, 940, 940, 940]], [[512, 512, 512]], [[512, 512, 512]], w);
    const buf = new ArrayBuffer(16 + v210Bytes(w, h));
    new Uint8Array(buf, 0, 4).set([76, 90, 86, 49]);
    new Uint32Array(buf, 16).set(v);
    const out = v210Message(buf, w, h, 16);
    expect(out.byteLength).toBe(16 + w * h * 8);
    expect([...new Uint8Array(out, 0, 4)]).toEqual([76, 90, 86, 49]);
    expect([...new Uint16Array(out, 16, 4)]).toEqual([65535, 940 * 64, 512 * 64, 512 * 64]);
  });
});
