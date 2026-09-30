import { describe, expect, it } from 'vitest';
import { LUMA } from '../src/color';
import { OUT10_HEADER, codeToValue, f16, frame10Buffer, fullToCodeValue, pixelsToFrame10, ramp10Raster, rasterToFrame10, via8bit, yuv10 } from '../src/deep';
import { bt2111Raster, plugeRaster } from '../src/patterns16';

const planes = (buf: ArrayBuffer, w: number, h: number) => ({
  y: new Uint16Array(buf, OUT10_HEADER, w * h),
  cb: new Uint16Array(buf, OUT10_HEADER + w * h * 2, (w * h) / 2),
  cr: new Uint16Array(buf, OUT10_HEADER + w * h * 3, (w * h) / 2),
});

describe('float16 carries 10 bit', () => {
  it('every full-range code 0…1023 survives code/1023 → float16 → ×1023', () => {
    for (let c = 0; c < 1024; c++) expect(Math.round(f16(c / 1023) * 1023)).toBe(c);
  });
  it('every narrow code 64…940 survives as level (c−64)/876', () => {
    for (let c = 64; c <= 940; c++) expect(Math.round(f16((c - 64) / 876) * 876 + 64)).toBe(c);
  });
  it('codes 1:1 keep sub-black and super-white (BT.2111: 4, 48, 1019)', () => {
    for (const c of [4, 48, 64, 940, 1019]) expect(Math.round(f16(codeToValue(c, false, 'code')) * 1023)).toBe(c);
  });
});

describe('level mapping', () => {
  it('levels: 64 → 0, 940 → 1, below/above clipped', () => {
    expect(codeToValue(64, false, 'full')).toBe(0);
    expect(codeToValue(940, false, 'full')).toBe(1);
    expect(codeToValue(48, false, 'full')).toBe(0);
    expect(codeToValue(1019, false, 'full')).toBe(1);
    expect(codeToValue(1023, true, 'full')).toBe(1);
  });
  it('fullToCodeValue maps 0 % / 100 % to 64 / 940', () => {
    expect(fullToCodeValue(0) * 1023).toBeCloseTo(64, 9);
    expect(fullToCodeValue(1) * 1023).toBeCloseTo(940, 9);
  });
  it('an 8-bit path merges groups of 4 codes', () => {
    const set = new Set<number>();
    for (let c = 384; c < 640; c++) set.add(via8bit(c));
    expect(set.size).toBe(64);
    expect(via8bit(0)).toBe(0);
    expect(via8bit(1023)).toBe(1023);
  });
});

describe('10-bit ramp (banding test)', () => {
  const w = 1920, h = 1080, r = ramp10Raster(w, h);
  const row = (y: number) => new Set(Array.from({ length: w }, (_, x) => r.at(x, y)[0]));
  it('band 1: all 1024 codes, 0 at the left, 1023 at the right', () => {
    expect(row(10).size).toBe(1024);
    expect(r.at(0, 10)[0]).toBe(0);
    expect(r.at(w - 1, 10)[0]).toBe(1023);
  });
  it('band 2: 256 codes in 10 bit, 64 after the 8-bit path', () => {
    expect(row(280).size).toBe(256);
    expect(row(520).size).toBe(64);
  });
  it('band 4: patches 504…519 one code apart; 8-bit half in groups', () => {
    expect([...row(830)].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => 504 + i));
    expect(row(1070).size).toBeLessThanOrEqual(5);
  });
});

describe('10-bit Y′CbCr (BT.2100-3 Tab. 9)', () => {
  const { kr, kb } = LUMA['709'];
  it('narrow white/black and full white', () => {
    expect(yuv10(1, 1, 1, kr, kb, false)).toEqual([940, 512, 512]);
    expect(yuv10(0, 0, 0, kr, kb, false)).toEqual([64, 512, 512]);
    expect(yuv10(1, 1, 1, kr, kb, true)).toEqual([1023, 512, 512]);
  });
  it('BT.709 100 % red = 250 / 409 / 960', () => {
    expect(yuv10(1, 0, 0, kr, kb, false)).toEqual([250, 409, 960]);
  });
  it('header layout', () => {
    const f = frame10Buffer({ w: 4, h: 2, full: true, colorspace: '2020', transfer: 'hlg' });
    const d = new DataView(f.buf);
    expect(String.fromCharCode(d.getUint8(0), d.getUint8(1), d.getUint8(2), d.getUint8(3))).toBe('LZ10');
    expect([d.getUint16(4, true), d.getUint16(6, true), d.getUint8(8), d.getUint8(9), d.getUint8(10)]).toEqual([4, 2, 1, 1, 2]);
    expect(f.buf.byteLength).toBe(OUT10_HEADER + 4 * 2 * 4);
  });
  it('BT.2111-3 HLG: ramp and step row give their exact codes as Y′ (4 … 1019), chroma 512', () => {
    const w = 1920, h = 1080, r = bt2111Raster('hlg', w, h);
    const p = planes(rasterToFrame10(r, false, '2020', 'hlg'), w, h);
    for (const y of [650, 760]) {
      for (let x = 0; x < w; x++) {
        const [c] = r.at(x, y);
        expect(p.y[y * w + x]).toBe(c);
        if (!(x & 1)) { expect(p.cb[(y * w + x) >> 1]).toBe(512); expect(p.cr[(y * w + x) >> 1]).toBe(512); }
      }
    }
    expect(p.y[760 * w + 240]).toBe(4);
    expect(p.y[760 * w + w - 1]).toBe(1019);
  });
  it('BT.814 PLUGE keeps −2 % (48) and +2 % (80)', () => {
    const w = 1920, h = 1080, p = planes(rasterToFrame10(plugeRaster(w, h, 940), false, '709', 'sdr'), w, h);
    expect(new Set(p.y)).toEqual(new Set([64, 48, 80, 940]));
  });
  it('float16 canvas pixels of narrow grey codes come back exact', () => {
    const w = 878, h = 1, px = new Float32Array(w * 4);
    for (let x = 0; x < w; x++) { const v = f16((64 + x - 64) / 876); px[x * 4] = px[x * 4 + 1] = px[x * 4 + 2] = v; px[x * 4 + 3] = 1; }
    const p = planes(pixelsToFrame10(px, w, h, '709', 'sdr'), w, h);
    for (let x = 0; x < 877; x++) expect(p.y[x]).toBe(64 + x);
  });
});
