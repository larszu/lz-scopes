import { describe, expect, it } from 'vitest';
import {
  GAMUTS, barTargets, codeValue, detectColorspace, detectTransfer, hlgInverseOetf, hlgOetf, pqDecode, pqEncode,
  rgbToXyzMatrix, ycbcr,
} from '../src/color';
import { computeStats } from '../src/sources';
// @ts-expect-error plain JS module
import { outputSize, validateInput } from '../server/index.mjs';

describe('transfer functions', () => {
  it('PQ: 100 cd/m² ≈ 50.8 %, 1000 ≈ 75.2 %, 10000 = 100 %', () => {
    expect(pqEncode(100)).toBeCloseTo(0.508, 3);
    expect(pqEncode(1000)).toBeCloseTo(0.7518, 3);
    expect(pqEncode(10000)).toBeCloseTo(1, 6);
    expect(pqDecode(pqEncode(203))).toBeCloseTo(203, 6);
  });
  it('HLG: reference white E=1/12 → 0.5, E=1 → 1, round trip', () => {
    expect(hlgOetf(1 / 12)).toBeCloseTo(0.5, 6);
    expect(hlgOetf(1)).toBeCloseTo(1, 5);
    expect(hlgInverseOetf(hlgOetf(0.3))).toBeCloseTo(0.3, 6);
  });
});

describe('matrices', () => {
  it('white has zero chroma in every matrix', () => {
    for (const cs of ['601', '709', '2020'] as const) {
      const c = ycbcr(1, 1, 1, cs);
      expect(c.y).toBeCloseTo(1, 9); expect(c.cb).toBeCloseTo(0, 9); expect(c.cr).toBeCloseTo(0, 9);
    }
  });
  it('100 % blue sits at Cb = +0.5, 100 % red at Cr = +0.5', () => {
    expect(ycbcr(0, 0, 1, '709').cb).toBeCloseTo(0.5, 9);
    expect(ycbcr(1, 0, 0, '709').cr).toBeCloseTo(0.5, 9);
    expect(barTargets('709', 0.75).find((t) => t.label === 'B')!.cb).toBeCloseTo(0.375, 9);
  });
  it('Rec.709 RGB→XYZ matches the published matrix', () => {
    const m = rgbToXyzMatrix(GAMUTS['709']);
    [0.4124, 0.3576, 0.1805, 0.2126, 0.7152, 0.0722, 0.0193, 0.1192, 0.9505].forEach((v, i) => expect(m[i]).toBeCloseTo(v, 3));
  });
  it('legal-range code values', () => {
    expect(codeValue(0, 8)).toBe(16); expect(codeValue(1, 8)).toBe(235);
    expect(codeValue(0, 10)).toBe(64); expect(codeValue(1, 10)).toBe(940);
  });
  it('detects HDR metadata from ffprobe', () => {
    expect(detectTransfer('smpte2084')).toBe('pq');
    expect(detectTransfer('arib-std-b67')).toBe('hlg');
    expect(detectTransfer('bt709')).toBe('sdr');
    expect(detectColorspace('bt2020nc', 'bt2020')).toBe('2020');
    expect(detectColorspace('unknown', 'unknown', 480)).toBe('601');
  });
});

describe('stats', () => {
  it('counts clipping and luma range', () => {
    const px = new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]);
    const s = computeStats(px, 2, 1, 1, 255, 0.2126, 0.0722);
    expect(s.yMax).toBe(1); expect(s.yMin).toBe(0);
    expect(s.clipHigh).toEqual([0.5, 0.5, 0.5]); expect(s.clipLow).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('bridge', () => {
  it('accepts network URLs and test patterns only', () => {
    expect(validateInput('rtsp://10.0.0.5:554/stream1')).toBeNull();
    expect(validateInput('srt://host:9000')).toBeNull();
    expect(validateInput('test:bars')).toBeNull();
    expect(validateInput('/etc/passwd')).not.toBeNull();
    expect(validateInput('file:///etc/passwd')).not.toBeNull();
    expect(validateInput('-f lavfi')).not.toBeNull();
    expect(validateInput('concat:a|b')).not.toBeNull();
  });
  it('scales to even dimensions keeping aspect', () => {
    expect(outputSize(1920, 1080, 960)).toEqual({ width: 960, height: 540 });
    expect(outputSize(720, 576, 960)).toEqual({ width: 720, height: 576 });
    expect(outputSize(1920, 1080, 0)).toEqual({ width: 1920, height: 1080 });
    expect(outputSize(1280, 721, 1000)).toEqual({ width: 1000, height: 562 });
  });
});

describe('bridge decode matrix', () => {
  it('never lets swscale fall back to BT.601 for untagged HD', async () => {
    // @ts-expect-error plain JS module
    const { decodeParams } = await import('../server/index.mjs');
    expect(decodeParams({ matrix: 'unknown', height: 1080 })).toEqual({ decodeMatrix: 'bt709', decodeRange: 'limited' });
    expect(decodeParams({ matrix: 'unknown', height: 576 }).decodeMatrix).toBe('bt601');
    expect(decodeParams({ matrix: 'bt2020nc', height: 2160, range: 'tv' }).decodeMatrix).toBe('bt2020');
    expect(decodeParams({ matrix: 'bt709', height: 1080, range: 'pc' }).decodeRange).toBe('full');
  });
});
