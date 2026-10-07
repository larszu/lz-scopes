import Foundation
import Testing
@testable import LzRtsp

// Same cases as test/rtp.test.ts for the JavaScript original (server/rtp.mjs).

/// RTP packet (RFC 3550 §5.1) with optional CSRC, header extension and padding.
func rtp(_ payload: [UInt8], seq: Int = 1, ts: UInt32 = 0, marker: Bool = false, pt: UInt8 = 96, csrc: Int = 0, ext: Int = 0, pad: Int = 0) -> [UInt8] {
    var b: [UInt8] = [0x80 | (pad > 0 ? 0x20 : 0) | (ext > 0 ? 0x10 : 0) | UInt8(csrc), (marker ? 0x80 : 0) | pt,
                      UInt8((seq >> 8) & 0xff), UInt8(seq & 0xff),
                      UInt8(ts >> 24), UInt8((ts >> 16) & 0xff), UInt8((ts >> 8) & 0xff), UInt8(ts & 0xff), 0, 0, 0x12, 0x34]
    b += [UInt8](repeating: 0, count: csrc * 4)
    if ext > 0 { b += [0xbe, 0xde, 0, UInt8(ext)] + [UInt8](repeating: 0, count: ext * 4) }
    b += payload
    if pad > 0 { b += [UInt8](repeating: 0, count: pad - 1) + [UInt8(pad)] }
    return b
}

func nal(_ type: UInt8, _ n: Int, fill: UInt8 = 0xaa) -> [UInt8] { [0x60 | type] + [UInt8](repeating: fill, count: n - 1) }
func annexB(_ nals: [[UInt8]]) -> [UInt8] { nals.flatMap { [0, 0, 0, 1] + $0 } }

/// H.264 packetiser (RFC 6184 non-interleaved): small NAL units in one STAP-A, large ones as FU-A.
func packetiseH264(_ nals: [[UInt8]], ts: UInt32, seq0: Int, mtu: Int = 100) -> [[UInt8]] {
    var payloads: [[UInt8]] = []
    let small = nals.filter { $0.count + 2 < mtu / 2 }, large = nals.filter { $0.count + 2 >= mtu / 2 }
    if small.count > 1 {
        payloads.append([(small[0][0] & 0x60) | 24] + small.flatMap { [UInt8($0.count >> 8), UInt8($0.count & 0xff)] + $0 })
    } else if let s = small.first { payloads.append(s) }
    for n in large {
        let body = Array(n.dropFirst())
        var o = 0
        while o < body.count {
            let s = o == 0, e = o + mtu >= body.count
            payloads.append([(n[0] & 0xe0) | 28, (s ? 0x80 : 0) | (e ? 0x40 : 0) | (n[0] & 0x1f)] + body[o..<min(body.count, o + mtu)])
            o += mtu
        }
    }
    return payloads.enumerated().map { i, p in rtp(p, seq: seq0 + i, ts: ts, marker: i == payloads.count - 1) }
}

@Suite struct RtpTests {
    @Test func testHeaderSkipsCsrcExtensionPadding() {
        let p = RtpPacket(rtp([1, 2, 3], seq: 65535, ts: 0xffff_fff0, marker: true, pt: 97, csrc: 2, ext: 1, pad: 3))!
        #expect(p.marker); #expect(p.pt == 97); #expect(p.seq == 65535); #expect(p.ts == 0xffff_fff0)
        #expect(p.payload == [1, 2, 3])
        #expect(RtpPacket([UInt8](repeating: 0, count: 8)) == nil)
        #expect(RtpPacket([0x40] + [UInt8](repeating: 0, count: 15)) == nil) // version 1
    }

    @Test func testSeqDiffAcrossWrap() {
        #expect(seqDiff(65535, 0) == 1)
        #expect(seqDiff(0, 65535) == -1)
        #expect(seqDiff(100, 90) == -10)
    }

    @Test func testClockAcrossWrap() {
        let c = RtpClock(rate: 90000)
        #expect(c.ms(0xffff_0000) == 0)
        #expect(c.ms(0xffff_0000 + 3600) == 40)
        #expect(abs((c.ms(0x0001_0000)) - (Double(0x20000) * 1000 / 90000)) <= 1e-6) // after the wrap
        #expect(c.ms(0xffff_0000 + 3600) == 40) // late packet from before the wrap
    }

    func run(_ pkts: [[UInt8]], gaps: Set<Int> = [], codec: VideoCodec = .h264) -> ([AccessUnit], Depacketizer) {
        var out: [AccessUnit] = []
        let d = Depacketizer(codec: codec) { out.append($0) }
        for (i, b) in pkts.enumerated() { d.push(RtpPacket(b)!, gap: gaps.contains(i)) }
        return (out, d)
    }

    @Test func testH264StapAndFuToAccessUnits() {
        let au1 = [nal(7, 10), nal(8, 4), nal(5, 450)], au2 = [nal(1, 300)]
        let (out, _) = run(packetiseH264(au1, ts: 0, seq0: 1) + packetiseH264(au2, ts: 3600, seq0: 20))
        #expect(out.count == 2)
        #expect(out[0].data == annexB(au1)); #expect(out[0].key)
        #expect(out[1].data == annexB(au2)); #expect(!(out[1].key))
        #expect(out[1].ts == 3600)
    }

