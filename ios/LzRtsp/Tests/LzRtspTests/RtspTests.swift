import CryptoKit
import Foundation
import Testing
@testable import LzRtsp

func fixture(_ name: String) throws -> Data {
    let url = try #require(Bundle.module.url(forResource: name, withExtension: nil, subdirectory: "Fixtures"))
    return try Data(contentsOf: url)
}

@Suite struct RtspTests {
    /// RFC 2617 §3.5 example: response 6629fae49393a05397450978507c4ef1.
    @Test func testDigestRfc2617Example() {
        let ch = #"Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41""#
        let h = authorization(challenge: ch, credentials: Credentials(user: "Mufasa", pass: "Circle Of Life"), method: "GET",
                              uri: "/dir/index.html", nc: 1, cnonce: "0a4f113b")
        #expect(h.contains(#"response="6629fae49393a05397450978507c4ef1""#), Comment(rawValue: h))
        #expect(h.contains("qop=auth, nc=00000001, cnonce=\"0a4f113b\""))
        #expect(h.contains(#"opaque="5ccc069c403ebaf9f0171e9517f40e41""#))
    }

    @Test func testDigestWithoutQop() {
        // RFC 2069 form: response = MD5(HA1:nonce:HA2)
        let h = authorization(challenge: #"Digest realm="r", nonce="n""#, credentials: Credentials(user: "u", pass: "p"), method: "DESCRIBE", uri: "rtsp://h/s")
        let ha1 = md5("u:r:p"), ha2 = md5("DESCRIBE:rtsp://h/s")
        #expect(h.contains("response=\"\(md5("\(ha1):n:\(ha2)"))\""))
        #expect(!(h.contains("qop")))
    }

    @Test func testBasicAndChallengeChoice() {
        #expect(authorization(challenge: "Basic", credentials: Credentials(user: "Aladdin", pass: "open sesame"), method: "OPTIONS", uri: "x") == "Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==") // RFC 7617 §2
        #expect(pickChallenge(#"Basic realm="a", Digest realm="b", nonce="c""#) == #"Digest realm="b", nonce="c""#)
        #expect(pickChallenge(#"Digest realm="b", nonce="c", Basic realm="a""#) == #"Digest realm="b", nonce="c""#)
        #expect(pickChallenge(#"Basic realm="a""#) == "Basic")
        #expect(pickChallenge("Bearer x") == nil)
    }

    @Test func testSdpFromFixtures() throws {
        let h264 = try parseSdp(String(decoding: try fixture("h264.sdp"), as: UTF8.self), base: "rtsp://127.0.0.1:8554/h264")
        #expect(h264.codec == .h264); #expect(h264.pt == 96); #expect(h264.rate == 90000)
        #expect(h264.params.map { $0[0] & 0x1f } == [7, 8])
        #expect(h264.control == "rtsp://127.0.0.1:8554/h264/trackID=0")
        let hevc = try parseSdp(String(decoding: try fixture("hevc.sdp"), as: UTF8.self), base: "rtsp://127.0.0.1:8554/hevc")
        #expect(hevc.codec == .hevc)
        #expect(hevc.params.map { ($0[0] >> 1) & 0x3f } == [32, 33, 34])
    }

    @Test func testSdpRules() {
        let base = "rtsp://cam/s"
        let audioFirst = "v=0\r\na=control:rtsp://cam/s/\r\nm=audio 0 RTP/AVP 97\r\na=rtpmap:97 MPEG4-GENERIC/48000\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\na=control:track1\r\n"
        let t = try? parseSdp(audioFirst, base: base)
        #expect(t?.control == "rtsp://cam/s/track1")
        #expect(t?.session == "rtsp://cam/s/")
        #expect(throws: RtspError.self) { do { try parseSdp("m=video 0 RTP/AVP 96\na=rtpmap:96 H264/90000\na=fmtp:96 packetization-mode=2\n", base: base) } catch let e as RtspError { #expect(e.code == "rtsp.h264Interleaved"); throw e } }
        #expect(throws: RtspError.self) { do { try parseSdp("m=video 0 RTP/AVP 96\na=rtpmap:96 H265/90000\na=fmtp:96 sprop-max-don-diff=2\n", base: base) } catch let e as RtspError { #expect(e.code == "rtsp.hevcDonl"); throw e } }
        #expect(throws: RtspError.self) { do { try parseSdp("m=video 0 RTP/AVP 26\na=rtpmap:26 JPEG/90000\n", base: base) } catch let e as RtspError { #expect(e.code == "rtsp.noTrack"); throw e } }
    }

    @Test func testStreamParserSplitsResponsesAndFrames() throws {
        var responses: [RtspResponse] = [], frames: [(UInt8, [UInt8])] = []
        let p = RtspStreamParser(onResponse: { responses.append($0) }, onFrame: { frames.append(($0, $1)) })
        let text = Array("RTSP/1.0 200 OK\r\nCSeq: 2\r\nContent-Length: 4\r\nWWW-Authenticate: A\r\nWWW-Authenticate: B\r\n\r\nv=0\n".utf8)
        let stream = text + [0x24, 0, 0, 3, 9, 8, 7] + [0x24, 1, 0, 1, 5] + Array("RTSP/1.0 401 Unauthorized\r\nCSeq: 3\r\n\r\n".utf8)
        // byte by byte: every split point must work
        for b in stream { try p.push([b]) }
        #expect(responses.map(\.status) == [200, 401])
        #expect(responses[0].body == "v=0\n")
        #expect(responses[0].headers["www-authenticate"] == "A, B")
        #expect(frames.map(\.0) == [0, 1]); #expect(frames[0].1 == [9, 8, 7])
    }

    @Test func testSplitCredentials() {
        let r = splitCredentials("rtsp://us%40er:p%3Ass@10.0.0.5:554/stream1")
        #expect(r.url == "rtsp://10.0.0.5:554/stream1")
        #expect(r.credentials == Credentials(user: "us@er", pass: "p:ss"))
        #expect(splitCredentials("rtsp://cam/s").credentials == nil)
    }

    /// Recorded mediamtx sessions (scripts/ios-rtsp-fixtures.mjs) through parser and depacketizer:
    /// the same access units as server/rtp.mjs, byte for byte (SHA-256), in any chunking.
    @Test func testRecordedSessionsMatchJavaScript() throws {
        for name in ["h264", "hevc"] {
            let raw = [UInt8](try fixture("\(name).tcp"))
            let exp = try JSONSerialization.jsonObject(with: try fixture("\(name).expected.json")) as! [String: Any]
            let want = exp["accessUnits"] as! [[String: Any]]
            let codec = VideoCodec(rawValue: exp["codec"] as! String)!
            for chunk in [1, 7, 1400, raw.count] {
                var aus: [AccessUnit] = []
                let d = Depacketizer(codec: codec) { aus.append($0) }
                var statuses: [Int] = []
                let p = RtspStreamParser(onResponse: { statuses.append($0.status) }, onFrame: { ch, data in
                    if ch == 0, let pkt = RtpPacket(data), pkt.pt == UInt8(exp["pt"] as! Int) { d.push(pkt) }
                })
                var o = 0
                while o < raw.count { try p.push(raw[o..<min(raw.count, o + chunk)]); o += chunk }
                #expect(statuses == [200], Comment(rawValue: "\(name): PLAY response"))
                #expect(aus.count == want.count, Comment(rawValue: "\(name) chunk \(chunk)"))
                #expect(d.dropped == exp["dropped"] as? Int)
                for (a, w) in zip(aus, want) {
                    #expect(a.key == w["key"] as? Bool)
                    #expect(Int(a.ts) == w["ts"] as? Int)
                    #expect(a.data.count == w["size"] as? Int)
                    #expect(SHA256.hash(data: Data(a.data)).map { String(format: "%02x", $0) }.joined() == w["sha256"] as? String)
                }
            }
        }
    }
}
