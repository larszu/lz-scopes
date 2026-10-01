import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { LightAccumulator, spotreadArgs } from '../server/meter.mjs';
import { parseArgyllSp, parseSpectrumCsv, spectrumToXyz, AS7341_BANDS, type Spectrum } from '../src/opple/spectrum';
import { readingFromSpectrum, readingFromXyz } from '../src/opple/drivers';
import { displayColour, greenGelShift, GREEN_GELS, GELS, suggestGreenGel, planckXy } from '../src/opple/lightScience';
import { xyzToXy } from '../src/opple/photometry';

const flat = (unit: Spectrum['unit'], v = 1): Spectrum => ({ start: 380, end: 780, values: Array(81).fill(v), unit });

describe('spectrum → XYZ (CIE 1931 2°, 5 nm)', () => {
  it('equal-energy spectrum lies at illuminant E (x = y = 1/3)', () => {
    const [x, y] = xyzToXy(...spectrumToXyz(flat('relativ')));
    expect(x).toBeCloseTo(1 / 3, 3); expect(y).toBeCloseTo(1 / 3, 3);
  });
  it('Planck 2856 K lies at illuminant A (x 0.4476, y 0.4074)', () => {
    const values = Array.from({ length: 81 }, (_, i) => { const l = (380 + 5 * i) * 1e-9; return 1 / (l ** 5 * (Math.exp(1.4388e-2 / (l * 2856)) - 1)); });
    const [x, y] = xyzToXy(...spectrumToXyz({ start: 380, end: 780, values, unit: 'relativ' }));
    expect(x).toBeCloseTo(0.4476, 3); expect(y).toBeCloseTo(0.4074, 3);
  });
  it('1 mW/(m²·nm) flat 380–780 nm ≈ 73 lx (683 lm/W · ∫ȳ dλ ≈ 106.9 nm)', () => {
    expect(spectrumToXyz(flat('mW/(m²·nm)'))[1]).toBeGreaterThan(72.5);
    expect(spectrumToXyz(flat('mW/(m²·nm)'))[1]).toBeLessThan(73.5);
  });
});

describe('spectrum files', () => {
  it('Argyll .sp (CGATS) with norm and MEAS_TYPE', () => {
    const sp = parseArgyllSp(['SPECT', 'DESCRIPTOR "Argyll Spectral power/reflectance information"', 'MEAS_TYPE "AMBIENT"', 'SPECTRAL_BANDS "3"',
      'SPECTRAL_START_NM "400.000000"', 'SPECTRAL_END_NM "420.000000"', 'SPECTRAL_NORM "2.000000"',
      'NUMBER_OF_FIELDS 3', 'BEGIN_DATA_FORMAT', 'SPEC_400 SPEC_410 SPEC_420', 'END_DATA_FORMAT', 'NUMBER_OF_SETS 1', 'BEGIN_DATA', '2 4 6', 'END_DATA'].join('\n'))!;
    expect(sp).toEqual({ start: 400, end: 420, values: [1, 2, 3], unit: 'mW/(m²·nm)' });
  });
  it('CSV with header, semicolons and decimal comma', () => {
    const sp = parseSpectrumCsv('nm;Wert\n380;0,1\n385;0,2\n390;0,4\n', 'relativ')!;
    expect(sp.start).toBe(380); expect(sp.end).toBe(390); expect(sp.values).toEqual([0.1, 0.2, 0.4]);
    expect(parseSpectrumCsv('380,1\n385,2\n391,3')).toBeNull(); // not equally spaced
  });
  it('reading from a spectrum file keeps the spectrum', () => {
    const r = readingFromSpectrum(flat('mW/(m²·nm)'), 'datei');
    expect(r.lux).toBeCloseTo(73, 0); expect(r.spectrum?.values).toHaveLength(81); expect(r.quantity).toBe('lx');
    expect(readingFromXyz([95.047, 100, 108.883], 'argyll').cct).toBeCloseTo(6504, -1);
  });
  it('AS7341 channels from the datasheet', () => {
    expect(AS7341_BANDS.map((b) => b.nm)).toEqual([415, 445, 480, 515, 555, 590, 630, 680]);
    expect(AS7341_BANDS[6].fwhm).toBe(50);
  });
});

