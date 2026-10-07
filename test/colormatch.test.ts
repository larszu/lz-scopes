import { describe, expect, it } from 'vitest';
import {
  GREEN_DEFAULT, aggregate, angleDiff, cameraText, ciToSignal, codes, compare, convertSignal, correctionText, deVerdict, hexLine, hueSatLuma,
  inWedge, meanHue, parseColor, signalToCi, swatchCss, targetSignal, toHex, towards, wedgeLumaRange,
} from '../src/match/core';
import { ycbcr } from '../src/color';
import type { Space } from '../src/deltae';

const SDR: Space = { transfer: 'sdr', gamut: '709', hlgLw: 1000 };
const PQ: Space = { transfer: 'pq', gamut: '2020', hlgLw: 1000 };
const HLG: Space = { transfer: 'hlg', gamut: '2020', hlgLw: 1000 };

describe('CI colour input', () => {
  it('parses hex (long and short) and RGB triplets', () => {
    expect(parseColor('#FF8000', 'hex')).toEqual([1, 128 / 255, 0]);
    expect(parseColor('f80', 'hex')).toEqual(parseColor('#ff8800', 'hex'));
    expect(parseColor('rgb(255, 0, 51)', 'rgb8')).toEqual([1, 0, 0.2]);
    expect(parseColor('1023 0 0', 'rgb10')).toEqual([1, 0, 0]);
    expect(parseColor('#12345', 'hex')).toBeNull();
    expect(parseColor('300 0 0', 'rgb8')).toBeNull();
  });
  it('maps legal-range codes onto 0…1 (BT.2100 Tab. 9: 64/940 and 16/235)', () => {
    expect(parseColor('64 502 940', 'legal10')).toEqual([0, 0.5, 1]);
    expect(parseColor('16, 235, 16', 'legal8')).toEqual([0, 1, 0]);
  });
  it('codes: narrow D = Round[(219·E′+16)·2^(n−8)], full D = Round[(2^n−1)·E′]', () => {
    expect(codes([0, 0.5, 1], 10, true)).toEqual([64, 502, 940]);
    expect(codes([0, 1], 8, true)).toEqual([16, 235]);
    expect(codes([0, 1], 10, false)).toEqual([0, 1023]);
    expect(toHex([1, 128 / 255, 0])).toBe('#FF8000');
  });
});

describe('CI colour → source encoding', () => {
  it('video interpretation is the code value itself on Rec.709 SDR', () => {
    expect(ciToSignal([0.2, 0.5, 0.9], 'video', SDR).map((v) => +v.toFixed(9))).toEqual([0.2, 0.5, 0.9]);
  });
  it('sRGB interpretation: sRGB EOTF(0.5) = 0.2140 light, BT.1886 inverse → 0.526', () => {
    const v = ciToSignal([0.5, 0.5, 0.5], 'srgb', SDR);
    expect(Math.pow(v[0], 2.4)).toBeCloseTo(0.2140, 4);
    expect(v[0]).toBeCloseTo(0.526, 3);
  });
  it('white lands on the BT.2408 reference levels: PQ 58 %, HLG 75 %', () => {
    expect(ciToSignal([1, 1, 1], 'video', PQ)[1]).toBeCloseTo(0.58, 2);
    expect(ciToSignal([1, 1, 1], 'video', HLG)[1]).toBeCloseTo(0.75, 3);
  });
  it('round trip signal ↔ CI', () => {
    const v: [number, number, number] = [0.8, 0.3, 0.1];
    const s = ciToSignal(v, 'srgb', PQ);
    signalToCi(s, 'srgb', PQ).v.forEach((x, i) => expect(x).toBeCloseTo(v[i], 6));
    expect(signalToCi([0, 1, 0], 'video', { ...SDR, gamut: '2020' }).outside).toBe(true);
  });
  it('targets resolve per source encoding', () => {
    expect(targetSignal({ name: 'a', rgb: [0.1, 0.2, 0.3] }, PQ)).toEqual([0.1, 0.2, 0.3]); // legacy: same encoding
    const m = targetSignal({ name: 'b', rgb: [0.5, 0.5, 0.5], space: SDR }, SDR);
    expect(m).toEqual([0.5, 0.5, 0.5]);
    expect(convertSignal([1, 1, 1], SDR, PQ)[0]).toBeCloseTo(0.58, 2);
  });
  it('hex read-out of a measured SDR signal and of an HDR signal (via 709)', () => {
    expect(hexLine([1, 128 / 255, 0], SDR)).toBe('#FF8000  RGB 255,128,0');
    expect(hexLine(ciToSignal([1, 128 / 255, 0], 'video', PQ), PQ)).toBe('#FF8000  RGB 255,128,0 (als 709)');
  });
});

