// ST 2110 receive (#226, #227, #230, #232): SDP, payload decoders, ST 2022-7 evaluation, pcap,
// and a loopback run through real UDP sockets and the bridge's frame socket. No real 2110
// sender was available: every packet here is generated (docs/research/st2110-empfang.md).
import { describe, expect, it } from 'vitest';
import dgram from 'node:dgram';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error plain JS module
import { flowsFromSdp, layoutOf, parseChannelOrder, parseDidSdid, parseSdp, parseSt2110Url } from '../server/sdp.mjs';
// @ts-expect-error plain JS module
import { DupEvaluator, buildAnc, decodeAm824, decodeLinear, dupClass, parseAnc, parseFmx, parityOk, udwHex } from '../server/st2110.mjs';
// @ts-expect-error plain JS module
import { RingCapture, Snapshot, ipChecksum, ipv4Udp, pcapHeader, pcapRecord, readPcap } from '../server/pcap.mjs';
// @ts-expect-error plain JS module
import { St2110Service } from '../server/st2110stream.mjs';
import { parseAtc, parseSt352, summarise } from '../src/vanc';

// documentation multicast (RFC 5771 233.252.0.0/24, as in ST 2110-10's own example) and TEST-NET source
const AES67_SDP = [
  'v=0', 'o=- 1 1 IN IP4 198.51.100.1', 's=Studio A Audio 1', 't=0 0',
  'a=group:DUP primary secondary',
  'm=audio 5004 RTP/AVP 97', 'c=IN IP4 233.252.0.10/64', 'a=source-filter: incl IN IP4 233.252.0.10 198.51.100.1',
  'a=rtpmap:97 L24/48000/8', 'a=fmtp:97 channel-order=SMPTE2110.(51,ST)', 'a=ptime:1', 'a=mediaclk:direct=0', 'a=ts-refclk:ptp=IEEE1588-2008:traceable', 'a=mid:primary',
  'm=audio 5004 RTP/AVP 97', 'c=IN IP4 233.252.0.110/64', 'a=source-filter: incl IN IP4 233.252.0.110 198.51.100.2',
  'a=rtpmap:97 L24/48000/8', 'a=fmtp:97 channel-order=SMPTE2110.(51,ST)', 'a=ptime:1', 'a=mid:secondary',
].join('\r\n');
const ANC_SDP = [
  'v=0', 'o=- 2 2 IN IP4 198.51.100.1', 's=Anc', 't=0 0',
  'm=video 5006 RTP/AVP 100', 'c=IN IP4 233.252.0.20/64', 'a=rtpmap:100 smpte291/90000',
  'a=fmtp:100 DID_SDID={0x41,0x01};DID_SDID={0x60,0x60};VPID_Code=133;SSN=ST2110-40:2023;TM=CTM;exactframerate=50',
].join('\n');

