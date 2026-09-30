import { describe, expect, it } from 'vitest';
import { LOGC3_EI, LOG_CURVES, logDecode, logEncode, logSceneToSignal, type LogC3Ei } from '../src/camera';

describe('S-Log2 (alwan, MIT)', () => {
  // OCIO cross-check: Joegenco/PixelManager luts/S-Log2_to_linear.spi1d (4096 entries over code/1023
  // 0 … 1), sampled values only – the file itself is not part of this repo (no licence).
  const SPI: [number, number][] = [[0, -0.0262106340379], [500, 0.0111887222156], [1000, 0.0781719908118], [1500, 0.221226468682],
    [2000, 0.526744306087], [2500, 1.17923116684], [3000, 2.57273077965], [3500, 5.54879331589], [4095, 13.7582740784]];
  it('decodes like the OCIO S-Log2 LUT', () => {
    for (const [i, lin] of SPI) expect(logDecode('slog2', i / 4095), `index ${i}`).toBeCloseTo(lin, 4);
  });
  it('native gamut: S-Gamut (same primaries as S-Gamut3)', () => expect(LOG_CURVES.slog2.gamut).toBe('sgamut3'));
});

describe('ACEScct (alwan, Academy S-2016-001)', () => {
  it('log segment (log2(x) + 9.72)/17.52 and linear toe A·x + B, as scope signal level', () => {
    expect(logSceneToSignal('acescct', 1)).toBeCloseTo(9.72 / 17.52, 9);
    expect(logSceneToSignal('acescct', 0.18)).toBeCloseTo((Math.log2(0.18) + 9.72) / 17.52, 9);
    expect(logSceneToSignal('acescct', 0)).toBeCloseTo(0.0729055341958355, 9);
    // the two segments meet at 2^-7 (encoded 0.155251141552511)
    expect(logSceneToSignal('acescct', 0.0078125)).toBeCloseTo(0.155251141552511, 6);
    expect(LOG_CURVES.acescct.gamut).toBe('ap1');
  });
});

describe('ARRI LogC3 for other EI (ARRI "ALEXA Log C Curve – Usage in VFX", p8)', () => {
  it('EI 800 of the table is the existing logc3 curve', () => {
    for (const x of [0.001, 0.18, 1, 10]) expect(logEncode('logc3', x)).toBeCloseTo(0.24719 * Math.log10(5.555556 * x + 0.052272) * (x > 0.010591 ? 1 : 0) + (x > 0.010591 ? 0.385537 : 5.367655 * x + 0.092809), 5);
  });
  it('reproduces the table column e·cut + f and keeps 18 % grey on code 400 for every EI', () => {
    const ecf: Record<string, number> = { 160: 0.125266, 400: 0.139142, 1000: 0.153047, 1600: 0.160192 };
    for (const [ei, v] of Object.entries(ecf)) expect(LOG_CURVES[`logc3-${ei}` as LogC3Ei].p!.cutEnc).toBeCloseTo(v, 5);
    for (const ei of Object.keys(LOGC3_EI)) {
      const g = logEncode(`logc3-${ei}` as LogC3Ei, 0.18) * 1023;
      expect(g, `EI ${ei}`).toBeCloseTo(400, 1);
    }
    // what changes with EI is the slope above grey (c): higher EI = more headroom, so a bright
    // scene value lands lower at EI 1600 than at EI 160
    expect(logEncode('logc3-1600', 8)).toBeLessThan(logEncode('logc3-160', 8));
  });
});
