import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GAMUTS, HLG_PEAKS, bradford, bt709Oetf, deltaE2000, deltaEITP, detectColorspace, gamutConvert, gamutDistance, hlgGamma,
  hlgInverseOetf, hlgNits, hlgOotf, pqDecode, rgb2020ToIctcp, xyToUv, xyzToLab, xyzToUv, ycbcr,
} from '../src/color';
import { ACES_WHITE } from '../src/camera';
import { code10, safeAreaRects } from '../src/patterns';
import { waveMarks } from '../src/graticule';

// Sources: docs/research/ebu-video.md (PDF page numbers there).

describe('HLG system gamma (BT.2100-3 Note 5f, EBU R 167 Tab. 1.1)', () => {
  it('reproduces the R 167 presets: γ and 75 % luminance', () => {
    // R 167 v1.1 Tab. 1.1, p6
    const gamma = [1.07, 1.11, 1.2, 1.33, 1.42, 1.48, 1.53, 1.7];
    const at75 = [120, 138, 203, 343, 456, 559, 653, 1043];
    HLG_PEAKS.forEach((lw, i) => {
      expect(Math.round(hlgGamma(lw) * 100) / 100, `γ @ ${lw}`).toBe(gamma[i]);
      expect(Math.round(hlgNits(0.75, lw)), `75 % @ ${lw}`).toBe(at75[i]);
    });
  });
  it('applies the OOTF to luminance: hue ratios survive, grey equals the achromatic formula', () => {
    const e: [number, number, number] = [0.4, 0.1, 0.05];
    const d = hlgOotf(e, 1000);
    expect(d[0] / d[1]).toBeCloseTo(4, 9); expect(d[1] / d[2]).toBeCloseTo(2, 9);
    const g = hlgOotf([0.2, 0.2, 0.2], 1000);
    expect(g[1]).toBeCloseTo(1000 * Math.pow(0.2, 1.2), 9);
  });
  it('BT.814-4 HDR Higher level 399 ≈ 27 cd/m² on PQ and on a 1000 cd/m² HLG display (Tab. 3 Note 1, p6)', () => {
    const v = code10(399);
    expect(v).toBeCloseTo(0.382, 3);
    expect(hlgInverseOetf(v)).toBeCloseTo(0.048748, 5); // Note 2 constant
    expect(hlgNits(v)).toBeCloseTo(27, 0);
    expect(pqDecode(v)).toBeCloseTo(27, 0);
  });
});

describe('norm levels', () => {
  it('18 % reflectance through the BT.709 OETF = 40.9 % (BT.709-6 p5)', () => {
    expect(bt709Oetf(0.18)).toBeCloseTo(0.409, 3);
  });
  it('R 103 v3.0 preferred range 20–984 (10 bit) = −5 %/+105 % (Tab. 1, p5)', () => {
    expect(code10(20)).toBeCloseTo(-0.05, 2);
    expect(code10(984)).toBeCloseTo(1.05, 2);
    const levels = waveMarks('sdr', { r103: true }).map((m) => m.level);
    expect(levels).toEqual([1.05, -0.05]);
  });
  it('BT.2408 waveform marks: 75 % HLG, 58 % PQ, 38 % grey card (BT.2408-8 Tab. 1, p9)', () => {
    expect(waveMarks('hlg').map((m) => m.level)).toEqual([0.75, 0.38]);
    expect(waveMarks('pq').map((m) => m.level)).toEqual([0.58, 0.38]);
    expect(waveMarks('sdr')).toEqual([]);
  });
  it('BT.2111-3 PLUGE codes 48/64/80/99 = −2/0/+2/+4 % (Tab. 2)', () => {
    expect([48, 64, 80, 99].map((c) => Math.round(code10(c) * 100))).toEqual([-2, 0, 2, 4]);
  });
  it('R 95 v1.1 safe areas at 1080p (Fig. 4, p8)', () => {
    const s = safeAreaRects(1920, 1080);
    expect([s.action.x, s.action.y, s.action.w]).toEqual([67, 38, 1786]);
    expect([s.graphics.x, s.graphics.y, s.graphics.w]).toEqual([96, 54, 1728]);
    expect([s.caption, 1920 - 2 * s.caption]).toEqual([312, 1296]);
  });
});

