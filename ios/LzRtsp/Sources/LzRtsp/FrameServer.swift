// Loopback WebSocket that speaks the LZ Scopes frame protocol (docs/frame-protocol.md) to the
// app's own WebView, so src/sources.ts and src/frameWorker.ts take RTSP-direct streams exactly
// like bridge streams. Listens on 127.0.0.1 only, on a random port, and only for requests
// carrying a random token of this app run. The handshake is RFC 6455 §4.2 (done here because
// Network.framework's WebSocket server does not expose the request path).
//
//   ws://127.0.0.1:<port>/rtsp?token=…&url=rtsp://host/path&transport=tcp|udp&width=960&wc=h264,hevc
//
// Default route ("webcodecs"): the access units go compressed (LZHK/LZHD, Annex B) and the
// WebView decodes them with WebCodecs – the least data across the process boundary and no
// extra copy. When the WebView cannot decode the codec (`wc` does not list it, or 10 bit),
// VideoToolbox decodes here and R′G′B′A frames (LZV1) are sent at the analysis width.

import CryptoKit
import Foundation
import Network

public final class FrameServer {
    public let token = randomHex(16)
    public private(set) var port: UInt16 = 0
    /// Keychain lookup for an RTSP URL without credentials (host + port)
    public var credentials: (String) -> Credentials? = { _ in nil }
    /// one line per session event for the console (`[lzs-ios] …`)
    public var log: (String) -> Void = { print($0) }
    private let queue = DispatchQueue(label: "lzs.frameserver")
    private var listener: NWListener?
    private var sessions: [ObjectIdentifier: WsConnection] = [:]

    public init() {}

    /// Start once; returns the port.
    public func start(_ done: @escaping (Result<UInt16, Error>) -> Void) {
        queue.async {
            if self.port != 0 { done(.success(self.port)); return }
            do {
                let params = NWParameters.tcp
                params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
                params.allowLocalEndpointReuse = true
                let l = try NWListener(using: params)
                var reported = false
                l.newConnectionHandler = { [weak self] c in self?.accept(c) }
                l.stateUpdateHandler = { [weak self] state in
                    guard let self, !reported else { return }
                    switch state {
                    case .ready:
                        reported = true
                        self.port = l.port?.rawValue ?? 0
                        done(.success(self.port))
                    case .failed(let e):
                        reported = true
                        done(.failure(e))
                    default: break
                    }
                }
                self.listener = l
                l.start(queue: self.queue)
            } catch { done(.failure(error)) }
        }
    }

    private func accept(_ c: NWConnection) {
        let ws = WsConnection(conn: c, queue: queue, server: self)
        sessions[ObjectIdentifier(ws)] = ws
        ws.onClose = { [weak self, weak ws] in if let ws { self?.sessions.removeValue(forKey: ObjectIdentifier(ws)) } }
        ws.start()
    }

    /// Sessions currently open (Settings and console).
    public var openCount: Int { queue.sync { sessions.count } }
}

/// One WebSocket connection = one RTSP session.
final class WsConnection {
    let conn: NWConnection
    let queue: DispatchQueue
    unowned let server: FrameServer
    var onClose: (() -> Void)?
    private var inbox: [UInt8] = []
    private var upgraded = false
    private var closed = false
    private var stream: DirectStream?

    init(conn: NWConnection, queue: DispatchQueue, server: FrameServer) {
        self.conn = conn; self.queue = queue; self.server = server
    }

    func start() {
        conn.stateUpdateHandler = { [weak self] s in
            switch s {
            case .failed, .cancelled: self?.close()
            default: break
            }
        }
        conn.start(queue: queue)
        read()
    }

