import { describe, expect, it } from 'vitest';
import { unpackV210, v210At, v210Bytes, v210Decoder, v210Luma, v210MeanLuma, v210Message, v210RowWords, v210Sample } from '../src/v210';
import { yuvDecoder } from '../src/ycbcr';
import { meanLuma } from '../src/luma';
import { drawStamp, readStamp } from '../server/stamp.mjs';

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

  // the packed readers (#258 step 2): same values as the unpacked layout, for every pixel
  const rnd = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) >>> 0) >>> 8) / 2 ** 24;
  function random(w: number, h: number) {
    const r = rnd(w * 7 + h), n = (w + 1) >> 1;
    const Y = Array.from({ length: h }, () => Array.from({ length: w }, () => 4 + Math.floor(r() * 1016)));
    const Cb = Array.from({ length: h }, () => Array.from({ length: n }, () => 4 + Math.floor(r() * 1016)));
    const Cr = Array.from({ length: h }, () => Array.from({ length: n }, () => 4 + Math.floor(r() * 1016)));
    return pack(Y, Cb, Cr, w);
  }
  for (const w of [6, 13, 48, 50, 97]) {
    it(`v210Sample, v210At and v210Decoder match unpackV210 (width ${w})`, () => {
      const h = 3, src = random(w, h), ref = unpackV210(src, w, h, new Uint16Array(w * h * 4));
      expect(src.length).toBe(v210RowWords(w) * h);
      const at = v210At(src, w), d = [0, 0, 0];
      const coding = { full: false, bits: 10 }, kr = 0.2126, kb = 0.0722;
      const dec = v210Decoder(w, kr, kb, coding), ref2 = yuvDecoder(kr, kb, coding);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const q = (y * w + x) * 4;
        expect(v210Sample(src, w, x, y, d)).toEqual([ref[q + 1], ref[q + 2], ref[q + 3]]);
        expect(v210Luma(src, w, x, y)).toBe(ref[q + 1]);
        for (let c = 0; c < 4; c++) expect(at(q + c)).toBe(ref[q + c]);
        const a = dec(src, q), b = ref2(ref, q);
        for (let c = 0; c < 3; c++) expect(a[c]).toBeCloseTo(b[c], 12);
      }
    });
  }

  it('v210MeanLuma equals meanLuma of the unpacked picture', () => {
    const w = 1920, h = 40, src = random(w, h), ref = unpackV210(src, w, h, new Uint16Array(w * h * 4));
    expect(v210MeanLuma(src, w, h)).toBeCloseTo(meanLuma(ref, w, h, 65535, true), 12);
  });

  it('the latency stamp reads from a packed picture', () => {
    const w = 1920, h = 1080, rgba = new Uint8Array(w * h * 4);
    drawStamp(rgba, w, h, 123456789, 42);
    const n = w / 2;
    const grey = Array(n).fill(512), rows: number[][] = [], cbs: number[][] = [];
    for (let y = 0; y < h; y++) { rows.push(Array.from({ length: w }, (_, x) => (rgba[(y * w + x) * 4 + 1] > 127 ? 940 : 64))); cbs.push(grey); }
    const words = pack(rows, cbs, cbs, w);
    expect(readStamp(v210At(words, w), w, h, 65535)).toEqual({ ms: 123456789, counter: 42 });
  });
});
