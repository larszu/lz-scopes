import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FlvH264Demuxer, avcCodecString, toAnnexB } from '../server/flv.mjs';
import { drawStamp, readStamp, stampAge, stampBits } from '../server/stamp.mjs';
import { statsFromReduction } from '../src/gpuStats';
import { computeStats } from '../src/sources';
import { yuv420ToRgba } from '../src/yuv';

describe('Latenz-Stempel', () => {
  it('liest Zeit und Zähler zurück, auch nach Skalierung', () => {
    const w = 1280, h = 720, px = new Uint8Array(w * h * 4).fill(128);
    drawStamp(px, w, h, 1_759_190_400_123, 4711);
    expect(readStamp(px, w, h)).toEqual({ ms: 1_759_190_400_123 % 2 ** 32, counter: 4711 });
    // nearest-neighbour downscale to 640×360 (the bridge's smallest analysis width)
    const w2 = 640, h2 = 360, small = new Uint8Array(w2 * h2 * 4);
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) small.set(px.subarray(((y * 2) * w + x * 2) * 4, ((y * 2) * w + x * 2) * 4 + 4), (y * w2 + x) * 4);
    expect(readStamp(small, w2, h2)?.counter).toBe(4711);
  });
  it('16-bit-Samples', () => {
    const w = 960, h = 540, px8 = new Uint8Array(w * h * 4);
    drawStamp(px8, w, h, 123456, 7);
    const px16 = Uint16Array.from(px8, (v) => v * 257);
    expect(readStamp(px16, w, h, 65535)).toEqual({ ms: 123456, counter: 7 });
  });
  it('verwirft Bilder ohne Stempel und mit gekipptem Bit', () => {
    const w = 960, h = 540;
    expect(readStamp(new Uint8Array(w * h * 4), w, h)).toBeNull();
    expect(readStamp(new Uint8Array(w * h * 4).fill(255), w, h)).toBeNull();
    const px = new Uint8Array(w * h * 4);
    drawStamp(px, w, h, 99999, 3);
    // flip one time bit (row 1, block 31): the check byte no longer matches
    const bh = Math.round(h / 24), bw = w / 32;
    for (let y = bh; y < 2 * bh; y++) for (let x = Math.ceil(31 * bw); x < w; x++) px[(y * w + x) * 4 + 1] ^= 255;
    expect(readStamp(px, w, h)).toBeNull();
  });
  it('64 Bit mit Sync-Wort 0xB4', () => {
    const b = stampBits(0, 0);
    expect(b).toHaveLength(64);
    expect(b.slice(0, 8).join('')).toBe('10110100');
  });
  it('Alter über den 2^32-Überlauf', () => {
    expect(stampAge(4_294_967_290, 2 ** 32 + 10)).toBe(16);
    expect(stampAge(1000, 1080)).toBe(80);
    expect(stampAge(1080, 1000)).toBe(-80);
  });
});

describe('FLV → H.264 Annex B', () => {
  // fixture: ffmpeg -f lavfi -i testsrc2=size=160x90:rate=25 -frames:v 5 -c:v libx264
  //          -preset ultrafast -tune zerolatency -bf 0 -g 3 -pix_fmt yuv420p -f flv
  const flv = readFileSync(new URL('./fixtures/testsrc-h264.flv', import.meta.url));
  const run = (chunk: number) => {
    const cfg: string[] = [], frames: { key: boolean; pts: number; data: Buffer }[] = [];
    const d = new FlvH264Demuxer((c: { codec: string }) => cfg.push(c.codec), (f: { key: boolean; pts: number; data: Buffer }) => frames.push(f));
    for (let i = 0; i < flv.length; i += chunk) d.push(flv.subarray(i, i + chunk));
    return { cfg, frames };
  };
  it('ein Access Unit je Bild, SPS/PPS vor Keyframes, Zeitstempel 40 ms', () => {
    const { cfg, frames } = run(flv.length);
    expect(cfg).toEqual(['avc1.42c00b']);
    expect(frames.map((f) => f.key)).toEqual([true, false, false, true, false]);
    expect(frames.map((f) => f.pts)).toEqual([0, 40, 80, 120, 160]);
    const nalType = (b: Buffer) => b[4] & 0x1f;
    expect(nalType(frames[0].data)).toBe(7); // SPS first
    expect(nalType(frames[1].data)).toBe(1); // non-IDR slice
    // every NAL starts with a 4-byte start code
    expect([...frames[0].data.subarray(0, 4)]).toEqual([0, 0, 0, 1]);
  });
  it('gleiches Ergebnis bei zerstückelten Pipe-Lesungen', () => {
    const a = run(flv.length), b = run(7);
    expect(b.frames.map((f) => f.data.toString('hex'))).toEqual(a.frames.map((f) => f.data.toString('hex')));
  });
  it('Codec-String nach RFC 6381 und Längenpräfix → Startcode', () => {
    expect(avcCodecString(0x64, 0x00, 0x1f)).toBe('avc1.64001f');
    const out = toAnnexB(Buffer.from([0, 0, 0, 2, 0x65, 0xaa, 0, 0, 0, 1, 0x41]), 4);
    expect([...out]).toEqual([0, 0, 0, 1, 0x65, 0xaa, 0, 0, 0, 1, 0x41]);
  });
});