    @Test func testWithoutMarkerTheTimestampChangeEndsTheUnit() {
        let a = packetiseH264([nal(5, 40)], ts: 0, seq0: 1).map { var b = $0; b[1] &= 0x7f; return b }
        let b = packetiseH264([nal(1, 40)], ts: 3600, seq0: 2)
        let (out, _) = run(a + b)
        #expect(out.count == 2)
        #expect(out[0].key)
    }

    @Test func testGapDropsUnitAndWaitsForKeyFrame() {
        let k = packetiseH264([nal(5, 450)], ts: 0, seq0: 1)
        let d1 = packetiseH264([nal(1, 300)], ts: 3600, seq0: 10)
        let d2 = packetiseH264([nal(1, 300)], ts: 7200, seq0: 20)
        let k2 = packetiseH264([nal(5, 450)], ts: 10800, seq0: 30)
        // a packet inside d1 is missing
        let (out, d) = run(k + d1.enumerated().filter { $0.offset != 1 }.map(\.element) + d2 + k2, gaps: [k.count + 1])
        #expect(out.map(\.key) == [true, true]) // d1 broken, d2 follows a broken one, k2 ok
        #expect(d.dropped == 2)
    }

    @Test func testStartsOnlyWithKeyFrame() {
        let (out, d) = run(packetiseH264([nal(1, 30)], ts: 0, seq0: 1) + packetiseH264([nal(5, 30)], ts: 3600, seq0: 2))
        #expect(out.count == 1); #expect(out[0].key); #expect(d.dropped == 1)
    }

    @Test func testHevcApAndFu() {
        // HEVC NAL header: type << 1, layer 0, tid 1
        func hnal(_ type: UInt8, _ n: Int) -> [UInt8] { [type << 1, 1] + [UInt8](repeating: 0xbb, count: n - 2) }
        let vps = hnal(32, 12), sps = hnal(33, 20), pps = hnal(34, 6), idr = hnal(19, 300)
        var ap: [UInt8] = [48 << 1, 1]
        for n in [vps, sps, pps] { ap += [UInt8(n.count >> 8), UInt8(n.count & 0xff)]; ap += n }
        var pkts = [rtp(ap, seq: 1, ts: 0)]
        let body = Array(idr.dropFirst(2))
        for (i, o) in stride(from: 0, to: body.count, by: 100).enumerated() {
            let s = o == 0, e = o + 100 >= body.count
            let flags: UInt8 = (s ? 0x80 : 0) | (e ? 0x40 : 0) | 19
            var fu: [UInt8] = [49 << 1, 1, flags]
            fu += body[o..<min(body.count, o + 100)]
            pkts.append(rtp(fu, seq: 2 + i, ts: 0, marker: e))
        }
        let (out, _) = run(pkts, codec: .hevc)
        #expect(out.count == 1)
        #expect(out[0].key)
        #expect(out[0].data == annexB([vps, sps, pps, idr]))
    }

    @Test func testReorderBufferRestoresOrderAndCountsLoss() {
        var got: [(UInt16, Bool)] = []
        let r = ReorderBuffer(window: 64, maxWaitMs: 30) { p, gap in got.append((p.seq, gap)) }
        func p(_ s: UInt16) -> RtpPacket { RtpPacket(marker: false, pt: 96, seq: s, ts: 0, payload: []) }
        r.push(p(10), now: 0); r.push(p(12), now: 1); r.push(p(11), now: 2)
        #expect(got.map(\.0) == [10, 11, 12]); #expect(r.reordered == 1)
        r.push(p(14), now: 3) // 13 missing
        #expect(got.count == 3)
        r.drain(now: 40)
        #expect(got.map(\.0) == [10, 11, 12, 14]); #expect(got.last!.1); #expect(r.lost == 1)
        r.push(p(13), now: 41)
        #expect(r.late == 1)
        r.push(p(14), now: 42)
        #expect(r.duplicates == 1)
    }

    @Test func testReorderAcrossSequenceWrap() {
        var got: [UInt16] = []
        let r = ReorderBuffer(window: 64, maxWaitMs: 30) { p, _ in got.append(p.seq) }
        for s: UInt16 in [65534, 0, 65535, 1] { r.push(RtpPacket(marker: false, pt: 96, seq: s, ts: 0, payload: []), now: 0) }
        #expect(got == [65534, 65535, 0, 1])
    }

    @Test func testSplitAnnexB() {
        #expect(splitAnnexB([0, 0, 0, 1, 0x67, 1, 2, 0, 0, 1, 0x68, 3, 0, 0, 0, 1, 0x65, 4]) == [[0x67, 1, 2], [0x68, 3], [0x65, 4]])
    }

    @Test func testUdpTooLossy() {
        var a = RtpReport(transport: "udp"), b = RtpReport(transport: "udp")
        b.packets = 97; b.lost = 3
        #expect(udpTooLossy(a, b))
        b.lost = 1
        #expect(!(udpTooLossy(a, b)))
        a.packets = 90
        #expect(!(udpTooLossy(a, b))) // too few packets to judge
    }
}
