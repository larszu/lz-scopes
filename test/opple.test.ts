import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MessageAssembler, OPCODE, buildCommand, encapsulate, opcodeOf, parseCalibration, parseMeasurement } from '../src/opple/protocol';
import { cctMcCamy, duvFromUv, processMeasurement, readingsCsv, xyToUv, xyzToXy } from '../src/opple/photometry';

// Sample packets and reference values from natmart-in/sunday-light-meter @ eb50efc (MIT):
// test/protocol.test.js (frames captured from a real Light Master 4, 1 Sep 2026),
// test/colour.test.js (LM4 vector of gabrielebaudo/opple-bridge with the Opple app's
// display), test/fixtures/lm3-reference.json (LM3 values of a Python port).
const hex = (s: string) => s.match(/../g)!.map((b) => parseInt(b, 16));
const header = (opcode: number, len: number) => [0x00, 0x13, 0x00, 0x00, 0x01, 0x00, len & 0xff, 0x00, 0x00, (opcode >> 8) & 0xff, opcode & 0xff];
const REAL_CAL = '002381843fb6c5853f0c05783f7bed8d3fe5fa843f5de5863ff6a0883f69ed983f0000803fa986993fc8edb13f0cf2';
const REAL_MEAS = '00004600bd00e0014e020002740358031006d501130cf2';

describe('Opple BLE framing', () => {
  it('builds the 11-byte header', () => {
    expect([...buildCommand(OPCODE.REQ_MEAS, 7)]).toEqual([0, 0x13, 0, 0, 7, 0, 0, 0, 0, 0x0a, 0x00]);
  });
  it('short command = one frame with total length', () => {
    const f = encapsulate(buildCommand(OPCODE.REQ_CAL, 1));
    expect(f).toHaveLength(1);
    expect(f[0][0]).toBe(0);
    expect((f[0][1] << 8) | f[0][2]).toBe(14);
  });
  it('fragments 17/19 and reassembles', () => {
    const msg = buildCommand(0x1234, 9, Uint8Array.from({ length: 40 }, (_, i) => i + 1));
    const frames = encapsulate(msg);
    expect(frames.map((f) => f[0])).toEqual([0x80, 0xa1, 0xc2]);
    const asm = new MessageAssembler();
    let out: Uint8Array | null = null;
    for (const f of frames) out = asm.feed(f) ?? out;
    expect([...out!]).toEqual([...msg]);
    expect(opcodeOf(out)).toBe(0x1234);
    expect(asm.feed(Uint8Array.from([0xc2, 1]))).toBeNull();
  });
});

describe('real Light Master 4 frames', () => {
  const cal = parseCalibration(Uint8Array.from([...header(OPCODE.RES_CAL, hex(REAL_CAL).length), ...hex(REAL_CAL)]))!;
  const meas = parseMeasurement(Uint8Array.from([...header(OPCODE.RES_MEAS, 23), ...hex(REAL_MEAS)]))!;
  it('calibration: nine little-endian factors', () => {
    expect(cal.model).toBe('lm4');
    [1.0352, 1.0451, 0.9688, 1.1088, 1.0389, 1.0539, 1.0674, 1.1947, 1.0].forEach((k, i) => expect(cal.kSensor[i]).toBeCloseTo(k, 3));
  });
  it('measurement: channels, temperature, battery', () => {
    expect(meas).toEqual({ model: 'lm4', raw: [70, 189, 224, 334, 512, 628, 856, 784, 1749], batteryRaw: 3314, temperature: 27.5 });
  });
  it('desk light: 4144 K, 868.8 lx, Duv −0.0017 (sunday-light-meter reference)', () => {
    const r = processMeasurement(meas, cal);
    expect(r.cct).toBeGreaterThan(4141); expect(r.cct).toBeLessThan(4147);
    expect(r.lux).toBeCloseTo(868.8, 0);
    expect(r.duv).toBeCloseTo(-0.0017, 3);
    expect(r.calibrated).toBe(true);
  });
  it('opple-bridge vector: app showed 4236 K / 2057 lx (reference port 4239 K / 2127.7 lx)', () => {
    const r = processMeasurement({ model: 'lm4', raw: [654, 819, 855, 1152, 1330, 1719, 2595, 3715, 14571], batteryRaw: 3344, temperature: null },
      { model: 'lm4', kSensor: [1.010141, 1.009422, 0.928753, 1.037585, 0.968898, 1.181077, 0.961893, 1.059147, 1.0] });
    expect(Math.abs(r.cct - 4239)).toBeLessThan(1);
    expect(Math.abs(r.cct - 4236)).toBeLessThan(10);
    expect(r.lux).toBeCloseTo(2127.7, 0);
    expect(r.duv).toBeCloseTo(-0.0136, 3);
  });
});

