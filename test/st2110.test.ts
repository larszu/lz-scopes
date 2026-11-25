// ST 2110-20 / 2022-6 receive, packet timing (2110-21), test signal generator (#228, #229, #237).
// Generated packets only; the loopback test sends over 127.0.0.1. No real 2110 device involved.
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { parseSdp2110, pictureSections, writeSdp } from '../server/st2110/sdp.mjs';
// @ts-expect-error plain JS module
import { VideoAssembler, packPlan, packetizeFrame, packRow422, v210Bytes, rtpHeader } from '../server/st2110/video.mjs';
// @ts-expect-error plain JS module
import { SdiAssembler, xyz, sdiGeometry, horizontalTotal } from '../server/st2110/sdi.mjs';
// @ts-expect-error plain JS module
import { model, VideoTiming, FlowStats } from '../server/st2110/timing.mjs';
// @ts-expect-error plain JS module
import { videoFlow, audioFlow, ancFlow, sdiFlow, alignment, timeAddress, atcUdw, rfc8331Payload, barsPicture, Sender } from '../server/st2110/generator.mjs';
// @ts-expect-error plain JS module
import { Receiver, DupMerger } from '../server/st2110/receiver.mjs';
import { parseAtc } from '../src/vanc';

type Pkt = { at: number; marker: boolean; ts: number; payload: Buffer; field?: number };
type Frame = { buf: Buffer; meta: { ts: number; broken: boolean } };

/** v210 component k of a row (Cb Y0 Cr Y1 …, 3 per 32-bit word). */
const comp = (buf: Buffer, rowWords: number, row: number, k: number) => {
  const w = new Uint32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  return (w[row * rowWords + ((k / 3) | 0)] >> ((k % 3) * 10)) & 1023;
};
const feed = (asm: { push: (p: unknown) => void }, pkts: Pkt[], seq0 = 0, skip = -1) => {
  pkts.forEach((p, i) => { if (i !== skip) asm.push({ marker: p.marker, seq: (seq0 + i) & 0xffff, ts: p.ts, payload: p.payload }); });
  return seq0 + pkts.length;
};

describe('SDP (ST 2110-20 §7, ST 2110-21 §8, ST 2022-8)', () => {
  const v = videoFlow({ format: 'small' });
  it('writes and reads back a 2110-20 flow', () => {
    const sdp = parseSdp2110(writeSdp({ legs: [{ group: '239.10.0.1', port: 5004, source: '192.0.2.10' }], flow: v }));
    const m = sdp.media[0];
    expect(m).toMatchObject({ kind: 'video', group: '239.10.0.1', port: 5004, source: '192.0.2.10', sampling: 'YCbCr-4:2:2', depth: 10, width: 192, height: 108, tp: '2110TPN', tcs: 'SDR', transfer: 'bt709', matrix: 'bt709', mediaclk: 'direct=0' });
    expect(m.rate).toEqual({ num: 25, den: 1 });
    expect(m.pgroup).toEqual({ bytes: 5, pixels: 2 });
  });
  it('TCS and colorimetry decide HDR, RANGE=FULL the range', () => {
    const text = 'v=0\r\no=- 1 1 IN IP4 192.0.2.1\r\ns=cam\r\nt=0 0\r\nm=video 5000 RTP/AVP 112\r\nc=IN IP4 239.1.1.1/32\r\na=rtpmap:112 raw/90000\r\n'
      + 'a=fmtp:112 sampling=YCbCr-4:2:2; width=1920; height=1080; exactframerate=60000/1001; depth=10; TCS=PQ; colorimetry=BT2100; PM=2110GPM; SSN=ST2110-20:2017; TP=2110TPNL; RANGE=FULL; TROFF=640; CMAX=8; interlace\r\n';
    const m = parseSdp2110(text).media[0];
    expect(m).toMatchObject({ transfer: 'smpte2084', primaries: 'bt2020', matrix: 'bt2020', fullRange: true, tp: '2110TPNL', troffUs: 640, cmax: 8, interlace: true });
    expect(m.rate).toEqual({ num: 60000, den: 1001 });
  });
  it('ST 2022-7: two legs grouped as DUP', () => {
    const sdp = parseSdp2110(writeSdp({ legs: [{ group: '239.10.0.1', port: 5004 }, { group: '239.20.0.1', port: 5004 }], flow: v }));
    expect(sdp.dup).toBe(true);
    const { primary, secondary } = pictureSections(sdp);
    expect([primary.group, secondary.group]).toEqual(['239.10.0.1', '239.20.0.1']);
  });
  it('2022-6, 2110-30 and 2110-40 sections', () => {
    const kinds = [sdiFlow({ frame: 0x30, frate: 0x12 }), audioFlow({ channels: 8 }), ancFlow()].map((flow) => parseSdp2110(writeSdp({ legs: [{ group: '239.0.0.9', port: 5010 }], flow })).media[0]);
    expect(kinds.map((k: { kind: string }) => k.kind)).toEqual(['sdi', 'audio', 'anc']);
    expect(kinds[0].clock).toBe(27000000);
    expect(kinds[1]).toMatchObject({ channels: 8, bits: 24, ptime: 1 });
  });
  it('rejects oversize input', () => {
    expect(() => parseSdp2110('x'.repeat(70000))).toThrow();
  });
});

