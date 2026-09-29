import { describe, expect, it } from 'vitest';
import { LUMA } from '../src/color';
import { R103, decodeYuv, encodeYuv, r103Check, rgbDecoder, yuvDecoder, yuvScale } from '../src/ycbcr';
import { BT2111, bt2111Raster, level10, plugeRaster, toFrame16 } from '../src/patterns16';
// @ts-expect-error plain JS module
import { yuvParams } from '../server/index.mjs';

// Sources: ITU-R BT.2100-3 Tab. 9 (p11), BT.2111-3 Tab. 1–6, EBU R 103 v3.0 Tab. 1 (p5),
// BT.814-4 Tab. 2–5; see docs/research/ebu-video.md.

const narrow = { full: false, bits: 10 };
const { kr, kb } = LUMA['2020'];

describe('Y′CbCr decode (BT.2100 quantisation, codes left-justified to 16 bit)', () => {
  it('narrow range: 64/940 = 0/100 %, 4 = −6.85 %, 1019 = 109.02 %, chroma 512 = 0', () => {
    const at = (d10: number) => decodeYuv(d10 * 64, 512 * 64, 512 * 64, kr, kb, narrow)[1];
    expect(at(64)).toBeCloseTo(0, 12);
    expect(at(940)).toBeCloseTo(1, 12);
    expect(at(4)).toBeCloseTo(-60 / 876, 12);
    expect(at(1019)).toBeCloseTo(955 / 876, 12);
    // what ffmpeg 9.0.1 delivers for 10-bit 943 (checked: 60352) is 943 in 10-bit terms
    expect(at(60352 / 64)).toBeCloseTo((943 - 64) / 876, 12);
  });
  it('full range n bit: D/(2^n−1), chroma offset 2^(n−1)', () => {
    const s = yuvScale({ full: true, bits: 10 });
    expect(s.yScale).toBe(1023 * 64); expect(s.cOff).toBe(512 * 64);
    expect(decodeYuv(1023 * 64, 512 * 64, 512 * 64, kr, kb, { full: true, bits: 10 })[0]).toBeCloseTo(1, 12);
    // 8-bit full 255 → 65280 in ffmpeg (checked) → 100 %
    expect(decodeYuv(65280, 128 * 256, 128 * 256, kr, kb, { full: true, bits: 8 })[2]).toBeCloseTo(1, 12);
  });
  it('encode → decode keeps values outside 0…100 % (no clamp)', () => {
    for (const c of [[-0.07, 0.5, 1.09], [1.05, -0.05, 0.2], [0.75, 0.75, 0]]) {
      const [Y, Cb, Cr] = encodeYuv(c[0], c[1], c[2], kr, kb, narrow);
      decodeYuv(Y, Cb, Cr, kr, kb, narrow).forEach((v, i) => expect(v).toBeCloseTo(c[i], 4));
    }
  });
  it('the packed decoder reads A, Y′, Cb, Cr', () => {
    const d = yuvDecoder(kr, kb, narrow);
    expect(d([65535, 940 * 64, 512 * 64, 512 * 64], 0)).toEqual(decodeYuv(940 * 64, 512 * 64, 512 * 64, kr, kb, narrow));
  });
});

describe('BT.2111-3 HDR bars as 16-bit frames', () => {
  const back = (kind: 'hlg' | 'pq' | 'pqfull', x: number, y: number) => {
    const full = BT2111[kind].full, r = bt2111Raster(kind, 1920, 1080), f = toFrame16(r, full, '2020');
    const dec = yuvDecoder(kr, kb, f.coding)(f.data, (y * 1920 + x) * 4);
    // back to 10-bit codes
    return dec.map((v) => (full ? v * 1023 : v * 876 + 64));
  };
  it('HLG narrow (Tab. 2): 75 % white 721, −7 % step 4, 109 % step 1019, −2 % black 48, BT.709 yellow 713/719/316', () => {
    back('hlg', 240 + 103, 300).forEach((v) => expect(v).toBeCloseTo(721, 1)); // 75 % white bar
    back('hlg', 240 + 100, 675).forEach((v) => expect(v).toBeCloseTo(4, 1)); // −7 % step
    back('hlg', 1680 - 50, 675).forEach((v) => expect(v).toBeCloseTo(1019, 1)); // 109 % step (right half of blue)
    back('hlg', 240 + 136 + 35, 950).forEach((v) => expect(v).toBeCloseTo(48, 1)); // −2 % black
    back('hlg', 240 + 136 + 70 + 68 + 70 + 68 + 35, 950).forEach((v) => expect(v).toBeCloseTo(99, 1)); // +4 % black
    const y709 = back('hlg', 40, 950);
    [713, 719, 316].forEach((c, i) => expect(y709[i]).toBeCloseTo(c, 1));
  });
  it('ramp (Fig. 5, Tab. 5): B = 559 px at 4, then one code per pixel from 5, D = 107 px at 1019', () => {
    const r = bt2111Raster('hlg', 1920, 1080), row = 760;
    expect(r.at(240, row)[0]).toBe(4); expect(r.at(240 + 558, row)[0]).toBe(4);
    expect(r.at(240 + 559, row)[0]).toBe(5); expect(r.at(240 + 559 + 1013, row)[0]).toBe(1018);
    expect(r.at(240 + 559 + 1014, row)[0]).toBe(1019); expect(r.at(1919, row)[0]).toBe(1019);
    // 0 % (64) sits at the left edge of the green bar: x = 240 + 3·206 = 858 (Attachment 1)
    expect(r.at(858, row)[0]).toBe(64);
  });
  it('PQ full (Tab. 4, 6): 58 % = 594, ramp B = 618 at 0, D = 40 at 1023, +2 % black 19, no −2 %', () => {
    back('pqfull', 240 + 103, 300).forEach((v) => expect(v).toBeCloseTo(594, 1));
    const r = bt2111Raster('pqfull', 1920, 1080);
    expect(r.at(240 + 617, 760)[0]).toBe(0); expect(r.at(240 + 618, 760)[0]).toBe(1);
    expect(r.at(1920 - 40, 760)[0]).toBe(1023); expect(r.at(1920 - 41, 760)[0]).toBe(1022);
    expect(r.at(240 + 136 + 35, 950)[0]).toBe(0);
    expect(r.at(240 + 136 + 70 + 68 + 35, 950)[0]).toBe(19);
  });
  it('PQ narrow (Tab. 3): 58 % = 573, BT.709 blue 318/236/563', () => {
    back('pq', 240 + 103, 300).forEach((v) => expect(v).toBeCloseTo(573, 1));
    const b = back('pq', 1920 - 40, 950);
    [318, 236, 563].forEach((c, i) => expect(b[i]).toBeCloseTo(c, 1));
  });
  it('the 8-bit level of a code clips −7 %, the 16-bit frame does not', () => {
    expect(Math.max(0, level10(4, false))).toBe(0);
    expect(level10(4, false)).toBeLessThan(-0.06);
  });
});

