import { describe, expect, it } from 'vitest';
import { edhErrors, fieldSwapHints, parseCdp, parseEdh, parseOp47, parseScte104, parseSt2031 } from '../src/anc';
import { TeletextDecoder, decodeText, hamming84, hamming84Encode, parseHeader, parsePacket, reverse } from '../src/teletext';
import { packetName, summarise } from '../src/vanc';

// Fixtures built by hand from the layouts cited in src/anc.ts / src/teletext.ts, not captured (#116).

const hex = (b: number[]) => b.map((v) => v.toString(16).padStart(2, '0')).join('');
const be16 = (v: number) => [(v >> 8) & 255, v & 255];
const be32 = (v: number) => [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255];
const withChecksum = (b: number[]) => { const s = b.reduce((a, v) => a + v, 0); return [...b, (256 - (s & 255)) & 255]; };
const parity = (c: number) => { let n = 0; for (let i = 0; i < 7; i++) n += (c >> i) & 1; return n % 2 ? c : c | 0x80; };
const text40 = (s: string) => Array.from(s.padEnd(40, ' ').slice(0, 40), (ch) => parity(ch.charCodeAt(0)));

/** 42 teletext bytes: address (magazine, row) + 40 data bytes. */
function packet(mag: number, row: number, data: number[]): number[] {
  return [hamming84Encode((mag & 7) | ((row & 1) << 3)), hamming84Encode(row >> 1), ...data];
}
/** Row 0 of page mag/tens/units; subtitle = C6, erase = C4, option = C12–C14. */
function header(mag: number, page: number, { subtitle = false, erase = false, option = 0 } = {}, text = 'LZ TEXT') {
  const n = [page & 15, (page >> 4) & 15, 0, erase ? 8 : 0, 0, subtitle ? 8 : 0, 0, ((option >> 2) & 1) << 1 | ((option >> 1) & 1) << 2 | (option & 1) << 3];
  return packet(mag, 0, [...n.map(hamming84Encode), ...text40(text).slice(0, 32)]);
}

describe('teletext (EN 300 706)', () => {
  it('Hamming 8/4: every nibble round-trips, single bit errors are corrected, 0 → 15h', () => {
    expect(hamming84Encode(0)).toBe(0x15);
    for (let n = 0; n < 16; n++) {
      const c = hamming84Encode(n);
      expect(hamming84(c)).toBe(n);
      for (let b = 0; b < 8; b++) expect(hamming84(c ^ (1 << b))).toBe(n);
    }
  });
  it('odd parity text, parity errors and the German national option', () => {
    expect(decodeText(text40('Hallo')).text.trim()).toBe('Hallo');
    const bad = text40('AB'); bad[1] ^= 0x80;
    expect(decodeText(bad)).toMatchObject({ parityErrors: 1 });
    expect(decodeText([parity(0x5b), parity(0x7e)], 1).text).toBe('Äß');
  });
  it('page header: page number, subtitle and erase bits, option', () => {
    const h = parseHeader(parsePacket(header(8, 0x88, { subtitle: true, erase: true, option: 1 }))!)!;
    expect(h).toMatchObject({ page: '888', subtitle: true, erase: true, option: 1 });
  });
  it('decoder keeps the subtitle page and its rows', () => {
    const d = new TeletextDecoder();
    d.push(header(1, 0x00), 1);
    d.push(packet(1, 5, text40('Index')), 2);
    d.push(header(8, 0x88, { subtitle: true, erase: true }), 3);
    d.push(packet(8, 22, text40('  Untertitel Zeile')), 4);
    expect(d.current()).toEqual({ page: '888', rows: [{ row: 22, text: 'Untertitel Zeile' }], at: 3 });
  });
});

describe('SCTE 104 (ST 2010)', () => {
  it('multiple operation message with a splice request and a VITC time stamp', () => {
    const op = [1, ...be32(4711), ...be16(3), ...be16(4000), ...be16(300), 1, 2, 1];
    // reserved FFFFh, size, protocol_version, AS_index, message_number, DPI_PID_index, SCTE35 version, time stamp, num_ops, ops
    const m = [...be16(0xffff), 0, 0, 0, 5, 7, ...be16(0), 0, 2, 10, 11, 12, 13, 1, ...be16(0x0101), ...be16(op.length), ...op];
    m[2] = m.length >> 8; m[3] = m.length & 255;
    const r = parseScte104([0x08, ...m])!;
    expect(r).toMatchObject({ multiple: true, asIndex: 5, messageNumber: 7, timestamp: 'VITC 10:11:12:13', truncated: false, continued: false });
    expect(r.ops).toHaveLength(1);
    expect(r.ops[0].splice).toEqual({ type: 1, typeName: 'start normal', eventId: 4711, programId: 3, preRollMs: 4000, breakTenths: 300, autoReturn: true });
  });
  it('segmentation descriptor and a cut-off message', () => {
    const seg = [...be32(99), 0, ...be16(60), 9, 2, 0xab, 0xcd, 0x34, 1, 2, 0, 0, 0, 0, 0, 0];
    const m = [...be16(0xffff), 0, 0, 0, 1, 1, ...be16(0), 0, 0, 1, ...be16(0x010b), ...be16(seg.length), ...seg];
    m[2] = m.length >> 8; m[3] = m.length & 255;
    expect(parseScte104([0x08, ...m])!.ops[0].segmentation).toEqual({ eventId: 99, cancel: false, durationS: 60, typeId: 0x34, segmentNum: 1, segmentsExpected: 2 });
    expect(parseScte104([0x08, ...m.slice(0, 20)])!.truncated).toBe(true);
  });
});

