import { describe, expect, it } from 'vitest';
import { audioGroup, bytesOf, colorimetryMismatch, parse2108, parseAfd, parseAtc, parseSt352, summarise, transferMismatch } from '../src/vanc';

// Fixtures built by hand from the bit tables (docs/research/vanc.md), not captured from hardware (#116).

/** ST 12-2 ATC user data words: each nibble of the 64 ST 12-1 bits in b7–b4, DBB in b3. */
function atc(digits: { h: number; m: number; s: number; f: number }, df: boolean, dbb1: number, userBits = 0): number[] {
  const nib = [
    digits.f % 10, 0, Math.floor(digits.f / 10) | (df ? 4 : 0), 0,
    digits.s % 10, 0, Math.floor(digits.s / 10), 0,
    digits.m % 10, 0, Math.floor(digits.m / 10), 0,
    digits.h % 10, 0, Math.floor(digits.h / 10), 0,
  ];
  for (let g = 0; g < 8; g++) nib[g * 2 + 1] = (userBits >> (g * 4)) & 0xf;
  return nib.map((v, i) => (v << 4) | (i < 8 ? ((dbb1 >> i) & 1) << 3 : 0));
}

describe('ST 352 payload ID', () => {
  it('1080p50 3G Level A, PQ, Rec.2020, 4:2:2, 10 bit', () => {
    // byte 2 = 1110 1001: progressive transport + picture, transfer 10b = PQ, rate 9h = 50
    // byte 3 = 0010 0000: colorimetry b5–b4 = 10b (UHDTV), sampling 0h = 4:2:2
    const p = parseSt352([0x89, 0xe9, 0x20, 0x01])!;
    expect(p).toMatchObject({ standard: '1080-line 3G Level A (ST 425-1)', progressiveTransport: true, progressivePicture: true, rate: '50', transfer: 'pq', colorimetry: '2020', sampling: '4:2:2 Y′CbCr', bitDepth: 10, ictcp: false });
  });
  it('1080i59.94 1.5G: interlaced, HLG, colorimetry in the sparse bits b7 + b4, 16:9 in b5', () => {
    // byte 2 = 0001 1010: interlaced, HLG (01b), rate Ah; byte 3 = 1010 0000: b7 = 1, b4 = 0 → 10b UHDTV, b5 aspect
    const p = parseSt352([0x85, 0x1a, 0xa0, 0x01])!;
    expect(p).toMatchObject({ progressivePicture: false, rate: '59.94', transfer: 'hlg', colorimetry: '2020', aspect16x9: true });
  });
  it('2160p 12G, SDR 709, ICtCp flag, 12 bit', () => {
    const p = parseSt352([0xce, 0xcb, 0x81, 0x12])!;
    expect(p).toMatchObject({ standard: '2160-line 12G (ST 2082-10)', rate: '60', transfer: 'sdr', colorimetry: '709', sampling: '4:4:4 Y′CbCr', aspect16x9: true, ictcp: true, bitDepth: 12 });
  });
  it('rejects short packets and version-0 byte 1', () => {
    expect(parseSt352([0x89, 0xe9])).toBeNull();
    expect(parseSt352([0x09, 0xe9, 0x20, 0x01])).toBeNull();
  });
  it('unknown payload codes keep the raw byte, no invented name', () => {
    expect(parseSt352([0xfe, 0xc0, 0x00, 0x01])).toMatchObject({ standard: null, payload: 0xfe, rate: null });
  });
});

describe('ST 12-2 ATC', () => {
  it('LTC 10:23:45:12, user bits', () => {
    expect(parseAtc(atc({ h: 10, m: 23, s: 45, f: 12 }, false, 0, 0x12345678))).toEqual({ tc: '10:23:45:12', dropFrame: false, colourFrame: false, kind: 'ltc', userBits: '12345678' });
  });
  it('VITC1 drop frame 01:00:00;02', () => {
    expect(parseAtc(atc({ h: 1, m: 0, s: 0, f: 2 }, true, 1))).toMatchObject({ tc: '01:00:00;02', dropFrame: true, kind: 'vitc1' });
  });
  it('rejects non-BCD digits and short packets', () => {
    expect(parseAtc(new Array(16).fill(0xf0))).toBeNull();
    expect(parseAtc([0, 0, 0])).toBeNull();
  });
});