describe('Y′CbCr 4:2:0 → R′G′B′', () => {
  // 75 % red in 8-bit narrow range from the BT.709 equations: Y′ = 0.75·0.2126 → 16 + 219·0.15945 = 51,
  // Cb = −Y′/1.8556 → 128 − 224·0.0859 = 109, Cr = (0.75 − Y′)/1.5748 → 128 + 224·0.375 = 212
  // (the same codes as the 75 % bars of SMPTE RP 219). BT.601: Y′ 65, Cb 100, Cr 212.
  const one = (y: number, u: number, v: number, m: string, full = false) => {
    const w = 2, h = 2;
    return [...yuv420ToRgba({ y: new Uint8Array(4).fill(y), u: new Uint8Array([u]), v: new Uint8Array([v]), strideY: w, strideU: 1, strideV: 1 }, w, h, m, full).subarray(0, 4)];
  };
  it('75 % Rot, Weiß, Schwarz (BT.709, schmal)', () => {
    one(51, 109, 212, 'bt709').slice(0, 3).forEach((c, i) => expect(Math.abs(c - [191, 0, 0][i])).toBeLessThanOrEqual(2));
    expect(one(235, 128, 128, 'bt709')).toEqual([255, 255, 255, 255]);
    expect(one(16, 128, 128, 'bt709')).toEqual([0, 0, 0, 255]);
  });
  it('75 % Rot BT.601 und volle Aussteuerung', () => {
    one(65, 100, 212, 'bt601').slice(0, 3).forEach((c, i) => expect(Math.abs(c - [191, 0, 0][i])).toBeLessThanOrEqual(2));
    expect(one(128, 128, 128, 'bt709', true)).toEqual([128, 128, 128, 255]);
  });
  it('NV12 (Cb/Cr verschränkt) = I420', () => {
    const y = new Uint8Array([60, 70, 80, 90]);
    const i420 = yuv420ToRgba({ y, u: new Uint8Array([100]), v: new Uint8Array([200]), strideY: 2, strideU: 1, strideV: 1 }, 2, 2, 'bt709');
    const nv12 = yuv420ToRgba({ y, u: new Uint8Array([100, 200]), v: new Uint8Array(0), strideY: 2, strideU: 2, strideV: 0, nv12: true }, 2, 2, 'bt709');
    expect([...nv12]).toEqual([...i420]);
  });
});

describe('GPU-Statistik: Auswertung der Reduktion', () => {
  // CPU emulation of the shader in src/gpuStats.ts, compared with computeStats (the CPU path)
  it('gleiche Werte wie computeStats', () => {
    const w = 64, h = 32, px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { px[i * 4] = (i * 7) % 256; px[i * 4 + 1] = (i * 13) % 256; px[i * 4 + 2] = i % 3 ? 255 : 0; px[i * 4 + 3] = 255; }
    const kr = 0.2126, kb = 0.0722, kg = 1 - kr - kb;
    const red = new Float32Array(256 * 3 * 4);
    for (let i = 0; i < w * h; i++) {
      const c = [px[i * 4] / 255, px[i * 4 + 1] / 255, px[i * 4 + 2] / 255], Y = kr * c[0] + kg * c[1] + kb * c[2];
      [...c, Y].forEach((v, ch) => { red[Math.min(255, Math.max(0, Math.floor(v * 255 + 0.5))) * 4 + ch] += 1; });
      const cell = (256 + (i % 64)) * 4;
      red[cell] += c[0]; red[cell + 1] += c[1]; red[cell + 2] += c[2]; red[cell + 3] += 1;
      red[512 * 4] = Math.max(red[512 * 4], Y); red[512 * 4 + 1] = Math.max(red[512 * 4 + 1], 1 - Y);
    }
    const g = statsFromReduction(red, kr, kb), c = computeStats(px, w, h, 1, 255, kr, kb);
    expect(g.samples).toBe(c.samples);
    expect(g.yMin).toBeCloseTo(c.yMin, 6); expect(g.yMax).toBeCloseTo(c.yMax, 6); expect(g.yAvg).toBeCloseTo(c.yAvg, 5);
    g.rgbAvg.forEach((v, i) => expect(v).toBeCloseTo(c.rgbAvg[i], 5));
    g.clipLow.forEach((v, i) => expect(v).toBeCloseTo(c.clipLow[i], 9));
    g.clipHigh.forEach((v, i) => expect(v).toBeCloseTo(c.clipHigh[i], 9));
    for (let ch = 0; ch < 4; ch++) expect([...g.hist[ch]]).toEqual([...c.hist[ch]]);
  });
});
