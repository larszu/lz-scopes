import { describe, expect, it } from 'vitest';
import { MessageAssembler, buildCommand, encapsulate, opcodeOf, parseCalibration, parseMeasurement, type Calibration } from '../src/opple/protocol';
import { processMeasurement } from '../src/opple/photometry';

// Recorded from a real Light Master 3 ("LMaster_06ee", GAP name "LightMaster") on 30.09.2026
// over CoreBluetooth; see the comment on issue #11. Warm room light, sensor at 27 °C.
const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((h) => parseInt(h, 16)));
const NOTIFY = [
  '80002f0000000000010000000a0500f897763fea', 'a161623f56b3693f60d27e3f65e8733facc7823f', 'c20000803f0e70',
  '80001f0000000000020000000a01000004000800', 'c1180025006700690e701b',
  '80001f0000000000030000000a01000005000b00', 'c128003d006500650e751b',
  '80001f0000000000040000000a01000007000f00', 'c12c0044006f00700e751b',
  '80001f0000000000050000000a01000007000f00', 'c12e0047006f00740e7b1b',
];

describe('Light Master 3, recorded live packets', () => {
  it('our requests are byte-identical to what the meter answered', () => {
    expect([...encapsulate(buildCommand(0x0a04, 1))[0]]).toEqual([...hex('00000e0013000001000000000a04')]);
    expect([...encapsulate(buildCommand(0x0a00, 2))[0]]).toEqual([...hex('00000e0013000002000000000a00')]);
  });
  it('reassembles calibration and measurements and gives plausible values', () => {
    const asm = new MessageAssembler();
    let cal: Calibration | null = null;
    const reads = [];
    for (const f of NOTIFY) {
      const m = asm.feed(hex(f));
      if (!m) continue;
      if (opcodeOf(m) === 0x0a05) cal = parseCalibration(m);
      if (opcodeOf(m) === 0x0a01) reads.push(processMeasurement(parseMeasurement(m)!, cal));
    }
    expect(cal?.model).toBe('lm3');
    expect(cal?.kSensor).toHaveLength(7);
    expect(reads).toHaveLength(4);
    expect(reads[1].raw).toEqual([5, 11, 40, 61, 101, 101]);
    expect(reads[1].temperature).toBe(27);
    // the settled readings: warm room light, about 30 lx and 1900–2000 K
    for (const r of reads.slice(1)) {
      expect(r.lux).toBeGreaterThan(25); expect(r.lux).toBeLessThan(40);
      expect(r.cct).toBeGreaterThan(1850); expect(r.cct).toBeLessThan(2100);
      expect(Math.abs(r.duv)).toBeLessThan(0.02);
    }
  });
});