describe('CEA-708 CDP (ST 334-2)', () => {
  const cdp = (f1: [number, number][], f2: [number, number][]) => {
    const cc = [...f1.flatMap(([a, b]) => [0xfc, a, b]), ...f2.flatMap(([a, b]) => [0xfd, a, b]), 0xfe, 0, 0];
    const n = f1.length + f2.length + 1;
    const b = [0x96, 0x69, 0, 0x3f, 0x43, ...be16(0x1234), 0x72, 0xe0 | n, ...cc, 0x74, ...be16(0x1234)];
    b[2] = b.length + 1;
    return withChecksum(b);
  };
  it('header, triplets per field, checksum', () => {
    const c = parseCdp(cdp([[0x94, 0x2c]], [[0x15, 0x2c]]))!;
    expect(c).toMatchObject({ identifierOk: true, rate: '25', ccdata: true, serviceActive: true, sequence: 0x1234, ccCount: 3, dtvcc: 1, checksumOk: true });
    expect(c.field1).toEqual([[0x94, 0x2c]]);
    expect(fieldSwapHints(c.field1, c.field2)).toEqual({ inField1: 0, inField2: 0 });
  });
  it('CC1 control codes in field 2 hint at swapped fields', () => {
    const c = parseCdp(cdp([[0x15, 0x2c]], [[0x94, 0x2c]]))!;
    expect(fieldSwapHints(c.field1, c.field2)).toEqual({ inField1: 1, inField2: 1 });
    const broken = cdp([], []); broken[broken.length - 1] ^= 1;
    expect(parseCdp(broken)!.checksumOk).toBe(false);
  });
});

describe('OP-47 and ST 2031', () => {
  const tt = header(8, 0x88, { subtitle: true });
  it('OP-47 SDP: descriptors, run-in, checksum, teletext packet', () => {
    const b = [0x51, 0x15, 0, 0x02, 0x80 | 21, 0, 0, 0, 0, 0x55, 0x55, 0x27, ...tt, 0x74, ...be16(7)];
    b[2] = b.length + 1;
    const o = parseOp47(withChecksum(b))!;
    expect(o).toMatchObject({ identifierOk: true, format: 2, sequence: 7, checksumOk: true });
    expect(o.lines).toHaveLength(1);
    expect(o.lines[0]).toMatchObject({ line: 21, field: 1, runInOk: true });
    expect(parseHeader(o.lines[0].packet!)!.page).toBe('888');
  });
  it('ST 2031 teletext subtitles: bit-reversed bytes, field parity, line offset', () => {
    const df = [0x20 | 7, 0xe4, ...tt.map(reverse)];
    const d = parseSt2031([0x10, 0x03, df.length, ...df])!;
    expect(d).toMatchObject({ unitName: 'EBU teletext subtitles', field: 1, lineOffset: 7 });
    expect(d.raw42).toEqual(tt);
    expect(parseSt2031([0x10, 0xc4, 2, 0x05, 0x00])!.unitName).toBe('WSS');
  });
});

describe('EDH (RP 165)', () => {
  it('CRC words, valid bits and flags', () => {
    const crc = 0xbeef;
    const w = [(crc & 63) << 2, ((crc >> 6) & 63) << 2, (((crc >> 12) & 15) << 2) | 0x80];
    const e = parseEdh([...w, ...w, 0, 0x08, 0x04, 0, 0, 0, 0, 0, 0, 0])!;
    expect(e).toMatchObject({ apCrc: crc, apValid: true, ffCrc: crc, ffValid: true });
    expect(e.ff.eda).toBe(true); expect(e.ap.edh).toBe(true); expect(e.anc.edh).toBe(false);
    expect(edhErrors(e)).toBe(true);
    expect(edhErrors(parseEdh([...w, ...w, 0, 0, 0])!)).toBe(false);
  });
});

describe('summary of the new packet types', () => {
  it('names and decoding in summarise()', () => {
    expect(packetName(0x41, 0x07)).toMatch(/SCTE 104/);
    expect(packetName(0x43, 0x02)).toMatch(/OP-47/);
    expect(packetName(0xf4, 0x00)).toMatch(/EDH/);
    const s = summarise([
      { did: 0xf4, sdid: 0, line: 9, data: hex([0, 0, 0x80, 0, 0, 0x80, 0, 0, 0]) },
      { did: 0x41, sdid: 0x08, line: 12, data: hex([0x10, 0xc4, 2, 0x05, 0]) },
    ]);
    expect(s.edh?.apValid).toBe(true);
    expect(s.st2031[0].unitName).toBe('WSS');
  });
});