    private func read() {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, complete, error in
            guard let self, !self.closed else { return }
            if let data { self.inbox += data }
            if !self.upgraded { self.handshake() } else { self.frames() }
            if complete || error != nil { self.close(); return }
            if !self.closed { self.read() }
        }
    }

    // MARK: handshake (RFC 6455 §4.2.1/4.2.2)

    private func handshake() {
        guard let end = inbox.firstRange(of: [13, 10, 13, 10]) else {
            if inbox.count > 16384 { close() }
            return
        }
        let head = String(decoding: inbox[..<end.lowerBound], as: UTF8.self).components(separatedBy: "\r\n")
        inbox.removeFirst(end.upperBound)
        var headers: [String: String] = [:]
        for l in head.dropFirst() {
            guard let i = l.firstIndex(of: ":") else { continue }
            headers[l[..<i].trimmingCharacters(in: .whitespaces).lowercased()] = l[l.index(after: i)...].trimmingCharacters(in: .whitespaces)
        }
        let parts = (head.first ?? "").split(separator: " ")
        guard parts.count >= 2, parts[0] == "GET", let key = headers["sec-websocket-key"],
              headers["upgrade"]?.lowercased() == "websocket",
              let comps = URLComponents(string: "http://127.0.0.1" + parts[1]),
              comps.path == "/rtsp",
              let q = comps.queryItems.map({ Dictionary($0.map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a }) }),
              q["token"] == server.token else {
            conn.send(content: Data("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8), completion: .contentProcessed { [weak self] _ in self?.close() })
            return
        }
        let accept = Data(Insecure.SHA1.hash(data: Data((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").utf8))).base64EncodedString()
        conn.send(content: Data("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: \(accept)\r\n\r\n".utf8),
                  completion: .contentProcessed { _ in })
        upgraded = true
        let opts = DirectStream.Options(
            url: q["url"] ?? "",
            transport: RtpTransport(rawValue: q["transport"] ?? "tcp") ?? .tcp,
            width: Int(q["width"] ?? "0") ?? 0,
            webCodecs: Set((q["wc"] ?? "").split(separator: ",").compactMap { VideoCodec(rawValue: String($0)) }))
        stream = DirectStream(options: opts, queue: queue, credentials: server.credentials, log: server.log, out: self)
        stream?.start()
        frames()
    }

    // MARK: frames

    /// Client frames: only close and ping matter (RFC 6455 §5.5).
    private func frames() {
        while inbox.count >= 2 {
            let op = inbox[0] & 0x0f, masked = inbox[1] & 0x80 != 0
            var len = Int(inbox[1] & 0x7f), off = 2
            if len == 126 { guard inbox.count >= 4 else { return }; len = Int(inbox[2]) << 8 | Int(inbox[3]); off = 4 }
            else if len == 127 {
                guard inbox.count >= 10 else { return }
                len = (2..<10).reduce(0) { $0 << 8 | Int(inbox[$1]) }; off = 10
            }
            let total = off + (masked ? 4 : 0) + len
            guard inbox.count >= total else { return }
            var payload = Array(inbox[(off + (masked ? 4 : 0))..<total])
            if masked { let m = Array(inbox[off..<(off + 4)]); for i in payload.indices { payload[i] ^= m[i & 3] } }
            inbox.removeFirst(total)
            if op == 8 { close(); return }
            if op == 9 { send(opcode: 10, payload) }
        }
    }

    /// Bytes handed to the network that are not sent yet (back-pressure for video).
    private(set) var unsent = 0

    func send(opcode: UInt8, _ payload: [UInt8], done: (() -> Void)? = nil) {
        guard !closed else { return }
        var head: [UInt8] = [0x80 | opcode]
        let n = payload.count
        if n < 126 { head.append(UInt8(n)) }
        else if n < 65536 { head += [126, UInt8(n >> 8), UInt8(n & 0xff)] }
        else { head.append(127); for s in stride(from: 56, through: 0, by: -8) { head.append(UInt8((n >> s) & 0xff)) } }
        unsent += n
        var data = Data(capacity: head.count + n)
        data.append(contentsOf: head); data.append(contentsOf: payload)
        conn.send(content: data, completion: .contentProcessed { [weak self] _ in self?.unsent -= n; done?() })
    }

    func sendText(_ obj: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: obj) else { return }
        send(opcode: 1, [UInt8](d))
    }

    func close() {
        guard !closed else { return }
        closed = true
        stream?.stop(); stream = nil
        conn.send(content: Data([0x88, 0]), completion: .contentProcessed { [conn] _ in conn.cancel() })
        onClose?(); onClose = nil
    }
}

/// RTSP session → frame protocol messages.
final class DirectStream {
    struct Options {
        var url: String
        var transport: RtpTransport
        var width: Int
        var webCodecs: Set<VideoCodec>
    }

    private let opts: Options
    private let queue: DispatchQueue
    private let credentials: (String) -> Credentials?
    private let log: (String) -> Void
    private weak var out: WsConnection?
    private var client: RtspClient?
    private var params: [[UInt8]] = []
    private var format: StreamFormat?
    private var decoder: NativeDecoder?
    private var native = false
    private var frameNo: UInt32 = 0
    private var dropped = 0
    private var waitKey = true
    private var statsTimer: DispatchSourceTimer?
    private var lastReport: RtpReport?
    private var switched: [String: Any]?
    private var stopped = false
    private var decodeErrors = 0

    init(options: Options, queue: DispatchQueue, credentials: @escaping (String) -> Credentials?, log: @escaping (String) -> Void, out: WsConnection) {
        opts = options; self.queue = queue; self.credentials = credentials; self.log = log; self.out = out
    }

    func start() { open(opts.transport) }

    private func open(_ transport: RtpTransport) {
        let c: RtspClient
        do {
            c = try RtspClient(url: opts.url, credentials: credentials(opts.url), transport: transport, queue: queue)
        } catch let e as RtspError { fail(e); return } catch { return }
        client = c
        c.onAccessUnit = { [weak self, weak c] au, ms in
            guard let self, let c, self.client === c else { return }
            self.accessUnit(au, ms: ms)
        }
        c.onEnd = { [weak self, weak c] e in
            guard let self, let c, self.client === c, !self.stopped else { return }
            if let e { self.fail(e) } else { self.end() }
        }
        c.start { [weak self, weak c] r in
            guard let self, let c, self.client === c, !self.stopped else { return }
            switch r {
            case .success(let info):
                if self.params.isEmpty { self.params = info.params }
                self.log("[lzs-ios] rtsp-direct: \(info.codec.rawValue) over \(info.transport.rawValue), \(info.params.count) parameter sets in the SDP")
                self.startStats()
            case .failure(let e): self.fail(e)
            }
        }
    }

    private func accessUnit(_ au: AccessUnit, ms: Double) {
        guard let out else { return }
        let codec = client?.info?.codec ?? .h264
        // in-band parameter sets win over those from the SDP (cameras change them on mode switches)
        let inband = au.nals.filter { !$0.isEmpty && codec.isParameterSet(codec.nalType($0[0])) }
        if StreamFormat.order(codec, inband).count > 0 { params = inband }
        if format == nil {
            guard au.key, let f = StreamFormat(codec: codec, params: params) else { return }
            format = f
            native = !opts.webCodecs.contains(codec) || f.highBitDepth
            if native {
                do { decoder = try NativeDecoder(format: f, targetWidth: opts.width) } catch let e as RtspError { fail(e); return } catch { return }
            }
            sendInfo(f)
        }
        guard let f = format else { return }
        if out.unsent > 6 * 1024 * 1024 || (native && out.unsent > 0 && out.unsent > (decoder?.width ?? 0) * (decoder?.height ?? 0) * 8) {
            // the WebView does not keep up: drop, and on the compressed path up to the next key frame
            dropped += 1; waitKey = true
            return
        }
        if native {
            if waitKey && !au.key { dropped += 1; return }
            waitKey = false
            frameNo &+= 1
            do {
                guard var px = try decoder?.decode(nals: au.nals, headerBytes: 16) else { return }
                header(&px, magic: "LZV1", n: 0, value: ms / 1000)
                out.send(opcode: 2, px)
            } catch let e as RtspError {
                decodeErrors += 1; waitKey = true
                if decodeErrors == 1 || decodeErrors % 50 == 0 { out.sendText(["type": "stats", "message": e.message, "code": e.code, "params": e.params]) }
            } catch {}
            return
        }
        if waitKey && !au.key { dropped += 1; return }
        waitKey = false
        var data: [UInt8] = []
        if au.key {
            // LZHK: parameter sets in front of every key frame, as the bridge sends it
            let have = Set(au.nals.compactMap { $0.first.map { f.codec.nalType($0) } })
            for p in StreamFormat.order(f.codec, params) where !have.contains(f.codec.nalType(p[0])) { data += startCode; data += p }
        }
        data += au.data
        var frame = [UInt8](repeating: 0, count: 16)
        header(&frame, magic: au.key ? "LZHK" : "LZHD", n: frameNo, value: Date().timeIntervalSince1970 * 1000)
        frameNo &+= 1
        frame += data
        out.send(opcode: 2, frame)
    }

    /// 16-byte frame header: magic, uint32 LE, float64 LE (docs/frame-protocol.md).
    private func header(_ b: inout [UInt8], magic: String, n: UInt32, value: Double) {
        for (i, c) in magic.utf8.enumerated() { b[i] = c }
        withUnsafeBytes(of: n.littleEndian) { for i in 0..<4 { b[4 + i] = $0[i] } }
        withUnsafeBytes(of: value.bitPattern.littleEndian) { for i in 0..<8 { b[8 + i] = $0[i] } }
    }

    private func sendInfo(_ f: StreamFormat) {
        let w = native ? decoder!.width : f.width, h = native ? decoder!.height : f.height
        var info: [String: Any] = [
            "type": "info", "proto": 2, "width": w, "height": h, "depth": 8, "fps": 0,
            "sourceWidth": f.width, "sourceHeight": f.height,
            "codec": "\(f.codec == .h264 ? "H.264" : "HEVC") · \(native ? "VideoToolbox" : "WebCodecs")",
            "transfer": f.transfer, "primaries": f.primaries, "matrix": f.matrix, "range": f.range,
            "decodeMatrix": f.decodeMatrix, "direct": native ? "videotoolbox" : "webcodecs",
        ]
        if !native { info["transport"] = f.codec.rawValue }
        out?.sendText(info)
        if !native { out?.sendText(["type": "video", "codec": f.codecString, "format": "annexb"]) }
        log("[lzs-ios] rtsp-direct: live \(f.width)x\(f.height) \(f.codecString) → \(native ? "VideoToolbox \(w)x\(h)" : "WebCodecs") matrix=\(f.matrix) transfer=\(f.transfer) range=\(f.range)")
    }

    private func startStats() {
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + 1, repeating: 1)
        var tick = 0
        t.setEventHandler { [weak self] in
            guard let self, let c = self.client else { return }
            let r = c.report()
            var rtp = r.json
            rtp["switched"] = self.switched ?? NSNull()
            self.out?.sendText(["type": "stats", "dropped": self.dropped, "rtp": rtp])
            tick += 1
            // over UDP, too much loss: same session over TCP (as the bridge's OwnRtp)
            if tick % 3 == 0 {
                if c.transport == .udp, let prev = self.lastReport, udpTooLossy(prev, r) { self.toTcp(prev, r) }
                self.lastReport = r
            }
        }
        t.resume()
        statsTimer?.cancel()
        statsTimer = t
    }

    private func toTcp(_ a: RtpReport, _ b: RtpReport) {
        let lost = b.lost - a.lost, got = b.packets - a.packets
        let pct = Int((100 * Double(lost) / Double(max(1, lost + got))).rounded())
        switched = ["message": "UDP lost \(pct) % of the packets → TCP", "code": "rtp.udpLoss", "params": ["pct": pct]]
        log("[lzs-ios] rtsp-direct: UDP lost \(pct) % → TCP")
        client?.stop()
        client = nil
        lastReport = nil
        waitKey = true
        open(.tcp)
    }

    private func fail(_ e: RtspError) {
        log("[lzs-ios] rtsp-direct: error \(e.code) \(e.message)")
        out?.sendText(["type": "error", "message": e.message, "code": e.code, "params": e.params])
        stop()
        out?.close()
    }

    private func end() {
        log("[lzs-ios] rtsp-direct: ended")
        out?.sendText(["type": "end", "message": "RTSP: the camera ended the stream", "code": "ios.rtspEnded"])
        stop()
        out?.close()
    }

    func stop() {
        guard !stopped else { return }
        stopped = true
        statsTimer?.cancel(); statsTimer = nil
        client?.stop(); client = nil
        decoder = nil
    }
}