describe('ArgyllCMS spotread as a light meter', () => {
  it('ambient arguments', () => {
    expect(spotreadArgs({ ambient: true, port: 1 })).toEqual(['-a', '-s', '-c', '1']);
  });
  it('collects spectrum, XYZ, CRI, TLCI and TM-30 of one reading', () => {
    const acc = new LightAccumulator();
    const lines = [
      'Place instrument on spot to be read, and hit [A-Z,a-z] or [SPACE] key to take a reading:',
      'Spectrum from 380.000 to 390.000 nm in 3 steps', '1.5, 2, 3e-1', 'Peak value 2.000000 at (aprox.) 385.0 nm',
      ' Result is XYZ: 98.500000 100.200000 60.100000, D50 Lab: 100 1 2',
      ' Ambient = 100.2 Lux, CCT = 3950K (Duv 0.0012)',
      ' Color Rendering Index (Ra) = 82.3 [ R9 = 12.0 ]',
      '  R1  = 80.1  R2  = 90.0  R3  = 95.5  R4  = 81.0  R5  = 79.0  R6  = 85.0  R7  = 88.0',
      '  R8  = 70.0  R9  = 12.0  R10 = 60.0  R11 = 77.0  R12 = 55.0  R13 = 81.0  R14 = 97.0',
      ' Television Lighting Consistency Index 2012 (Qa) = 75.4',
      ' IES TM-30-15 Rf = 83.10 Rg = 95.20 CCT = 3951 Duv = 0.001200 (Caution)',
      'Place instrument on spot to be read, and hit [A-Z,a-z] or [SPACE] key to take a reading:',
    ];
    const ev = lines.flatMap((l) => acc.feed(l));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: 'light', xyz: [98.5, 100.2, 60.1], lux: 100.2, cct: 3950, duv: 0.0012, spectrum: { start: 380, end: 390, values: [1.5, 2, 0.3] }, tlci: { qa: 75.4 }, tm30: { rf: 83.1, rg: 95.2, caution: true } });
    expect(ev[0].cri.r).toHaveLength(14);
    expect(ev[0].cri.r[8]).toBe(12);
  });
});

describe('colour patch on the display', () => {
  it('D65 is white, the sRGB red primary is pure red', () => {
    expect(displayColour([0.3127, 0.329], 'srgb').rgb.map((v) => +v.toFixed(3))).toEqual([1, 1, 1]);
    const red = displayColour([0.64, 0.33], 'srgb');
    expect(red.rgb[0]).toBeCloseTo(1, 4); expect(red.rgb[1]).toBeCloseTo(0, 3); expect(red.outOfGamut).toBe(false);
  });
  it('the P3 green primary is outside sRGB but inside Display P3', () => {
    expect(displayColour([0.265, 0.69], 'srgb').outOfGamut).toBe(true);
    expect(displayColour([0.265, 0.69], 'display-p3').outOfGamut).toBe(false);
  });
  it('a 3200 K Planckian light is inside sRGB and warm (R > B)', () => {
    const c = displayColour(planckXy(3200), 'srgb');
    expect(c.outOfGamut).toBe(false); expect(c.rgb[0]).toBeGreaterThan(c.rgb[2]);
  });
});

describe('gels from the manufacturers', () => {
  it('Lee 204 Full CT Orange +159 mired, Lee 201 −137 (Lee product pages)', () => {
    expect(GELS.find((g) => g.name.startsWith('204'))?.mired).toBe(159);
    expect(GELS.find((g) => g.name.startsWith('201'))?.mired).toBe(-137);
  });
  it('green gels: plus raises Duv, minus lowers it, stronger gels shift more', () => {
    const t = GREEN_GELS.map((g) => greenGelShift(g, 3200));
    expect(t.slice(0, 4).every((v) => v > 0)).toBe(true);
    expect(t.slice(4).every((v) => v < 0)).toBe(true);
    expect(t[0]).toBeGreaterThan(t[1]); expect(t[7]).toBeLessThan(t[6]);
  });
  it('B greener by 0.0057 under tungsten → Lee 249 Quarter Minus Green', () => {
    expect(suggestGreenGel(0.0057, 3200)?.gel.name).toBe('249 Quarter Minus Green');
    expect(suggestGreenGel(0.001, 3200)).toBeNull();
  });
});
