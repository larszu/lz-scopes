import { describe, expect, it } from 'vitest';
import { LOG_CURVES, logDecode, logEncode, logSceneToSignal, logUniforms, type LogCurve } from '../src/camera';
import { GAMUTS, gamutConvert, type GamutId } from '../src/color';

const CURVES = Object.keys(LOG_CURVES) as LogCurve[];

/**
 * OCIO LogCameraTransform (lin → log side) with the parameters from Joegenco/PixelManager
 * config.ocio (line numbers below) – an independent parametrisation of the manufacturer
 * curves, used only as a cross-check of the alwan-derived implementation.
 */
const OCIO: Partial<Record<LogCurve, { line: number; base?: number; logSideSlope: number; logSideOffset: number; linSideSlope?: number; linSideOffset?: number; linSideBreak: number }>> = {
  logc3: { line: 982, base: 10, logSideSlope: 0.247189638318671, logSideOffset: 0.385536998692443, linSideSlope: 5.55555555555556, linSideOffset: 0.0522722750251688, linSideBreak: 0.0105909904954696 },
  logc4: { line: 1000, logSideSlope: 0.0647954196341293, logSideOffset: -0.295908392682586, linSideSlope: 2231.82630906769, linSideOffset: 64, linSideBreak: -0.0180569961199113 },
  bmdfilm5: { line: 1018, base: Math.E, logSideSlope: 0.0869287606549122, logSideOffset: 0.530013339229194, linSideOffset: 0.00549407243225781, linSideBreak: 0.005 },
  vlog: { line: 1076, base: 10, logSideSlope: 0.241514, logSideOffset: 0.598206, linSideOffset: 0.00873, linSideBreak: 0.01 },
  log3g10: { line: 1094, base: 10, logSideSlope: 0.224282, logSideOffset: 0, linSideSlope: 155.975327, linSideOffset: 2.55975327, linSideBreak: -0.01 },
  slog3: { line: 1148, base: 10, logSideSlope: 0.255620723362659, logSideOffset: 0.410557184750733, linSideSlope: 5.26315789473684, linSideOffset: 0.0526315789473684, linSideBreak: 0.01125 },
  flog2: { line: 1252, base: 10, logSideSlope: 0.245281, logSideOffset: 0.384316, linSideSlope: 5.555556, linSideOffset: 0.064829, linSideBreak: 0.000889 },
};

describe('camera log curves (alwan, MIT)', () => {
  it('decode(encode(x)) = x over −0.01 … 40 for every curve', () => {
    for (const c of CURVES) {
      for (const x of [0, 0.001, 0.005, 0.02, 0.18, 0.9, 1, 4, 16, 40]) {
        expect(logDecode(c, logEncode(c, x)), `${c} @ ${x}`).toBeCloseTo(x, 6);
      }
    }
  });
  it('is monotonic and roughly continuous at the segment breaks', () => {
    for (const c of CURVES) {
      let prev = -Infinity;
      for (let x = 0; x < 2; x += 0.0005) {
        const v = logEncode(c, x);
        expect(v, `${c} @ ${x}`).toBeGreaterThan(prev - 1e-9);
        if (prev > -Infinity) expect(v - prev, `${c} jump @ ${x}`).toBeLessThan(0.01);
        prev = v;
      }
    }
  }, 30_000); // 24 curves × 4000 steps
  it('matches the PixelManager OCIO LogCameraTransform parameters on the log segment', () => {
    for (const [c, o] of Object.entries(OCIO) as [LogCurve, NonNullable<(typeof OCIO)[LogCurve]>][]) {
      const base = o.base ?? 2;
      for (const x of [0.02, 0.18, 0.5, 1, 5, 20]) {
        if (x <= o.linSideBreak) continue;
        const ref = o.logSideSlope * (Math.log((o.linSideSlope ?? 1) * x + (o.linSideOffset ?? 0)) / Math.log(base)) + o.logSideOffset;
        expect(logEncode(c, x), `${c} (config.ocio l. ${o.line}) @ ${x}`).toBeCloseTo(ref, 5);
      }
    }
  });
  it('18 % grey lands on the published code values', () => {
    // S-Log3: 420 + log10(0.19/0.19)·261.5 = code 420 (alwan l. 240)
    expect(logEncode('slog3', 0.18) * 1023).toBeCloseTo(420, 6);
    // Log3G10: 18 % grey maps to 1/3 (RED white paper 915-0187, per alwan's constants)
    expect(logEncode('log3g10', 0.18)).toBeCloseTo(1 / 3, 3);
  });
  it('the shader uniforms describe the same generic curve', () => {
    // emulate LOG_GLSL's generic branch
    for (const c of CURVES.filter((k) => LOG_CURVES[k].kind === 0)) {
      const { a, b } = logUniforms(c);
      for (const x of [0.001, 0.18, 2]) {
        const v = logEncode(c, x);
        const lin = v < b[1] ? (v - b[3]) / b[2] : (Math.pow(a[0], (v - a[2]) / a[1]) - b[0]) / a[3];
        expect(lin, c).toBeCloseTo(x, 6);
      }
    }
  });
  it('maps curve codes into the narrow-range scope signal', () => {
    // S-Log3 18 % grey = code 420 → (420 − 64)/876 = 40.6 % of the video signal
    expect(logSceneToSignal('slog3', 0.18)).toBeCloseTo((420 - 64) / 876, 6);
  });
});

describe('camera gamuts and Bradford adaptation', () => {
  // alwan data/matrices/cam_ap0_to_*.csv and aces_ap0_to_ap1.csv (MIT): ACES2065-1 → camera RGB.
  // V-Gamut and REDWideGamutRGB are built there with the Bradford D60 → D65 adaptation (the others
  // follow the manufacturers' ACES IDTs, which use CAT02, and differ by ~0.002 – not comparable).
  const REF: [GamutId, number[]][] = [
    ['vgamut', [1.38506020970268717, -0.234890965598451240, -0.150168706532292778, -0.0300002050228221490, 1.02041724825183233, 0.00958279663147605827, 0.0126296402543385530, -0.00107984535049030265, 0.988449262285476360]],
    ['rwg', [1.26553928049478315, -0.135232251457124114, -0.130305681570043158, -0.0205691226686483507, 0.943170962728600459, 0.0773976700164827058, 0.0625750094542373292, 0.206530836905062770, 0.730893947852410464]],
    ['ap1', [1.45143931614566557, -0.236510746893740187, -0.214928569251925328, -0.0765537733960205691, 1.17622969983357306, -0.0996759264375521870, 0.00831614842569772077, -0.00603244979102102782, 0.997716301365323299]],
  ];
  for (const [g, m] of REF) {
    it(`ACES AP0 → ${GAMUTS[g].name} matches alwan`, () => {
      gamutConvert(GAMUTS.ap0, GAMUTS[g]).forEach((v, i) => expect(v, `[${i}]`).toBeCloseTo(m[i], 3));
    });
  }
});