describe('SDP (ST 2110-10/-30/-40, RFC 7104)', () => {
  it('reads an AES67 SDP with ST 2022-7 duplication into one flow with two paths', () => {
    const s = parseSdp(AES67_SDP);
    expect(s.groups).toEqual([{ semantics: 'DUP', mids: ['primary', 'secondary'] }]);
    expect(s.media[0]).toMatchObject({ media: 'audio', port: 5004, pt: 97, encoding: 'L24', clock: 48000, channels: 8, ptime: 1, dest: '233.252.0.10', ttl: 64, source: '198.51.100.1', essence: 'audio30', mediaclk: 'direct=0' });
    const f = flowsFromSdp([AES67_SDP]);
    expect(f).toHaveLength(1);
    expect(f[0].paths).toEqual([
      { dest: '233.252.0.10', port: 5004, source: '198.51.100.1', mid: 'primary' },
      { dest: '233.252.0.110', port: 5004, source: '198.51.100.2', mid: 'secondary' },
    ]);
  });
  it('reads 2110-40 format parameters (repeated DID_SDID, exactframerate)', () => {
    const [f] = flowsFromSdp([ANC_SDP]);
    expect(f).toMatchObject({ essence: 'anc40', encoding: 'SMPTE291', clock: 90000 });
    expect(f.fmtp.DID_SDID.map(parseDidSdid)).toEqual([{ did: 0x41, sdid: 0x01 }, { did: 0x60, sdid: 0x60 }]);
    expect(f.fmtp).toMatchObject({ VPID_Code: '133', TM: 'CTM', exactframerate: '50' });
  });
  it('AM824 (2110-31) and Fast Metadata (2110-41)', () => {
    const am = flowsFromSdp([['v=0', 's=x', 'm=audio 5008 RTP/AVP 98', 'c=IN IP4 233.252.0.30', 'a=rtpmap:98 AM824/48000/4', 'a=ptime:1'].join('\n')]);
    expect(am[0]).toMatchObject({ essence: 'audio31', channels: 4 });
    const fmx = flowsFromSdp([['v=0', 's=x', 'm=application 5010 RTP/AVP 117', 'c=IN IP4 233.252.0.40', 'a=rtpmap:117 ST2110-41/90000', 'a=fmtp:117 SSN=ST2110-41:2024; DIT=100,2000A1'].join('\n')]);
    expect(fmx[0]).toMatchObject({ essence: 'fmx41', clock: 90000 });
    expect(fmx[0].fmtp.DIT).toBe('100,2000A1');
  });
  it('channel-order: ST 2110-30 Table 1, Undefined for the rest', () => {
    expect(parseChannelOrder('SMPTE2110.(51,ST)', 8).map((g: { symbol: string }) => g.symbol)).toEqual(['51', 'ST']);
    expect(parseChannelOrder('SMPTE2110.(M,M,M,M,ST,U02)', 8).map((g: { channels: string[] }) => g.channels.length)).toEqual([1, 1, 1, 1, 2, 2]);
    // fewer declared than present → the rest is one Undefined group
    expect(parseChannelOrder('SMPTE2110.(ST)', 4).map((g: { symbol: string }) => g.symbol)).toEqual(['ST', 'U02']);
    // no parameter → all Undefined
    expect(parseChannelOrder(undefined, 2)[0]).toMatchObject({ symbol: 'U02', undeclared: true });
    expect(layoutOf(parseChannelOrder('SMPTE2110.(51)', 6))).toBe('5.1');
    expect(layoutOf(parseChannelOrder('SMPTE2110.(51,ST)', 8))).toBe('');
  });
  it('st2110: URLs: SDP or manual flows, checked values', () => {
    const u = parseSt2110Url(`st2110:?sdp=${encodeURIComponent(AES67_SDP)}&sdp=${encodeURIComponent(ANC_SDP)}`);
    expect(u.flows.map((f: { essence: string }) => f.essence)).toEqual(['audio30', 'anc40']);
    const m = parseSt2110Url('st2110:?audio=233.252.0.10:5004,233.252.0.110:5004&fmt=AM824&ch=2&anc=233.252.0.20:5006');
    expect(m.flows[0]).toMatchObject({ essence: 'audio31', clock: 48000, channels: 2 });
    expect(m.flows[0].paths).toHaveLength(2);
    expect(parseSt2110Url('st2110:?audio=233.252.0.10:5004&rate=32000')).toBeNull(); // 2110-30: 44.1/48/96 kHz only
    expect(parseSt2110Url('st2110:?audio=233.252.0.10:5004&fmt=AM824&ch=3')).toBeNull(); // 2110-31: even
    expect(parseSt2110Url('st2110:?audio=233.252.0.10:80')).toBeNull();
    expect(parseSt2110Url('st2110:?audio=nohost:5004')).toBeNull();
    expect(parseSt2110Url('st2110:?sdp=garbage')).toBeNull();
  });
});