describe('BT.601 525/625 (BT.601-7 §2.6.1, p8)', () => {
  it('625-line primaries are the EBU set', () => {
    expect(GAMUTS['601-625'].g).toEqual([0.29, 0.6]);
    expect(GAMUTS['601'].g).toEqual([0.31, 0.595]);
  });
  it('detects bt470bg as 625 and smpte170m as 525', () => {
    expect(detectColorspace('bt470bg', 'bt470bg', 576)).toBe('601-625');
    expect(detectColorspace('bt601', 'bt470bg', 576)).toBe('601-625');
    expect(detectColorspace('smpte170m', 'smpte170m', 480)).toBe('601');
    expect(detectColorspace('bt601', 'unknown', 576)).toBe('601-625');
    expect(detectColorspace('unknown', 'unknown', 576)).toBe('601-625');
    expect(ycbcr(1, 1, 1, '601-625').cb).toBeCloseTo(0, 9);
  });
});

describe('colour science', () => {
  it('Bradford ACES white → D65 matches alwan api/alwan_aces_ff.c l. 3780 (aces-core CAT)', () => {
    const ref = [0.98722400870301763, -0.00611322860685689, 0.01595328833591263, -0.00759837181166235, 1.00186148473965364, 0.00533003579138894, 0.00307257705853153, -0.00509596151113058, 1.08168060306579528];
    bradford(ACES_WHITE, [0.3127, 0.329]).forEach((v, i) => expect(v).toBeCloseTo(ref[i], 4));
  });
  it('gamutConvert keeps white neutral across different white points', () => {
    const m = gamutConvert(GAMUTS.ap1, GAMUTS['709']);
    for (let r = 0; r < 3; r++) expect(m[r * 3] + m[r * 3 + 1] + m[r * 3 + 2]).toBeCloseTo(1, 6);
  });
  it("u′v′: D65 = (0.1978, 0.4683); xy → u′v′ agrees with XYZ → u′v′", () => {
    const [u, v] = xyToUv([0.3127, 0.329]);
    expect(u).toBeCloseTo(0.1978, 4); expect(v).toBeCloseTo(0.4683, 4);
    const [u2, v2] = xyzToUv(0.3127 / 0.329, 1, (1 - 0.3127 - 0.329) / 0.329);
    expect(u2).toBeCloseTo(u, 9); expect(v2).toBeCloseTo(v, 9);
  });
  it('ΔE2000 reproduces all 34 pairs of Sharma, Wu & Dalal (2005)', () => {
    // test/fixtures/ciede2000-sharma.txt from
    // https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/dataNprograms/ciede2000testdata.txt
    const rows = readFileSync(new URL('./fixtures/ciede2000-sharma.txt', import.meta.url), 'utf8').trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
    expect(rows.length).toBe(34);
    for (const [L1, a1, b1, L2, a2, b2, dE] of rows) {
      expect(deltaE2000([L1, a1, b1], [L2, a2, b2])).toBeCloseTo(dE, 4);
      expect(deltaE2000([L2, a2, b2], [L1, a1, b1])).toBeCloseTo(dE, 4);
    }
  });
  it('Lab of the reference white is (100, 0, 0)', () => {
    const w = [0.95047, 1, 1.08883];
    const [L, a, b] = xyzToLab(w, w);
    expect(L).toBeCloseTo(100, 9); expect(a).toBeCloseTo(0, 9); expect(b).toBeCloseTo(0, 9);
  });
  it('ICtCp: 10 000 cd/m² white → I = 1, Ct = Cp = 0 (BT.2100 matrices); ΔE ITP of neutral steps', () => {
    const [I, T, P] = rgb2020ToIctcp([10000, 10000, 10000]);
    expect(I).toBeCloseTo(1, 9); expect(T).toBeCloseTo(0, 9); expect(P).toBeCloseTo(0, 9);
    const a = rgb2020ToIctcp([100, 100, 100]), b = rgb2020ToIctcp([10000, 10000, 10000]);
    // neutral: only ΔI counts, I = PQ(L) → 720·(1 − PQ(100))
    expect(deltaEITP(a, b)).toBeCloseTo(720 * (1 - a[0]), 9);
    expect(a[0]).toBeCloseTo(0.508, 3);
    expect(deltaEITP(a, a)).toBe(0);
  });
  it('gamut distance: 0 neutral, 1 on the boundary, > 1 outside', () => {
    expect(gamutDistance([0.5, 0.5, 0.5])).toBe(0);
    expect(gamutDistance([1, 0, 0])).toBe(1);
    expect(gamutDistance([1, -0.1, 0.2])).toBeCloseTo(1.1, 9);
    // Rec.2020 green is outside Rec.709
    const g = gamutConvert(GAMUTS['2020'], GAMUTS['709']);
    expect(gamutDistance([g[1], g[4], g[7]])).toBeGreaterThan(1);
  });
});
