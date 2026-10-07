import { describe, expect, it } from 'vitest';
import { MSG, PtpMonitor, buildPtp, errorText, isMulticastV4, parsePtp, parseRtp, parseSmTlv, rtpCheck, tsBytes } from '../server/ptp.mjs';

// Byte layouts written out by hand from the sources in server/ptp.mjs (IEEE 1588-2008 offsets as
// documented by the Wireshark dissector; SM TLV from SMPTE ST 2059-2:2021 Table 1/2).

const GM = 'aabbccfffe000001';

function announce({ domain = 127, clockClass = 6, utcOffset = 37, seq = 1, flags = 0x0004 | 0x0008 } = {}) {
  const body = Buffer.alloc(30);
  tsBytes(0n).copy(body, 0);                // 34 originTimestamp
  body.writeInt16BE(utcOffset, 10);         // 44 currentUtcOffset
  body[13] = 128;                           // 47 priority1
  body[14] = clockClass;                    // 48 clockClass
  body[15] = 0x21;                          // 49 clockAccuracy
  body.writeUInt16BE(0x4e5d, 16);           // 50 offsetScaledLogVariance
  body[18] = 128;                           // 52 priority2
  Buffer.from(GM, 'hex').copy(body, 19);    // 53 grandmasterIdentity
  body.writeUInt16BE(0, 27);                // 61 stepsRemoved
  body[29] = 0x20;                          // 63 timeSource GPS
  return buildPtp({ type: MSG.ANNOUNCE, domain, flags, clockIdentity: GM, sequenceId: seq, logMessageInterval: 0, body });
}

/** Management message (COMMAND) with SM TLV, ST 2059-2 Table 1 and 2. */
function smMessage() {
  const body = Buffer.alloc(14 + 52);
  body.fill(0xff, 0, 10);                   // 34 targetPortIdentity: all ones
  body[10] = 1; body[11] = 1;               // 44/45 boundary hops
  body[12] = 1;                             // 46 actionField = COMMAND
  const t = 14;                             // 48 SM TLV
  body.writeUInt16BE(0x0003, t);            // ORGANIZATION_EXTENSION
  body.writeUInt16BE(48, t + 2);
  Buffer.from([0x68, 0x97, 0xe8, 0x00, 0x00, 0x01]).copy(body, t + 4);
  // defaultSystemFrameRate 30000/1001: ST 2059-2 footnote 2: 00 00 75 30 00 00 03 e9
  Buffer.from('00007530000003e9', 'hex').copy(body, t + 10);
  body[t + 18] = 4;                         // gmLockingStatus: externally locked
  body[t + 19] = 1;                         // drop frame
  body.writeInt32BE(7200 - 37, t + 20);     // currentLocalOffset
  body.writeInt32BE(-3600, t + 24);         // jumpSeconds
  body.writeUIntBE(1_792_000_000, t + 28, 6);
  body.writeUIntBE(1_790_000_000, t + 34, 6);
  body.writeUIntBE(1_789_913_600, t + 40, 6);
  body.writeInt32BE(7200 - 37, t + 46);
  body[t + 50] = 0b011; body[t + 51] = 0;
  return buildPtp({ type: MSG.MANAGEMENT, clockIdentity: GM, body });
}

describe('PTP parser', () => {
  it('announce fields', () => {
    const m = parsePtp(announce());
    expect(m).toMatchObject({ type: MSG.ANNOUNCE, name: 'Announce', domain: 127, version: 2, currentUtcOffset: 37, clockClass: 6, priority1: 128, priority2: 128,
      grandmasterIdentity: GM, timeSource: 0x20, utcOffsetValid: true, ptpTimescale: true, length: 64 });
  });
  it('correctionField in scaled nanoseconds', () => {
    const m = parsePtp(buildPtp({ type: MSG.SYNC, correctionNs: 1234.5, body: tsBytes(5_000_000_123n) }));
    expect(m.correctionNs).toBeCloseTo(1234.5, 3);
    expect(m.timestampNs).toBe(5_000_000_123n);
  });
  it('SM TLV of ST 2059-2 Table 2', () => {
    const m = parsePtp(smMessage());
    expect(m.actionField).toBe(1);
    expect(m.sm).toMatchObject({ frameRateNum: 30000, frameRateDen: 1001, gmLockingStatus: 4, dropFrame: true, colorFrame: false,
      currentLocalOffset: 7163, jumpSeconds: -3600, timeOfNextJump: 1_792_000_000, timeOfNextJam: 1_790_000_000, timeOfPreviousJam: 1_789_913_600,
      previousJamLocalOffset: 7163, leapSecondJump: false });
    expect(m.sm.daylightSaving).toEqual({ current: true, next: true, previousJam: false });
  });
  it('rejects non-PTP and wrong TLVs', () => {
    expect(parsePtp(Buffer.alloc(10))).toBeNull();
    const b = announce(); b[1] = 1;
    expect(parsePtp(b)).toBeNull();
    expect(parseSmTlv(Buffer.alloc(60), 0)).toBeNull();
  });
});