describe('audio payloads (ST 2110-30 L16/L24, ST 2110-31 AM824)', () => {
  it('L24 and L16 big-endian two’s complement', () => {
    const p = Buffer.from([0x40, 0, 0, 0x80, 0, 0, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect([...decodeLinear(p, 2, 24)]).toEqual([0.5, -1, 8388607 / 8388608, -1 / 8388608]);
    expect([...decodeLinear(Buffer.from([0xc0, 0, 0x7f, 0xff]), 1, 16)]).toEqual([-0.5, 32767 / 32768]);
  });
  it('AM824: DATA24, V and B bits, AES3 even parity', () => {
    // subframe 1: B|F set, sample 0x200000 (one 1-bit), P set to make the count even
    const s1 = [0x20 | 0x10 | 0x08, 0x20, 0, 0];
    // subframe 2: V set, sample 0x000000, P = 1 → V + P = 2 ones → even
    const s2 = [0x08 | 0x01, 0, 0, 0];
    // subframe 3: parity wrong (one data bit, no P)
    const s3 = [0x00, 0, 0, 1];
    const d = decodeAm824(Buffer.from([...s1, ...s2, ...s3, 0, 0, 0, 0]), 2);
    expect([...d.pcm]).toEqual([0.25, 0, 1 / 8388608, 0]);
    expect(d).toMatchObject({ v: 1, b: 1, parity: 1 });
  });
});

describe('ancillary data (RFC 8331, ST 2110-40) into the VANC decoder', () => {
  // ST 352 for 1080p50 10 bit (payload byte 1 = 0x89, see test/vanc.test.ts) and an ATC LTC
  const st352 = [0x89, 0xc9, 0x20, 0x01];
  it('round trip of two packets, 32-bit word alignment, parity and checksum', () => {
    const atc = Array.from({ length: 16 }, (_, i) => (i === 0 ? 0x08 : 0)); // DBB1 bit 0 in UDW1 = VITC1? only layout matters here
    const p = buildAnc([{ did: 0x41, sdid: 0x01, line: 10, udw: st352 }, { did: 0x60, sdid: 0x60, line: 9, c: 1, s: 1, stream: 1, udw: atc }], { extSeq: 3, field: 1 });
    // first packet 32 + 3·10 + 4·10 + 10 = 112 bits → 128 (4 words); second 32 + 30 + 160 + 10 = 232 → 256
    expect(p.readUInt16BE(2)).toBe(16 + 32);
    const d = parseAnc(p);
    expect(d).toMatchObject({ extSeq: 3, count: 2, field: 1 });
    expect(d.packets[0]).toMatchObject({ did: 0x41, sdid: 0x01, line: 10, hOffset: 0xfff, dataCount: 4, checksumOk: true, parityOk: true });
    expect(d.packets[1]).toMatchObject({ did: 0x60, sdid: 0x60, line: 9, c: 1, s: 1, stream: 1 });
    const pkts = d.packets.map((x: { did: number; sdid: number; line: number; stream: number; udw: number[] }) => ({ did: x.did, sdid: x.sdid, line: x.line, stream: x.stream, data: udwHex(x.udw) }));
    expect(pkts[0].data).toBe('89c92001');
    expect(parseSt352([...st352])).toBeTruthy();
    const sum = summarise(pkts);
    expect(sum.st352?.rate).toBe(parseSt352(st352)?.rate);
    expect(parseAtc(atc)).toBeTruthy();
  });
  it('flags a wrong checksum, ignores F = 0b01 and empty packets', () => {
    const bad = parseAnc(buildAnc([{ did: 0x61, sdid: 0x02, udw: [1, 2, 3], badChecksum: true }]));
    expect(bad.packets[0].checksumOk).toBe(false);
    const f01 = buildAnc([{ did: 0x61, sdid: 0x02, udw: [1] }]); f01[5] = 0x40;
    expect(parseAnc(f01).error).toBe('field');
    expect(parseAnc(buildAnc([]))).toMatchObject({ count: 0, length: 0, packets: [] });
    expect(parityOk(0x241)).toBe(true); // 0x41: two ones → p = 0, b9 = 1
    expect(parityOk(0x141)).toBe(false);
  });
  it('2110-41 Data Item Packages: type, K bit, length in 32-bit words', () => {
    const b = Buffer.alloc(4 + 8 + 4 + 4);
    b.writeUInt32BE(((0x2000a1 << 10) | (1 << 9) | 2) >>> 0, 0); b.writeUInt32BE(0xdeadbeef, 4);
    b.writeUInt32BE((0x100 << 10) | 1, 12);
    const d = parseFmx(b);
    expect(d.items.map((i: { type: number; k: number; length: number }) => [i.type, i.k, i.length])).toEqual([[0x2000a1, 1, 2], [0x100, 0, 1]]);
    expect(parseFmx(Buffer.from([0, 0, 0, 0])).error).toBe('length'); // length 0 is not allowed
  });
});

describe('ST 2022-7 evaluation', () => {
  const rtp = (seq: number, ts: number) => ({ seq: seq & 0xffff, ts: ts >>> 0 });
  it('offset, PD, one-path and both-path losses, buffer depth and class', () => {
    const d = new DupEvaluator({ clock: 48000, windowMs: 100 });
    // 1 packet per ms (48 samples); B is 3 ms later, ±0.5 ms; A loses 10–12, B loses 20, both lose 30
    let t = 0;
    for (let i = 0; i < 200; i++, t += 1) {
      const r = rtp(65500 + i, i * 48); // crosses the 16-bit wrap
      const jit = (i % 2 ? 0.5 : -0.5);
      if (![10, 11, 12, 30].includes(i)) d.push(0, r, t, 300);
      if (![20, 30].includes(i)) d.push(1, r, t + 3 + jit, 300);
    }
    const s = d.status(t + 500);
    expect(s.paths[0].only).toBe(1); // 20: only on A
    expect(s.paths[1].only).toBe(3); // 10–12: only on B
    expect(s.lostBoth).toBe(1);
    expect(s.both).toBe(195);
    expect(s.offsetMinMs).toBeCloseTo(2.5); expect(s.offsetMaxMs).toBeCloseTo(3.5);
    expect(s.pdMaxMs).toBeCloseTo(3.5);
    expect(s.bufferMs).toBeCloseTo(3.5);
    expect(s.bufferPackets).toBe(4);
    expect(s.class).toBe('A');
    expect(s.paths[0].jitterMs).toBeLessThan(0.05);
    expect(s.paths[1].jitterMs).toBeGreaterThan(0.3); // ±0.5 ms alternating: |D| = 1 ms per packet
    expect(s.tsMismatch).toBe(0);
  });
  it('first copy wins; duplicates and late copies are counted, not passed on', () => {
    const d = new DupEvaluator({ clock: 90000, windowMs: 50 });
    expect(d.push(0, rtp(1, 0), 0)).toBe(true);
    expect(d.push(1, rtp(1, 0), 1)).toBe(false);
    expect(d.push(0, rtp(1, 0), 2)).toBe(false);
    expect(d.status(3).paths[0].duplicates).toBe(1);
    d.push(0, rtp(2, 1800), 100);
    d.status(200);
    expect(d.push(1, rtp(1, 0), 201)).toBe(false);
    expect(d.status(202).late).toBe(1);
  });
  it('Table 1 classes', () => {
    expect(dupClass(0.1, false)).toBe('D');
    expect(dupClass(9, false)).toBe('A');
    expect(dupClass(40, false)).toBe('B');
    expect(dupClass(300, false)).toBe('C');
    expect(dupClass(300, true)).toBe('beyond');
  });
});

describe('pcap', () => {
  it('nanosecond header, rebuilt IPv4/UDP, read back', () => {
    const h = pcapHeader();
    expect(h.readUInt32LE(0)).toBe(0xa1b23c4d);
    expect(h.readUInt32LE(20)).toBe(228);
    const f = ipv4Udp({ src: '198.51.100.1', srcPort: 40000, dst: '233.252.0.10', dstPort: 5004, payload: Buffer.from('rtp!') });
    expect(ipChecksum(f.subarray(0, 20))).toBe(0); // a correct header sums to 0xffff
    expect(f.readUInt16BE(2)).toBe(32);
    expect([...f.subarray(16, 20)]).toEqual([233, 252, 0, 10]);
    const file = Buffer.concat([h, pcapRecord(1_700_000_000_123_456_789n, f)]);
    const r = readPcap(file);
    expect(r.records[0]).toMatchObject({ sec: 1_700_000_000, nsec: 123_456_789, orig: 32 });
    expect(r.records[0].data.subarray(28).toString()).toBe('rtp!');
  });
  it('snapshot stops at the size limit', async () => {
    const s = new Snapshot({ seconds: 10, maxBytes: 1024 });
    for (let i = 0; i < 100; i++) s.add(pcapRecord(0n, Buffer.alloc(100)));
    const r = await s.done;
    expect(r.reason).toBe('size');
    expect(r.data.length).toBeLessThanOrEqual(1024);
    expect(readPcap(r.data).records).toHaveLength(r.packets);
  });
  it('rolling capture keeps only the last seconds', () => {
    let now = 0;
    const ring = new RingCapture({ dir: join(mkdtempSync(join(tmpdir(), 'lzs-ring-')), 'r'), seconds: 10, segmentSeconds: 5, now: () => now });
    try {
      for (let i = 0; i < 300; i++, now += 100) ring.add(pcapRecord(BigInt(i), Buffer.from([i & 0xff])));
      const r = readPcap(ring.save());
      // 30 s written, ring 10 s + one running segment of up to 5 s
      expect(r.records.length).toBeGreaterThanOrEqual(100);
      expect(r.records.length).toBeLessThanOrEqual(150);
      expect(r.records.at(-1)!.nsec).toBe(299);
    } finally { ring.stop(); }
  });
});

// ---- loopback: real sockets on 127.0.0.1

async function freePort(): Promise<number> {
  const s = dgram.createSocket('udp4');
  await new Promise<void>((res) => s.bind(0, '127.0.0.1', () => res()));
  const p = s.address().port; s.close();
  return p;
}
const until = async (f: () => boolean, ms = 5000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); } };