describe('ST 2110-20 packets → v210 (§6.1, §6.2.4)', () => {
  const v = videoFlow({ format: 'small' });
  const rowWords = Math.ceil(192 / 48) * 32;
  const assemble = (pkts: Pkt[], opts = {}, skip = -1) => {
    const frames: Frame[] = [];
    const asm = new VideoAssembler({ width: 192, height: 108, sampling: 'YCbCr-4:2:2', depth: 10, ...opts }, (buf: Buffer, meta: Frame['meta']) => frames.push({ buf, meta }));
    feed(asm, pkts, 0, skip);
    return { frames, asm };
  };
  it('packing plan: one SRD per packet, within the standard UDP limit, marker on the last', () => {
    const plan = packPlan({ width: 1920, height: 1080, pgroup: { bytes: 5, pixels: 2 } });
    expect(plan.length).toBe(4320);
    expect(Math.max(...plan.map((p: { bytes: number }) => p.bytes)) + 12 + 8).toBeLessThanOrEqual(1460);
    expect(plan.filter((p: { marker: boolean }) => p.marker).length).toBe(1);
  });
  it('bars arrive bit-exact', () => {
    const { frames } = assemble(v.period(100, 0));
    expect(frames.length).toBe(1);
    expect(frames[0].buf.length).toBe(v210Bytes(192, 108));
    for (const row of [0, 50, 107]) {
      const want = v.picture(row);
      for (let k = 0; k < 384; k++) expect(comp(frames[0].buf, rowWords, row, k)).toBe(want[k]);
    }
  });
  it('a lost packet marks the frame broken and keeps it from the scopes', () => {
    const { frames, asm } = assemble(v.period(100, 0), {}, 20);
    expect(frames.length).toBe(0);
    expect(asm.broken).toBe(1);
  });
  it('packets with two SRD headers (other senders)', () => {
    // one packet carries the end of row 0 and the start of row 1
    const pkts = v.period(100, 0) as Pkt[];
    const a = pkts[0].payload, b = pkts[1].payload;
    const lenA = a.readUInt16BE(2), lenB = b.readUInt16BE(2);
    const merged = Buffer.alloc(2 + 12 + lenA + lenB);
    a.copy(merged, 0, 0, 8); merged.writeUInt16BE(merged.readUInt16BE(6) | 0x8000, 6);
    b.copy(merged, 8, 2, 8);
    a.copy(merged, 14, 8); b.copy(merged, 14 + lenA, 8);
    const { frames } = assemble([{ ...pkts[0], payload: merged }, ...pkts.slice(2)]);
    expect(frames.length).toBe(1);
    expect(comp(frames[0].buf, rowWords, 1, 0)).toBe(v.picture(1)[0]);
  });
  it('interlaced: two fields, rows woven back (§6.1.5)', () => {
    const pic = barsPicture(192, 108);
    // a different value per frame row so that a wrong weave shows
    const rowOf = (r: number) => { const c = Uint16Array.from(pic(r)); c[1] = 64 + r; return c; };
    const fmt = { width: 192, height: 108, interlace: true, pgroup: { bytes: 5, pixels: 2 } };
    const pkts = packetizeFrame(fmt, (r: number) => packRow422(rowOf(r), 10)) as { payload: Buffer; marker: boolean; field: number }[];
    expect(pkts.filter((p) => p.marker).length).toBe(2);
    const frames: Frame[] = [];
    const asm = new VideoAssembler({ width: 192, height: 108, interlace: true, sampling: 'YCbCr-4:2:2', depth: 10 }, (buf: Buffer, meta: Frame['meta']) => frames.push({ buf, meta }));
    pkts.forEach((p, i) => asm.push({ marker: p.marker, seq: i, ts: p.field ? 1800 : 0, payload: p.payload }));
    expect(frames.length).toBe(1);
    for (const r of [0, 1, 2, 53, 106, 107]) expect(comp(frames[0].buf, rowWords, r, 1)).toBe(64 + r);
  });
  it('8-bit pgroups land in the upper bits', () => {
    const v8 = videoFlow({ format: 'small', depth: 8 });
    const frames: Frame[] = [];
    const asm = new VideoAssembler({ width: 192, height: 108, sampling: 'YCbCr-4:2:2', depth: 8 }, (buf: Buffer, meta: Frame['meta']) => frames.push({ buf, meta }));
    feed(asm, v8.period(7, 0));
    expect(comp(frames[0].buf, rowWords, 0, 1)).toBe((v8.picture(0)[1] >> 2) << 2);
  });
  it('rejects formats it cannot build', () => {
    expect(() => new VideoAssembler({ width: 1920, height: 1080, sampling: 'RGB', depth: 10 }, () => {})).toThrow();
  });
});