describe('PTP monitor with synthetic packets', () => {
  const S = 1_790_000_000n * 1_000_000_000n; // PTP time of the GM in ns
  it('no packets: honest "none"', () => {
    const mon = new PtpMonitor({ now: () => 0n });
    expect(mon.status().state).toBe('none');
  });
  it('two-step sync: offset estimate includes the path delay until a delay is measured', () => {
    // local UTC clock is 250 µs ahead of the GM (after TAI − UTC = 37 s)
    let nowNs = S - 37n * 1_000_000_000n + 250_000n;
    const mon = new PtpMonitor({ now: () => nowNs, taiMinusUtc: () => 37 });
    const rx = () => mon.onPacket(announce(), { address: '10.0.0.1' }, nowNs);
    rx();
    for (let i = 0; i < 16; i++) {
      const t1 = S + BigInt(i) * 125_000_000n;
      // packet arrives 100 µs after t1 on the GM scale → local receive = t1 − 37 s + 250 µs + 100 µs
      nowNs = t1 - 37n * 1_000_000_000n + 350_000n;
      mon.onPacket(buildPtp({ type: MSG.SYNC, flags: 0x0200, clockIdentity: GM, sequenceId: i, body: tsBytes(0n) }), {}, nowNs);
      mon.onPacket(buildPtp({ type: MSG.FOLLOW_UP, clockIdentity: GM, sequenceId: i, correctionNs: 0, body: tsBytes(t1) }), {}, nowNs);
    }
    mon.onPacket(smMessage(), {}, nowNs);
    const st = mon.status();
    expect(st.state).toBe('receiving');
    expect(st.domain).toBe(127);
    expect(st.gm.identity).toBe('aa:bb:cc:ff:fe:00:00:01');
    expect(st.gm.clockClass).toBe(6);
    expect(st.twoStep).toBe(true);
    expect(st.pathDelayIncluded).toBe(true);
    expect(st.offsetNs).toBeCloseTo(350_000, -1);
    expect(st.sm.lockingText).toBe('locked');
    expect(st.sm.gmLockingStatus).toBe(4);
  });
  it('delay request-response removes the path delay', () => {
    let nowNs = S - 37n * 1_000_000_000n;
    const mon = new PtpMonitor({ now: () => nowNs, taiMinusUtc: () => 37 });
    mon.onPacket(announce(), {}, nowNs);
    // local clock 250 µs ahead, symmetric path 100 µs
    const t1 = S;
    nowNs = t1 - 37n * 1_000_000_000n + 350_000n;
    mon.onPacket(buildPtp({ type: MSG.SYNC, clockIdentity: GM, sequenceId: 7, body: tsBytes(t1) }), {}, nowNs);
    // our Delay_Req leaves at local t3, reaches the GM 100 µs later (GM scale: t3 − 250 µs + 100 µs)
    const t3local = nowNs + 1_000_000n;
    mon.pendingReq.set(42, { tx: t3local });
    const t4 = t3local + 37n * 1_000_000_000n - 250_000n + 100_000n;
    const body = Buffer.alloc(20); tsBytes(t4).copy(body, 0); Buffer.from(mon.ourId, 'hex').copy(body, 10); body.writeUInt16BE(1, 18);
    mon.onPacket(buildPtp({ type: MSG.DELAY_RESP, clockIdentity: GM, sequenceId: 42, body }), {}, nowNs);
    const st = mon.status();
    expect(st.meanPathDelayNs).toBeCloseTo(100_000, -1);
    expect(st.offsetNs).toBeCloseTo(250_000, -1);
    expect(st.pathDelayIncluded).toBe(false);
  });
  it('port errors are explained', () => {
    expect(errorText({ code: 'EACCES' }, 319)).toMatchObject({ code: 'ptp.permission', params: { port: 319 }, message: expect.stringMatching(/permission/) });
    expect(errorText({ code: 'EADDRINUSE' }, 320)).toMatchObject({ code: 'ptp.inUse', message: expect.stringMatching(/in use/) });
    expect(errorText(new Error('boom'), 320)).toEqual({ message: 'PTP: boom' });
  });
});

describe('ST 2110 RTP timestamps', () => {
  it('RTP header (RFC 3550 §5.1)', () => {
    const b = Buffer.alloc(12); b[0] = 0x80; b[1] = 0x80 | 96; b.writeUInt16BE(513, 2); b.writeUInt32BE(0xdeadbeef, 4);
    expect(parseRtp(b)).toMatchObject({ marker: true, payloadType: 96, seq: 513, timestamp: 0xdeadbeef });
  });
  it('lag and frame grid at 25 Hz and 60/1.001 Hz (ST 2110-10 §7.3/7.6, 90 kHz)', () => {
    const t = 1_790_000_000.0; // PTP seconds, integer → frame boundary at 25 Hz
    const ts = (t * 90000) % 2 ** 32;
    const r = rtpCheck(ts, t + 0.002, 25, 1);
    expect(r.lagSeconds).toBeCloseTo(0.002, 6);
    expect(r.lagFrames).toBeCloseTo(0.05, 6);
    expect(r.gridTicks).toBe(0);
    // 60/1.001: frame n has floor(n × 90000 × 1001 / 60000) (increments 1501/1502, ST 2110-10 Note)
    const n = 107_280_000_000;
    const full = Math.floor((n * 90000 * 1001) / 60000);
    const r2 = rtpCheck(full % 2 ** 32, full / 90000 + 0.001, 60000, 1001);
    expect(r2.gridTicks).toBe(0);
    expect(r2.frame).toBe(n);
    // a timestamp 45 ticks (0.5 ms) off the grid
    expect(rtpCheck((full + 45) % 2 ** 32, full / 90000 + 0.001, 60000, 1001).gridTicks).toBe(45);
  });
  it('multicast address check', () => {
    expect(isMulticastV4('239.1.2.3')).toBe(true);
    expect(isMulticastV4('192.168.1.1')).toBe(false);
    expect(isMulticastV4('239.1.2.300')).toBe(false);
  });
});