describe('BT.814-4 PLUGE as 16-bit frame', () => {
  it('keeps the −2 % stripes (48) below black', () => {
    const r = plugeRaster(1920, 1080, 940);
    // right broad darker box: samples 1320–1607, lines 654–797 → rows 612–755
    expect(r.at(1400, 700)[0]).toBe(48);
    expect(r.at(1400, 400)[0]).toBe(80);
    expect(r.at(10, 10)[0]).toBe(64);
    const f = toFrame16(r, false, '709'), { kr: r7, kb: b7 } = LUMA['709'];
    expect(yuvDecoder(r7, b7, f.coding)(f.data, (700 * 1920 + 1400) * 4)[1]).toBeCloseTo(-16 / 876, 4);
  });
});

describe('EBU R 103 v3.0 check', () => {
  const frame = (w: number, h: number, fn: (x: number, y: number) => number) => {
    const px = new Float32Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = fn(x, y); px.set([v, v, v, 1], (y * w + x) * 4); }
    return px;
  };
  const dec = rgbDecoder(1);
  it('limits come from the 10-bit codes of Tab. 1: 20–984 and 4–1019', () => {
    expect(R103.prefLo * 876 + 64).toBeCloseTo(20, 9); expect(R103.prefHi * 876 + 64).toBeCloseTo(984, 9);
    expect(R103.totalLo * 876 + 64).toBeCloseTo(4, 9); expect(R103.totalHi * 876 + 64).toBeCloseTo(1019, 9);
  });
  it('the measurement filter removes a single-pixel spike (1/16…1/16 × 1/4-1/2-1/4)', () => {
    // one pixel at 120 % on 100 %: filtered peak = 1 + 0.2 · 4/16 · 2/4 = 1.025 → inside 105 %
    const r = r103Check(frame(40, 20, (x, y) => (x === 20 && y === 10 ? 1.2 : 1)), 40, 20, dec, kr, kb);
    expect(r.max[0]).toBeCloseTo(1.025, 6);
    expect(r.pref).toBe(0);
  });
  it('reports only above 1 % of the area', () => {
    // 100×100, a 10 px wide column at 110 %: ~10 % of the area outside → alarm
    const wide = r103Check(frame(100, 100, (x) => (x >= 40 && x < 50 ? 1.1 : 0.5)), 100, 100, dec, kr, kb);
    expect(wide.alarm).toBe(true);
    // a 4×2 block at 115 % on 100 %: after filtering (peak 1 + 0.15·12/16·3/4) some pixels stay above 105 %, far below 1 %
    const small = r103Check(frame(100, 100, (x, y) => (x >= 40 && x < 44 && y >= 50 && y < 52 ? 1.15 : 1)), 100, 100, dec, kr, kb);
    expect(small.pref).toBeGreaterThan(0);
    expect(small.pref).toBeLessThan(0.01);
    expect(small.alarm).toBe(false);
  });
  it('flags the total range separately (−7 % step of BT.2111 is outside 4…1019? no: exactly 4 is inside)', () => {
    const at4 = r103Check(frame(20, 20, () => R103.totalLo), 20, 20, dec, kr, kb);
    expect(at4.total).toBe(0);
    expect(at4.pref).toBe(1);
    const below = r103Check(frame(20, 20, () => R103.totalLo - 0.01), 20, 20, dec, kr, kb);
    expect(below.total).toBe(1);
  });
});

describe('bridge format=yuv', () => {
  it('scales without range or matrix conversion and reads the bit depth from pix_fmt', () => {
    const p = yuvParams({ pixFmt: 'yuv422p10le' }, 'bt2020', 'limited');
    expect(p).toMatchObject({ yuv: true, bits: 10, range: 'limited' });
    expect(p.scale).toContain('in_range=limited:out_range=limited');
    expect(yuvParams({ pixFmt: 'yuvj420p' }, 'bt709', 'limited')).toMatchObject({ yuv: true, bits: 8, range: 'full' });
    expect(yuvParams({ pixFmt: 'gbrp10le' }, 'bt709', 'limited').yuv).toBe(false);
  });
});