describe('ST 2022-6 (HBRMT) → v210', () => {
  it('TRS protection bits: XYZ of Fig. 5 is 2D8h', () => {
    expect(xyz(0, 1, 1)).toBe(0x2d8);
    expect(xyz(0, 0, 0)).toBe(0x200);
    expect(xyz(1, 1, 1)).toBe(0x3c4);
  });
  it('geometry from the header codes (§6.5): 720p50 = 2699 datagrams', () => {
    expect(horizontalTotal(0x30, 0x12)).toBe(1980);
    expect(horizontalTotal(0x21, 0x12)).toBe(2640);
    const g = sdiGeometry(0x30, 0x12, 0x01);
    expect(g.octetsPerFrame).toBe(1980 * 2 * 10 / 8 * 750);
    expect(g.datagrams).toBe(Math.floor(g.octetsPerFrame / 1376) + 1);
  });
  it('generated 720p50 frame comes back with the active picture', () => {
    const f = sdiFlow({ frame: 0x30, frate: 0x12 });
    const frames: { buf: Buffer; meta: { trsErrors: number } }[] = [];
    const asm = new SdiAssembler({ onFrame: (buf: Buffer, meta: { trsErrors: number }) => frames.push({ buf, meta }) });
    feed(asm, f.period(3, 0));
    expect(frames.length).toBe(1);
    expect(frames[0].meta.trsErrors).toBe(0);
    const rowWords = Math.ceil(1280 / 48) * 32;
    for (const row of [0, 400, 719]) for (const k of [0, 1, 640, 2559]) expect(comp(frames[0].buf, rowWords, row, k)).toBe(f.picture(row)[k]);
  });
});