describe('ST 2108-1 HDR/WCG', () => {
  // static type 1: SEI 137 with BT.2020 primaries (G 0.170/0.797, B 0.131/0.046, R 0.708/0.292), D65, 1000/0.0001 cd/m²
  const mdcv = [0x00, 26, 137, 24,
    ...[8500, 39850, 6550, 2300, 35400, 14600, 15635, 16450].flatMap((v) => [v >> 8, v & 0xff]),
    ...[10000000, 1].flatMap((v) => [(v >>> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff])];
  const cll = [0x01, 6, 144, 4, 0x03, 0xe8, 0x01, 0x90];
  it('mastering display and content light level', () => {
    const h = parse2108([...mdcv, ...cll])!;
    expect(h.frames).toEqual([{ type: 0, length: 26 }, { type: 1, length: 6 }]);
    expect(h.mdcv!.primaries[0][0]).toBeCloseTo(0.708, 3);
    expect(h.mdcv!.primaries[1][1]).toBeCloseTo(0.797, 3);
    expect(h.mdcv!.white[0]).toBeCloseTo(0.3127, 4);
    expect(h.mdcv!.maxNits).toBe(1000);
    expect(h.mdcv!.minNits).toBeCloseTo(0.0001, 6);
    expect(h.cll).toEqual({ maxCll: 1000, maxFall: 400 });
  });
  it('dynamic frames are named by type, truncated frames stop the walk', () => {
    expect(parse2108([0x02, 2, 4, 0])!.dynamic).toEqual([1]);
    expect(parse2108([0x00, 26, 137])).toBeNull();
  });
});

describe('presence, AFD, summary, mismatch', () => {
  it('AFD 1010b (16:9) in a 16:9 frame', () => { expect(parseAfd([(0b1010 << 3) | 4])).toEqual({ afd: 10, frame16x9: true }); });
  it('ST 299 audio DIDs map to groups', () => {
    expect(audioGroup(0xe7)).toEqual({ group: 1, control: false });
    expect(audioGroup(0xe0)).toEqual({ group: 4, control: true });
    expect(audioGroup(0xa6)).toEqual({ group: 6, control: false });
    expect(audioGroup(0x61)).toBeNull();
  });
  it('summary of a mixed record', () => {
    const s = summarise([
      { did: 0x41, sdid: 0x01, line: 10, data: '89e92001' },
      { did: 0x61, sdid: 0x01, line: 9, data: '9669' },
      { did: 0xe7, sdid: 0x00, line: 9, data: '' }, { did: 0xe3, sdid: 0x00, line: 9, data: '' }, { did: 0xe6, sdid: 0x00, line: 9, data: '' },
      { did: 0x60, sdid: 0x60, line: 9, data: atc({ h: 10, m: 0, s: 0, f: 0 }, false, 0).map((b) => b.toString(16).padStart(2, '0')).join('') },
      { did: 0x99, sdid: 0x01, line: 12, data: 'ab' },
    ]);
    expect(s.st352?.transfer).toBe('pq');
    expect(s.cea708).toBe(true);
    expect(s.audioGroups).toEqual([1, 2]);
    expect(s.audioControl).toEqual([1]);
    expect(s.atc[0].tc).toBe('10:00:00:00');
    expect(s.packets.map((p) => p.name)).toContain(null);
    expect(s.packets[0].line).toBe(9);
  });
  it('transfer and colorimetry mismatch', () => {
    expect(transferMismatch('pq', 'hlg')).toBe('pq');
    expect(transferMismatch('hlg', 'hlg')).toBeNull();
    expect(transferMismatch('sdr', 'pq')).toBe('sdr');
    expect(transferMismatch('sdr', 'slog3' as never)).toBeNull();
    expect(transferMismatch('unspecified', 'pq')).toBeNull();
    expect(colorimetryMismatch('2020', '709')).toBe('2020');
    expect(colorimetryMismatch('709', '2020')).toBe('709');
    expect(colorimetryMismatch('unknown', '709')).toBeNull();
  });
  it('hex helper stops at garbage', () => { expect(bytesOf('0a0bzz')).toEqual([10, 11]); });
});
