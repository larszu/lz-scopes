import Foundation
import Testing
@testable import LzRtsp

/// Access units of a recorded session (scripts/ios-rtsp-fixtures.mjs: smptehdbars 640×360, BT.709, narrow range).
func recordedAccessUnits(_ name: String) throws -> (Track, [AccessUnit]) {
    let track = try parseSdp(String(decoding: try fixture("\(name).sdp"), as: UTF8.self), base: "rtsp://127.0.0.1/\(name)")
    var aus: [AccessUnit] = []
    let d = Depacketizer(codec: track.codec) { aus.append($0) }
    let p = RtspStreamParser(onResponse: { _ in }, onFrame: { ch, data in if ch == 0, let pkt = RtpPacket(data) { d.push(pkt) } })
    try p.push([UInt8](try fixture("\(name).tcp")))
    return (track, aus)
}

@Suite struct DecodeTests {
    @Test func testFormatFromParameterSets() throws {
        let (h264, _) = try recordedAccessUnits("h264")
        let f = try #require(StreamFormat(codec: .h264, params: h264.params))
        #expect(f.width == 640); #expect(f.height == 360)
        let sps = h264.params[0]
        #expect(f.codecString == String(format: "avc1.%02x%02x%02x", sps[1], sps[2], sps[3]))
        #expect(f.matrix == "bt709"); #expect(f.primaries == "bt709"); #expect(f.transfer == "bt709")
        #expect(f.decodeMatrix == "bt709")
        #expect(!(f.highBitDepth))

        let (hevc, _) = try recordedAccessUnits("hevc")
        let g = try #require(StreamFormat(codec: .hevc, params: hevc.params))
        #expect(g.width == 640); #expect(g.height == 360)
        // Main profile (1), compatibility flags 1 and 2 → reversed 0x6, Main tier
        #expect(g.codecString.hasPrefix("hvc1.1.6.L"), Comment(rawValue: g.codecString))
        #expect(g.matrix == "bt709")
    }

    @Test func testHevcCodecStringAnnexE() {
        // SPS of a Main 10, Main tier, level 5.1 stream: NAL header 42 01, then 01 (vps id 0, 0 sub layers, nesting 1),
        // 02 (profile 2), compat 20 00 00 00 (flag 2), constraints 90 00 00 00 00 00, level 153
        let sps: [UInt8] = [0x42, 0x01, 0x01, 0x02, 0x20, 0x00, 0x00, 0x00, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 153, 0xa0]
        #expect(StreamFormat.hevcString(sps) == "hvc1.2.4.L153.90")
        #expect(StreamFormat.hevcProfile(sps) == 2)
        // emulation prevention inside the constraint bytes is removed first
        #expect(StreamFormat.unescape([0, 0, 3, 0, 0, 0, 3, 1]) == [0, 0, 0, 0, 0, 1])
    }

    /// VideoToolbox decodes the recorded stream; the 75 % white bar of RP 219 bars comes out as
    /// R′G′B′ 0.75 (191) with the BT.709 narrow-range conversion of src/yuv.ts.
    @Test func testVideoToolboxDecodesRecordedStreams() throws {
        for name in ["h264", "hevc"] {
            let (track, aus) = try recordedAccessUnits(name)
            let f = try #require(StreamFormat(codec: track.codec, params: track.params))
            let dec = try NativeDecoder(format: f, targetWidth: 320)
            #expect(dec.width == 320); #expect(dec.height == 180)
            var frames = 0
            var last: [UInt8]?
            for au in aus {
                if let px = try dec.decode(nals: au.nals, headerBytes: 16) { frames += 1; last = px }
            }
            #expect(frames > aus.count - 3, Comment(rawValue: name))
            let px = try #require(last)
            #expect(px.count == 16 + 320 * 180 * 4)
            // smptehdbars: 1/8 of the width 40 % grey, then the 75 % white bar; sample its middle at mid height
            let x = Int((240.0 + 205.7 / 2) / 1920 * 320), y = 60
            let o = 16 + (y * 320 + x) * 4
            for c in 0..<3 { #expect(abs((Double(px[o + c])) - (191)) <= 4, Comment(rawValue: "\(name) channel \(c)")) }
            // 40 % grey on the left edge
            let g = 16 + (y * 320 + 10) * 4
            #expect(abs((Double(px[g])) - (102)) <= 4, Comment(rawValue: name))
        }
    }
}