describe('ST 2110-21 timing model (§6, §7.1)', () => {
  it('1080p50 type N: TRS, TROFFSET default, CMAX, VRXFULL', () => {
    const m = model({ rate: { num: 50, den: 1 }, height: 1080, tp: '2110TPN', npackets: 4320 });
    // TRS = TFRAME · 1080/1125 / NPACKETS
    expect(m.trs).toBeCloseTo((0.02 * 1080 / 1125) / 4320, 12);
    expect(m.troDefault).toBeCloseTo((43 / 1125) * 0.02, 12);
    // CMAX = MAX(4, INT(4320 / (43200 · 0.96 · 0.02))) = 5; VRXFULL = MAX(8, INT(4320 / 540)) = 8
    expect(m.cmax).toBe(5);
    expect(m.vrxFull).toBe(8);
  });
  it('wide sender and interlaced read schedule', () => {
    const w = model({ rate: { num: 50, den: 1 }, height: 1080, tp: '2110TPW', npackets: 4320 });
    expect(w.cmax).toBe(16);
    expect(w.vrxFull).toBe(720);
    const i = model({ rate: { num: 25, den: 1 }, height: 1080, interlace: true, tp: '2110TPN', npackets: 4320 });
    expect(i.rActive).toBeCloseTo(1080 / 1125, 12);
    // second field read from TFRAME/2 + TLINE/2
    expect(i.tpr(2160)).toBeCloseTo(0.02 + 0.04 / 1125 / 2, 12);
  });
  it('RTP time stamp at the alignment point, truncated (ST 2110-10 §7.6)', () => {
    // frame 1 at 60000/1001: 1001/60000 s = 1501.5 ticks → 1501
    expect(alignment(1, { num: 60000, den: 1001 }, 0).ts).toBe(1501);
    expect(alignment(2, { num: 60000, den: 1001 }, 0).ts).toBe(3003);
  });
});

describe('Packet timing of a flow (2110-21 CINST/VRX, RP 2110-25 style values)', () => {
  const v = videoFlow({ format: 'small' });
  const epochSec = 1_800_000_000;
  const first = Math.ceil((epochSec * 25) / 1) + 10;
  const run = (shape: (p: Pkt, j: number) => number, frames = 30) => {
    const t = new VideoTiming({ rate: v.rate, height: v.height, tp: '2110TPN', troffUs: null }, { epochSec });
    let seq = 0;
    for (let n = first; n < first + frames; n++) (v.period(n, epochSec) as Pkt[]).forEach((p, j) => t.packet(shape(p, j), { seq: seq++ & 0xffff, ts: p.ts, marker: p.marker }, p.payload.length + 12));
    return t.status();
  };
  it('a sender on the gapped schedule passes CINST and VRX, 0 µs RTP offset', () => {
    const st = run((p) => p.at + 20e-6);
    expect(st.timestamps).toBe('software');
    expect(st.npackets).toBe(108);
    expect(st.verdict).toEqual({ cinst: true, vrx: true });
    expect(st.lost).toBe(0);
    expect(Math.abs(st.rtpOffsetUs.mean)).toBeLessThan(12); // truncation to the 90 kHz grid
    expect(st.pathDelayUs.mean).toBeGreaterThan(0);
    expect(st.iatUs.mean).toBeGreaterThan(0);
  });
  it('all packets of a frame in one burst: CINST above CMAX', () => {
    // arrival = TVD + j · 0.1 µs instead of TVD + TPRj − TRS/2
    const st = run((p, j) => p.at - (v.model.tpr(j) - v.model.trs / 2) + j * 1e-7);
    expect(st.cinst.max).toBeGreaterThan(st.model.cmax);
    expect(st.verdict.cinst).toBe(false);
  });
  it('late packets: VRX underflow counted', () => {
    const st = run((p) => p.at + v.model.T * 0.6);
    expect(st.latePackets).toBeGreaterThan(0);
    expect(st.verdict.vrx).toBe(false);
  });
  it('sequence errors per flow', () => {
    const s = new FlowStats({ epochSec: 0 });
    [1, 2, 3, 6, 5, 7, 7].forEach((seq, i) => s.packet(i * 0.001, { seq, ts: 0, marker: false }, 100));
    const st = s.status();
    expect(st.lost).toBe(1); // 4 lost, 5 came late (reordered)
    expect(st.reordered).toBe(1);
    expect(st.duplicates).toBe(1);
  });
});

