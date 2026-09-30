// Opple Light Master 3 / 4 – BLE framing and payload parsing (#11).
//
// Ported to TypeScript from natmart-in/sunday-light-meter `src/protocol.js` @ eb50efc
// (MIT, Copyright (c) 2026 Sunday Light, licenses/sunday-light-meter-LICENSE.txt). That
// project names its protocol sources: OlliV/open-light-master (LM3), gabrielebaudo/
// opple-bridge (LM4 layouts), Geomaniac15/tag-tester. Changed: types, Uint8Array
// buffer in the assembler, measurement returns null for an unknown length.
//
// Nordic UART service; commands are written to the notify characteristic …0003 (the meter
// accepts that, and it is what every working implementation does).

export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

export const OPCODE = {
  REQ_MEAS: 0x0a00, RES_MEAS: 0x0a01,
  /** per-unit sensor calibration kSensor */
  REQ_CAL: 0x0a04, RES_CAL: 0x0a05,
  /** flicker waveform (not used here) */
  REQ_FREQ: 0x0a0a, RES_FREQ: 0x0a0b,
} as const;

const FRAG_SINGLE = 0x00, FRAG_FIRST = 0x80, FRAG_MIDDLE = 0xa0, FRAG_LAST = 0xc0, FRAG_MASK = 0xe0;
export const HEADER_LEN = 11;

/** Inner message: 11-byte header [00 13 00 00 seq 00 len 00 00 opHi opLo] + body. */
export function buildCommand(opcode: number, seq: number, body = new Uint8Array(0)) {
  const out = new Uint8Array(HEADER_LEN + body.length);
  out.set([0x00, 0x13, 0x00, 0x00, seq & 0xff, 0x00, body.length & 0xff, 0x00, 0x00, (opcode >> 8) & 0xff, opcode & 0xff]);
  out.set(body, HEADER_LEN);
  return out;
}

/** Split into BLE write fragments: the first carries 17 bytes (after type + total length), the rest 19. */
export function encapsulate(data: Uint8Array): Uint8Array[] {
  const n = data.length < 17 ? 1 : Math.ceil((data.length - 17) / 19) + 1;
  const frames: Uint8Array[] = [];
  for (let c = 0; c < n; c++) {
    let head: number[], body: Uint8Array;
    if (c === 0) {
      const total = data.length + n + 2;
      head = [n > 1 ? FRAG_FIRST : FRAG_SINGLE, (total >> 8) & 0xff, total & 0xff];
      body = n > 1 ? data.subarray(0, 17) : data;
    } else if (c !== n - 1) {
      head = [FRAG_MIDDLE | c];
      body = data.subarray(17 + 19 * (c - 1), 17 + 19 * c);
    } else {
      head = [FRAG_LAST | c];
      body = data.subarray(17 + 19 * (c - 1));
    }
    const f = new Uint8Array(head.length + body.length);
    f.set(head); f.set(body, head.length);
    frames.push(f);
  }
  return frames;
}

/** Reassembles notification fragments; feed() returns a complete inner message or null. */
export class MessageAssembler {
  private buf: number[] | null = null;
  reset() { this.buf = null; }
  feed(frame: Uint8Array | null | undefined): Uint8Array | null {
    if (!frame?.length) return null;
    const type = frame[0] & FRAG_MASK;
    if (type === FRAG_SINGLE) { this.buf = null; return frame.slice(3); }
    if (type === FRAG_FIRST) { this.buf = Array.from(frame.subarray(3)); return null; }
    if (type === FRAG_MIDDLE) { this.buf?.push(...frame.subarray(1)); return null; }
    if (type === FRAG_LAST) {
      if (!this.buf) return null;
      this.buf.push(...frame.subarray(1));
      const msg = Uint8Array.from(this.buf);
      this.buf = null;
      return msg;
    }
    return null;
  }
}

export const opcodeOf = (msg: Uint8Array | null) => (!msg || msg.length < HEADER_LEN ? 0 : (msg[9] << 8) | msg[10]);

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];

export type Model = 'lm3' | 'lm4';
export interface Measurement { model: Model; raw: number[]; batteryRaw: number; temperature: number | null }
export interface Calibration { model: Model; kSensor: number[] }

/**
 * RES_MEAS payload, model from its length:
 *   LM3: [skip][6 × u16 BE: 450/500/550/570/600/650 nm][battery mV u16][temperature u8]
 *   LM4: [skip][9 × u16 BE: AS7341 F1…F8 + clear][temperature ×10 u16][battery raw u16]
 */
export function parseMeasurement(msg: Uint8Array | null): Measurement | null {
  if (!msg || msg.length < HEADER_LEN + 16) return null;
  const p = msg.subarray(HEADER_LEN);
  if (p.length >= 23) {
    const raw = Array.from({ length: 9 }, (_, i) => u16be(p, 1 + 2 * i));
    const t10 = u16be(p, 19);
    return { model: 'lm4', raw, batteryRaw: u16be(p, 21), temperature: t10 > 0 && t10 < 1200 ? t10 / 10 : null };
  }
  return { model: 'lm3', raw: Array.from({ length: 6 }, (_, i) => u16be(p, 1 + 2 * i)), batteryRaw: u16be(p, 13), temperature: p[15] };
}

/** RES_CAL payload: float32 little-endian from payload[1], 7 (LM3) or 9 (LM4) factors. */
export function parseCalibration(msg: Uint8Array | null): Calibration | null {
  if (!msg || msg.length < HEADER_LEN + 29) return null;
  const p = msg.subarray(HEADER_LEN);
  const count = p.length >= 37 ? 9 : 7;
  const view = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const kSensor = Array.from({ length: count }, (_, i) => { const v = view.getFloat32(1 + 4 * i, true); return Number.isFinite(v) ? v : 1; });
  return { model: count === 9 ? 'lm4' : 'lm3', kSensor };
}