describe('Light Master 3 pipeline', () => {
  const ref = JSON.parse(readFileSync(new URL('./fixtures/opple-lm3-reference.json', import.meta.url), 'utf8'));
  it('matches the reference fixtures (mode, xy, lux, CCT, Duv)', () => {
    for (const f of ref.fixtures) {
      const r = processMeasurement({ model: 'lm3', raw: f.raw, batteryRaw: 3900, temperature: 24 }, { model: 'lm3', kSensor: f.k });
      expect(r.mode, f.name).toBe(f.mode);
      expect(r.lux, f.name).toBeCloseTo(f.lux, 6);
      if (!(f.lux > 0)) { expect(Number.isNaN(r.cct)).toBe(true); continue; }
      expect(r.x, f.name).toBeCloseTo(f.x, 9);
      expect(r.y, f.name).toBeCloseTo(f.y, 9);
      expect(r.cct, f.name).toBeCloseTo(f.cct, 6);
      expect(r.duv, f.name).toBeCloseTo(f.duv, 9);
    }
  });
  it('parses an LM3 payload (6 channels, battery mV, temperature)', () => {
    const be = (v: number) => [(v >> 8) & 0xff, v & 0xff];
    const p = [0, ...[100, 200, 300, 400, 500, 600].flatMap(be), ...be(3900), 24];
    expect(parseMeasurement(Uint8Array.from([...header(OPCODE.RES_MEAS, p.length), ...p]))).toEqual({ model: 'lm3', raw: [100, 200, 300, 400, 500, 600], batteryRaw: 3900, temperature: 24 });
  });
});

describe('CCT and Duv', () => {
  it('McCamy: illuminant A (x 0.44757, y 0.40745, CIE 15) ≈ 2856 K, D65 (0.3127, 0.3290) ≈ 6500 K', () => {
    expect(Math.abs(cctMcCamy(0.44757, 0.40745) - 2856)).toBeLessThan(5);
    expect(Math.abs(cctMcCamy(0.3127, 0.329) - 6504)).toBeLessThan(10);
  });

  // Exact Planckian locus: Planck's law (c2 = 1.4388e-2 m·K, CIE 15) integrated with the
  // CIE 1931 2° colour-matching functions (5 nm table).
  const cmf = JSON.parse(readFileSync(new URL('./fixtures/cie1931-2deg-5nm.json', import.meta.url), 'utf8'));
  const planckUv = (T: number) => {
    let X = 0, Y = 0, Z = 0;
    for (let i = 0; i * 3 < cmf.xyz.length; i++) {
      const l = (cmf.start + i * cmf.step) * 1e-9, s = 1 / (l ** 5 * (Math.exp(1.4388e-2 / (l * T)) - 1));
      X += s * cmf.xyz[i * 3]; Y += s * cmf.xyz[i * 3 + 1]; Z += s * cmf.xyz[i * 3 + 2];
    }
    return xyToUv(...xyzToXy(X, Y, Z));
  };
  it('Duv ≈ 0 on the Planckian locus from 2000 K to 15000 K', () => {
    for (const T of [2000, 2856, 4000, 5000, 6500, 10000, 15000]) expect(Math.abs(duvFromUv(...planckUv(T))), `${T} K`).toBeLessThan(3e-4); // 4-digit 5-nm table
  });
  it('Duv = ±0.01 perpendicular to the locus; D65 ≈ +0.0032', () => {
    const T = 4000, [u0, v0] = planckUv(T), [u1, v1] = planckUv(T + 10);
    const len = Math.hypot(u1 - u0, v1 - v0), nu = -(v1 - v0) / len, nv = (u1 - u0) / len; // normal
    const sign = nv > 0 ? 1 : -1; // towards larger v = green side
    expect(duvFromUv(u0 + sign * 0.01 * nu, v0 + sign * 0.01 * nv)).toBeCloseTo(0.01, 3);
    expect(duvFromUv(u0 - sign * 0.01 * nu, v0 - sign * 0.01 * nv)).toBeCloseTo(-0.01, 3);
    expect(duvFromUv(...xyToUv(0.3127, 0.329))).toBeCloseTo(0.0032, 3);
  });
  it('CSV lists readings', () => {
    const r = processMeasurement({ model: 'lm4', raw: [70, 189, 224, 334, 512, 628, 856, 784, 1749], batteryRaw: 3314, temperature: 27.5 }, null, 0);
    const csv = readingsCsv([r], 'Set A');
    expect(csv.split('\n')[2]).toMatch(/^1970-01-01T00:00:00.000Z,lm4,/);
    expect(r.calibrated).toBe(false);
  });
});
