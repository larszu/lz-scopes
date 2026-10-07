import Foundation
import Testing
@testable import LzRtsp

// End to end against a local mediamtx (scripts/ios-rtsp-testserver.mjs): RTSP session, frame
// server and the frame protocol as the WebView sees it. Runs only when LZS_RTSP_TEST_PORT is set
// (the iOS workflow starts the server; locally: node scripts/ios-rtsp-testserver.mjs 8554 &).

let livePort = ProcessInfo.processInfo.environment["LZS_RTSP_TEST_PORT"]

/// What a frame-protocol client got in the first seconds.
struct Received {
    var texts: [[String: Any]] = []
    var binaries: [Data] = []
    var closed = false
    func first(_ type: String) -> [String: Any]? { texts.first { $0["type"] as? String == type } }
}

func receive(_ server: FrameServer, path: String, query: [String: String], until: (Received) -> Bool, seconds: Double = 12) async throws -> Received {
    var c = URLComponents(string: "ws://127.0.0.1:\(server.port)\(path)")!
    c.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
    let task = URLSession.shared.webSocketTask(with: c.url!)
    task.resume()
    var got = Received()
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline && !until(got) {
        do {
            let msg = try await task.receive()
            switch msg {
            case .string(let s): got.texts.append((try? JSONSerialization.jsonObject(with: Data(s.utf8))) as? [String: Any] ?? [:])
            case .data(let d): got.binaries.append(d)
            @unknown default: break
            }
        } catch { got.closed = true; break }
    }
    task.cancel(with: .goingAway, reason: nil)
    return got
}

func startedServer(credentials: Credentials? = nil) async throws -> FrameServer {
    let s = FrameServer()
    s.credentials = { _ in credentials }
    s.log = { _ in }
    _ = try await withCheckedThrowingContinuation { (k: CheckedContinuation<UInt16, Error>) in s.start { k.resume(with: $0) } }
    return s
}

@Suite(.enabled(if: livePort != nil, "LZS_RTSP_TEST_PORT not set"), .serialized)
struct LiveTests {
    let base = "rtsp://127.0.0.1:\(livePort ?? "8554")"

    @Test func h264OverTcpGoesCompressedToWebCodecs() async throws {
        let s = try await startedServer()
        let r = try await receive(s, path: "/rtsp", query: ["token": s.token, "url": "\(base)/h264", "transport": "tcp", "wc": "h264,hevc"]) { $0.binaries.count >= 30 }
        let info = try #require(r.first("info"))
        #expect(info["transport"] as? String == "h264")
        #expect(info["sourceWidth"] as? Int == 1280); #expect(info["sourceHeight"] as? Int == 720)
        #expect(info["matrix"] as? String == "bt709"); #expect(info["range"] as? String == "tv")
        let video = try #require(r.first("video"))
        #expect((video["codec"] as? String)?.hasPrefix("avc1.") == true)
        let first = try #require(r.binaries.first)
        #expect(String(decoding: first.prefix(4), as: UTF8.self) == "LZHK")
        // SPS in front of the key frame (Annex B after the 16-byte header)
        #expect(Array(first[16..<20]) == [0, 0, 0, 1]); #expect(first[20] & 0x1f == 7)
        #expect(r.binaries.count >= 30)
    }

    @Test func hevcWithoutWebCodecsIsDecodedByVideoToolbox() async throws {
        let s = try await startedServer()
        let r = try await receive(s, path: "/rtsp", query: ["token": s.token, "url": "\(base)/hevc", "transport": "tcp", "width": "640", "wc": ""]) { $0.binaries.count >= 5 }
        let info = try #require(r.first("info"))
        #expect(info["transport"] == nil)
        #expect(info["width"] as? Int == 640); #expect(info["height"] as? Int == 360)
        #expect(info["direct"] as? String == "videotoolbox")
        let px = [UInt8](try #require(r.binaries.last))
        #expect(String(decoding: px.prefix(4), as: UTF8.self) == "LZV1")
        let want: Int = 16 + 640 * 360 * 4
        #expect(px.count == want)
        let x = Int((240.0 + 205.7 / 2) / 1920 * 640)
        let o: Int = 16 + (120 * 640 + x) * 4
        let value = Double(px[o])
        #expect(abs(value - 191) <= 4)
    }

    @Test func udpTransport() async throws {
        let s = try await startedServer()
        let r = try await receive(s, path: "/rtsp", query: ["token": s.token, "url": "\(base)/h264", "transport": "udp", "wc": "h264"]) { r in
            r.binaries.count >= 30 && r.texts.contains { $0["type"] as? String == "stats" }
        }
        #expect(r.binaries.count >= 30)
        let stats = try #require(r.first("stats"))
        #expect((stats["rtp"] as? [String: Any])?["transport"] as? String == "udp")
    }

    @Test func digestCredentialsFromTheStore() async throws {
        let ok = try await startedServer(credentials: Credentials(user: "lzs", pass: "scopes"))
        let r = try await receive(ok, path: "/rtsp", query: ["token": ok.token, "url": "\(base)/auth", "wc": "h264"]) { $0.binaries.count >= 3 }
        #expect(r.first("info") != nil)

        let bad = try await startedServer(credentials: Credentials(user: "lzs", pass: "wrong"))
        let e = try await receive(bad, path: "/rtsp", query: ["token": bad.token, "url": "\(base)/auth", "wc": "h264"]) { $0.first("error") != nil }
        #expect(e.first("error")?["code"] as? String == "rtsp.unauthorized")
    }

    @Test func refusesWithoutToken() async throws {
        let s = try await startedServer()
        let r = try await receive(s, path: "/rtsp", query: ["token": "nope", "url": "\(base)/h264"], until: { $0.closed }, seconds: 4)
        #expect(r.closed); #expect(r.texts.isEmpty)
    }

    @Test func unreachableCameraReportsAnError() async throws {
        let s = try await startedServer()
        // five attempts 2 s apart before giving up
        let r = try await receive(s, path: "/rtsp", query: ["token": s.token, "url": "rtsp://127.0.0.1:9/none"], until: { $0.first("error") != nil }, seconds: 40)
        #expect(r.texts.filter { $0["code"] as? String == "ios.rtspRetry" }.count == 5)
        let code = r.first("error")?["code"] as? String
        #expect(code == "rtsp.connectFailed" || code == "rtsp.timeout")
    }
}