/** RTP packet (RFC 3550 §5.1) around a payload. */
function rtpPacket(pt: number, seq: number, ts: number, payload: Buffer, marker = false) {
  const h = Buffer.alloc(12);
  h[0] = 0x80; h[1] = (marker ? 0x80 : 0) | pt; h.writeUInt16BE(seq & 0xffff, 2); h.writeUInt32BE(ts >>> 0, 4); h.writeUInt32BE(0x1234abcd, 8);
  return Buffer.concat([h, payload]);
}
/** 1 kHz sine, L24 stereo, 48 samples per packet (ptime 1 ms, ST 2110-30 level A). */
function l24Packet(n: number, amp = 0.5) {
  const b = Buffer.alloc(48 * 2 * 3);
  for (let k = 0; k < 48; k++) {
    const v = Math.round(Math.sin((2 * Math.PI * 1000 * (n * 48 + k)) / 48000) * amp * 8388607);
    for (let c = 0; c < 2; c++) b.writeIntBE(v, (k * 2 + c) * 3, 3);
  }
  return b;
}

describe('loopback receive (generated RTP over 127.0.0.1)', () => {
  it('audio over two paths with a lost packet on each, ANC with time reference, pcap of the service', async () => {
    const [pa, pb, pn] = [await freePort(), await freePort(), await freePort()];
    const url = `st2110:?audio=127.0.0.1:${pa},127.0.0.1:${pb}&fmt=L24&ch=2&order=${encodeURIComponent('SMPTE2110.(ST)')}&anc=127.0.0.1:${pn}`;
    const cfg = parseSt2110Url(url);
    const bins: Buffer[] = [], msgs: Record<string, unknown>[] = [];
    const svc = new St2110Service(cfg, { send: (m: Record<string, unknown>) => msgs.push(m), sendBin: (b: Buffer) => bins.push(b), ptpNow: () => ({ seconds: 1_000_000, ref: 'system' }) }).start();
    const tx = dgram.createSocket('udp4');
    const send = (b: Buffer, port: number) => new Promise<void>((res) => tx.send(b, port, '127.0.0.1', () => res()));
    try {
      expect(svc.info().audio).toMatchObject({ sampleRate: 48000, channels: 2, layout: 'stereo', codec: 'L24' });
      await new Promise((r) => setTimeout(r, 50));
      const snap = svc.takeSnapshot({ seconds: 0.6 });
      for (let n = 0; n < 200; n++) {
        const pkt = rtpPacket(97, 1000 + n, 7000 + n * 48, l24Packet(n));
        if (n !== 50) await send(pkt, pa); // A loses 50
        if (n !== 120) await send(pkt, pb); // B loses 120
        if (n % 20 === 0) await send(rtpPacket(100, 500 + n / 20, n * 1800, buildAnc([{ did: 0x41, sdid: 0x01, line: 10, udw: [0x89, 0xc9, 0x20, 0x01] }]), true), pn);
        if (n % 10 === 0) await new Promise((r) => setTimeout(r, 2));
      }
      const frames = () => bins.reduce((s, b) => s + b.readUInt32LE(4), 0);
      await until(() => frames() >= 190 * 48);
      svc.packetizer.flush();
      // every packet arrived on at least one path → no gap in the sample index
      const first = bins.map((b) => b.readDoubleLE(8));
      for (let i = 1; i < bins.length; i++) expect(first[i]).toBe(first[i - 1] + bins[i - 1].readUInt32LE(4));
      expect(frames()).toBe(200 * 48);
      expect(svc.audioGaps).toBe(0);
      // the 1 kHz sine at −6 dBFS came through
      const pcm = new Float32Array(Buffer.concat(bins.map((b) => b.subarray(16))).buffer.slice(0));
      const peak = pcm.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
      expect(peak).toBeGreaterThan(0.49); expect(peak).toBeLessThan(0.51);
      const vanc = msgs.find((m) => m.type === 'vanc') as { packets: { did: number; data: string }[]; rtp: { ts: number } };
      expect(vanc.packets[0]).toMatchObject({ did: 0x41, sdid: 0x01, line: 10, data: '89c92001' });
      const st = svc.stats();
      expect(st.flows[0].dup.paths.map((p: { packets: number }) => p.packets)).toEqual([199, 199]);
      expect(st.flows[1].anc).toMatchObject({ packets: 10, checksum: 0, parity: 0 });
      const r = await snap;
      // pcap of the service: both audio paths and the ANC flow
      const rec = readPcap(r.data).records;
      const ports = new Set(rec.map((x: { data: Buffer }) => x.data.readUInt16BE(22)));
      expect([...ports].sort()).toEqual([pa, pb, pn].sort());
      // after the 2022-7 window: one packet only on B, one only on A, none lost on both
      await new Promise((res) => setTimeout(res, 1100));
      const dupSt = svc.stats().flows[0].dup;
      expect(dupSt.paths[0].only).toBe(1);
      expect(dupSt.paths[1].only).toBe(1);
      expect(dupSt.lostBoth).toBe(0);
      expect(dupSt.offsetMaxMs).not.toBeNull();
    } finally { tx.close(); svc.stop(); }
  }, 20_000);

  it('a packet lost on both paths becomes a gap in the sample index', async () => {
    const pa = await freePort();
    const svc = new St2110Service(parseSt2110Url(`st2110:?audio=127.0.0.1:${pa}&fmt=L16&ch=1`), { sendBin: () => {} }).start();
    const tx = dgram.createSocket('udp4');
    try {
      await new Promise((r) => setTimeout(r, 30));
      for (let n = 0; n < 40; n++) if (n !== 10) await new Promise<void>((res) => tx.send(rtpPacket(97, n, n * 48, Buffer.alloc(96)), pa, '127.0.0.1', () => res()));
      await until(() => svc.receivers[0].audio.frames >= 39 * 48);
      expect(svc.audioGaps).toBe(1);
      expect(svc.receivers[0].reorder.lost).toBe(1);
    } finally { tx.close(); svc.stop(); }
  });

  it('through the bridge: /stream?url=st2110:… delivers protocol 2 sound and stats', async () => {
    // @ts-expect-error plain JS module
    const { startBridge, validateInput } = await import('../server/index.mjs');
    const { default: WebSocket } = await import('ws');
    expect(validateInput('st2110:?audio=1.2.3:5004')).toMatchObject({ code: 'st2110.badUrl' });
    const pa = await freePort();
    const bridge = await startBridge({ port: 0 });
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/stream?url=${encodeURIComponent(`st2110:?audio=127.0.0.1:${pa}&fmt=L24&ch=2`)}&audio=1&video=0`);
    const got: { info: Record<string, unknown> | null; audio: number; stats: Record<string, unknown> | null; pcap: Record<string, unknown> | null } = { info: null, audio: 0, stats: null, pcap: null };
    const tx = dgram.createSocket('udp4');
    let timer: ReturnType<typeof setInterval> | undefined;
    try {
      ws.on('message', (d: Buffer, bin: boolean) => {
        if (bin) { if (d.subarray(0, 4).toString() === 'LZA1') got.audio += d.readUInt32LE(4); return; }
        const m = JSON.parse(String(d));
        if (m.type === 'info') got.info = m;
        if (m.type === 'stats' && m.st2110) got.stats = m;
        if (m.type === 'pcap' && m.state === 'saved') got.pcap = m;
      });
      await until(() => !!got.info);
      expect(got.info).toMatchObject({ proto: 2, width: 0, audio: { sampleRate: 48000, channels: 2 }, st2110: { capture: true } });
      let n = 0;
      timer = setInterval(() => { for (let k = 0; k < 5; k++, n++) tx.send(rtpPacket(97, n, n * 48, l24Packet(n)), pa, '127.0.0.1'); }, 5);
      await until(() => got.audio >= 4800 && !!got.stats, 8000);
      ws.send(JSON.stringify({ type: 'pcap', cmd: 'snapshot', seconds: 0.3 }));
      await until(() => !!got.pcap, 5000);
      const list = await (await fetch(`http://127.0.0.1:${bridge.port}/api/st2110`)).json();
      expect(list).toHaveLength(1);
      const file = await fetch(`http://127.0.0.1:${bridge.port}/api/st2110/file?name=${encodeURIComponent(String(got.pcap!.file))}`);
      expect(file.headers.get('content-type')).toBe('application/vnd.tcpdump.pcap');
      expect(readPcap(Buffer.from(await file.arrayBuffer())).records.length).toBeGreaterThan(10);
      const snap = await fetch(`http://127.0.0.1:${bridge.port}/api/st2110/pcap?id=${list[0].id}&seconds=0.2`);
      expect(readPcap(Buffer.from(await snap.arrayBuffer())).records.length).toBeGreaterThan(5);
      const ring = await fetch(`http://127.0.0.1:${bridge.port}/api/st2110/ring`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: list[0].id, mode: 'on', seconds: 10 }) });
      expect((await ring.json()).ok).toBe(true);
      await new Promise((r) => setTimeout(r, 400));
      const saved = await (await fetch(`http://127.0.0.1:${bridge.port}/api/st2110/ring/save`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: list[0].id }) })).json();
      expect(saved.ok).toBe(true);
      expect(saved.bytes).toBeGreaterThan(24);
      expect((await fetch(`http://127.0.0.1:${bridge.port}/api/st2110/file?name=../../etc/passwd`)).status).toBe(404);
    } finally { clearInterval(timer); tx.close(); ws.close(); bridge.close(); }
  }, 30_000);
});