describe('Generator: audio and ancillary flows (ST 2110-30, -40)', () => {
  it('L24 tone at −18 dBFS, 48 samples per 1 ms packet', () => {
    const a = audioFlow({ channels: 2, freq: 1000 });
    const p = a.period(0, 0)[0];
    expect(p.payload.length).toBe(48 * 2 * 3);
    let peak = 0;
    for (let s = 0; s < 48; s++) peak = Math.max(peak, Math.abs(p.payload.readIntBE(s * 6, 3)));
    expect(20 * Math.log10(peak / 8388607)).toBeCloseTo(-18, 1);
    expect(audioFlow({ channels: 64 }).ptimeMs).toBe(0.125);
  });
  it('ATC time code in RFC 8331, readable by the VANC decoder', () => {
    // 10:20:30:12 at 25 fps
    const fod = ((10 * 60 + 20) * 60 + 30) * 25 + 12;
    const udw = atcUdw(timeAddress(fod, 25));
    expect(parseAtc(udw.map((w: number) => w & 0xff))?.tc).toBe('10:20:30:12');
    const pay = rfc8331Payload([{ line: 10, did: 0x60, sdid: 0x60, udw }]);
    expect(pay[4]).toBe(1); // ANC_Count
    // first ANC packet: C(1) Line(11) Offset(12) S(1) StreamNum(7), then DID with parity
    const bits = (o: number, n: number) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | ((pay[8 + ((o + i) >> 3)] >> (7 - ((o + i) & 7))) & 1); return v; };
    expect(bits(1, 11)).toBe(10);
    expect(bits(32, 10) & 0xff).toBe(0x60);
    expect(bits(52, 10) & 0xff).toBe(16);
  });
  it('time address at 50 fps counts frame pairs', () => {
    expect(timeAddress(101, 50)[0]).toBe(0); // frame 101 = pair 50 = 2 s 0 frames, second of the pair
    expect(timeAddress(101, 50)[4]).toBe(2);
  });
});

describe('ST 2022-7 merge', () => {
  it('first copy wins, the other leg fills gaps', () => {
    const out: number[] = [];
    const m = new DupMerger((b: Buffer) => out.push(b.readUInt16BE(2)));
    const pkt = (seq: number) => rtpHeader({ pt: 96, seq, ts: 0, ssrc: 1 });
    m.push(0, pkt(1), 0); m.push(1, pkt(1), 0); m.push(1, pkt(2), 0); m.push(0, pkt(3), 0); m.push(1, pkt(3), 0);
    expect(out).toEqual([1, 2, 3]);
    expect(m.fromSecondary).toBe(1);
    expect(m.duplicates).toBe(2);
  });
});

describe('Loopback: generator → receiver over UDP (127.0.0.1)', () => {
  it('2110-20 bars arrive as v210 frames with timing counters', async () => {
    const port = 21000 + Math.floor(Math.random() * 20000);
    const tx = new Sender(videoFlow({ format: 'small' }), { legs: [{ host: '127.0.0.1', port }] });
    const frames: Buffer[] = [];
    let info: { width: number; pixel: string } | null = null;
    const rx = new Receiver(tx.sdp('127.0.0.1'), { onInfo: (i: typeof info) => { info = i; }, onFrame: (b: Buffer) => frames.push(b) });
    await rx.start();
    await tx.start();
    const until = Date.now() + 4000;
    while (frames.length < 5 && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    tx.stop(); rx.stop();
    expect(info).toMatchObject({ width: 192, pixel: 'v210' });
    expect(frames.length).toBeGreaterThanOrEqual(5);
    const rowWords = Math.ceil(192 / 48) * 32;
    const want = videoFlow({ format: 'small' }).picture(10);
    for (let k = 0; k < 384; k += 7) expect(comp(frames[frames.length - 1], rowWords, 10, k)).toBe(want[k]);
    const st = rx.status();
    expect(st.timing.npackets).toBe(108);
    expect(st.timing.packets).toBeGreaterThan(500);
  }, 10000);
});