describe('comparison', () => {
  const rot = (rgb: number[], deg: number, satK = 1, yK = 1): [number, number, number] => {
    const { y, cb, cr } = ycbcr(rgb[0], rgb[1], rgb[2], '709');
    const a = (deg * Math.PI) / 180, c2 = (cb * Math.cos(a) - cr * Math.sin(a)) * satK, r2 = (cb * Math.sin(a) + cr * Math.cos(a)) * satK, y2 = y * yK;
    // inverse BT.709 Y′CbCr
    const R = y2 + 1.5748 * r2, B = y2 + 1.8556 * c2, G = (y2 - 0.2126 * R - 0.0722 * B) / 0.7152;
    return [R, G, B];
  };
  const src: [number, number, number] = [0.6, 0.35, 0.3];
  it('identical colours: ΔE 0, no correction', () => {
    const c = compare(src, src, SDR, '709');
    expect(c.de.value).toBeCloseTo(0, 9);
    expect(correctionText(c, '709')).toEqual(['Farbton passt (< 0,5°)', 'Sättigung passt (< 1 %)', 'Helligkeit passt (< 0,5 %-Punkte)']);
  });
  it('recovers a hue rotation, saturation and luma change', () => {
    const c = compare(src, rot(src, 10, 1.2, 1.1), SDR, '709');
    expect(c.hueDeg).toBeCloseTo(10, 6);
    expect(c.satPct).toBeCloseTo(20, 6);
    expect(c.lumaPct).toBeCloseTo(10, 6);
    expect(c.de.metric).toBe('ΔE00');
    expect(c.de.value).toBeGreaterThan(3);
    expect(correctionText(c, '709')[0]).toMatch(/^Farbton \+10,0° drehen \(gegen den Uhrzeigersinn, Richtung /);
  });
  it('HDR uses ΔITP', () => {
    expect(compare([0.5, 0.4, 0.3], [0.5, 0.45, 0.3], PQ, '2020').de.metric).toBe('ΔITP');
  });
  it('neutral references give white-balance gains', () => {
    const grey = [0.5, 0.5, 0.5], warm = [0.52, 0.5, 0.47];
    const c = compare(warm, grey, SDR, '709');
    const t = cameraText(c, warm, grey, SDR, '709');
    expect(t[0]).toMatch(/^Weißabgleich: R-Gain −\d+,\d %, B-Gain \+\d+,\d %/);
  });
  it('direction words follow the vectorscope (red → magenta is counter-clockwise? no: angles)', () => {
    const red = hueSatLuma([0.75, 0, 0], '709').deg, mg = hueSatLuma([0.75, 0, 0.75], '709').deg;
    expect(towards(red, angleDiff(red, mg), '709')).toBe('Magenta');
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(-20);
  });
  it('verdict steps: ≤ 1 just noticeable, ≤ 3 visible side by side', () => {
    expect(deVerdict(0.8).level).toBe(0);
    expect(deVerdict(2.5).level).toBe(1);
    expect(deVerdict(4).level).toBe(2);
  });
  it('series: mean and spread', () => {
    const a = aggregate([[0.5, 0.4, 0.3], [0.52, 0.4, 0.3], [0.48, 0.4, 0.3]], SDR)!;
    expect(a.mean.map((v) => +v.toFixed(9))).toEqual([0.5, 0.4, 0.3]);
    expect(a.n).toBe(3);
    expect(a.max).toBeGreaterThan(0);
  });
});

describe('display-aware swatches', () => {
  it('white is 1 1 1 on every display, Rec.2020 green is clipped on sRGB but not raw', () => {
    expect(swatchCss([1, 1, 1], SDR, 'p3').css).toBe('color(display-p3 1.0000 1.0000 1.0000)');
    expect(swatchCss([0, 1, 0], { ...SDR, gamut: '2020' }, 'srgb').clipped).toBe(true);
    expect(swatchCss([1, 0, 0], SDR, 'p3').clipped).toBe(false);
  });
  it('SDR mid grey: BT.1886 light 0.5^2.4 = 0.1895, sRGB-encoded 1.055·0.1895^(1/2.4) − 0.055 = 0.4725', () => {
    expect(swatchCss([0.5, 0.5, 0.5], SDR, 'srgb').css).toBe('color(srgb 0.4725 0.4725 0.4725)');
  });
});

describe('green qualifier', () => {
  it('ColorChecker Foliage (87/108/67) and Yellow green (157/188/64) fall into the default wedge', () => {
    const f = hueSatLuma([87 / 255, 108 / 255, 67 / 255], '709'), y = hueSatLuma([157 / 255, 188 / 255, 64 / 255], '709');
    expect(f.deg).toBeCloseTo(205.5, 1);
    expect(y.deg).toBeCloseTo(189.5, 1);
    for (const p of [[87, 108, 67], [157, 188, 64]]) {
      const { cb, cr } = ycbcr(p[0] / 255, p[1] / 255, p[2] / 255, '709');
      expect(inWedge(cb, cr, GREEN_DEFAULT.hue, GREEN_DEFAULT.tol)).toBe(true);
    }
    const { cb, cr } = ycbcr(0.6, 0.35, 0.3, '709'); // skin-ish: not green
    expect(inWedge(cb, cr, GREEN_DEFAULT.hue, GREEN_DEFAULT.tol)).toBe(false);
    expect(GREEN_DEFAULT.lo).toBe(0.4); expect(GREEN_DEFAULT.hi).toBe(0.55); // BT.2408-8 Tab. 2, HLG
  });
  it('mean hue and luma window from samples', () => {
    const px = Array.from({ length: 100 }, (_, i) => [87 / 255, 108 / 255, 67 / 255].map((v) => v * (0.9 + i / 1000)));
    expect(meanHue(px, '709')!).toBeCloseTo(205.5, 0);
    const r = wedgeLumaRange(px, '709', 205, 10)!;
    expect(r.lo).toBeGreaterThan(0.34); expect(r.hi).toBeLessThan(0.45);
    expect(meanHue(px.slice(0, 5), '709')).toBeNull();
  });
});