describe('UI side (src/st2110.ts)', () => {
  it('builds st2110: URLs the bridge accepts, names them', async () => {
    const { st2110Url, st2110Name } = await import('../src/st2110');
    const manual = st2110Url({ manual: { kind: 'audio', primary: '233.252.0.10:5004', secondary: '233.252.0.110:5004', fmt: 'L24', rate: 48000, ch: 8, order: 'SMPTE2110.(51,ST)' } });
    const cfg = parseSt2110Url(manual);
    expect(cfg.flows[0]).toMatchObject({ essence: 'audio30', channels: 8, fmtp: { 'channel-order': 'SMPTE2110.(51,ST)' } });
    expect(cfg.flows[0].paths).toHaveLength(2);
    expect(st2110Name(manual)).toBe('ST 2110-30');
    const sdp = st2110Url({ sdp: [AES67_SDP, ANC_SDP] });
    expect(parseSt2110Url(sdp).flows.map((f: { essence: string }) => f.essence)).toEqual(['audio30', 'anc40']);
    expect(st2110Name(sdp)).toBe('Studio A Audio 1');
    expect(st2110Name(st2110Url({ manual: { kind: 'anc', primary: '233.252.0.20:5006' } }))).toBe('ST 2110-40');
  });
  it('Messwerte lines show 2022-7 values, ANC counters and the software-time note', async () => {
    const { st2110Lines } = await import('../src/st2110');
    const { setLang } = await import('../src/i18n');
    setLang('en');
    const dup = new DupEvaluator({ clock: 48000 });
    for (let n = 0; n < 100; n++) { dup.push(0, { seq: n, ts: n * 48 }, n); dup.push(1, { seq: n, ts: n * 48 }, n + 3); }
    const flow = { essence: 'audio30', encoding: 'L24', clock: 48000, channels: 2, paths: [{ dest: '233.252.0.10', port: 5004, source: '' }, { dest: '233.252.0.110', port: 5004, source: '' }], packets: 200, badRtp: 0, ptMismatch: 0, payloadErrors: 0, ssrcChanges: 0, lost: 0, reordered: 0, jitterMs: 0, dup: dup.status(2000), audio: { frames: 4800, validity: 0, blocks: 0, parity: 0, overlap: 0, order: ['ST'] } };
    const anc = { ...flow, essence: 'anc40', encoding: 'SMPTE291', clock: 90000, channels: 1, paths: [flow.paths[0]], dup: null, audio: undefined, anc: { frames: 5, packets: 10, checksum: 1, parity: 0, fieldErr: 0, types: { '41/01': 10 } } };
    const lines = st2110Lines({ flows: [flow, anc], audioGaps: 0, audioSent: 10, capture: { snapshot: false, ring: null } } as never).join('\n');
    expect(lines).toContain('path offset B − A 3.00 ms');
    expect(lines).toContain('class A');
    expect(lines).toContain('checksum errors 1');
    expect(lines).toContain('41/01 ×10');
    expect(lines).toContain('software receive time');
  });
  it('every st2110 code of the bridge has a text in both languages', async () => {
    const en = (await import('../src/i18n/en/bridge')).default as Record<string, string>;
    const de = (await import('../src/i18n/de/bridge')).default as Record<string, string>;
    for (const c of ['badUrl', 'inUse', 'join', 'socket', 'busy', 'ringOff', 'captureDenied']) {
      expect(en).toHaveProperty(`bridge.st2110.${c}`);
      expect(de).toHaveProperty(`bridge.st2110.${c}`);
    }
  });
});
