// One RTSP session (RFC 2326), Swift port of RtspClient in server/rtsp.mjs: OPTIONS → DESCRIBE
// (SDP) → SETUP of the first H.264/HEVC track over TCP (interleaved) or UDP → PLAY, keep-alive
// with GET_PARAMETER or OPTIONS, TEARDOWN on stop. TCP through Network.framework, UDP through
// BSD sockets (IPv4) because the port pair must be even/odd (RFC 3550 §11) and the receive
// buffer large (key-frame bursts). Everything runs on one serial queue.

import Darwin
import Foundation
import Network

public enum RtpTransport: String { case tcp, udp }

public struct SessionInfo {
    public var codec: VideoCodec
    public var params: [[UInt8]]
    public var transport: RtpTransport
}

public final class RtspClient {
    public let url: String
    public let transport: RtpTransport
    public let queue: DispatchQueue
    /// complete access unit; `ms` since the first one (RTP clock)
    public var onAccessUnit: ((AccessUnit, Double) -> Void)?
    /// session ended (nil = server closed it) – called once
    public var onEnd: ((RtspError?) -> Void)?

    private let credentials: Credentials?
    private let host: String
    private let port: UInt16
    private let timeout: Double
    private let reorderMs: Double
    private var conn: NWConnection?
    private var parser: RtspStreamParser!
    private var cseq = 0
    private var session: String?
    private var challenge: String?
    private var nc = 0
    private var pending: ((RtspResponse) -> Void)?
    private var pendingTimer: DispatchWorkItem?
    private var timers: [DispatchSourceTimer] = []
    private var udp: (rtp: Int32, rtcp: Int32, port: UInt16)?
    private var udpSources: [DispatchSourceRead] = []
    private var depack: Depacketizer?
    private var reorder: ReorderBuffer?
    private var pt: UInt8 = 96
    private var closed = false
    private var packets = 0, bytes = 0, udpBuffer = 0
    public private(set) var info: SessionInfo?

    public init(url: String, credentials: Credentials?, transport: RtpTransport = .tcp, timeout: Double = 8,
                reorderMs: Double = 30, queue: DispatchQueue = DispatchQueue(label: "lzs.rtsp")) throws {
        let split = splitCredentials(url)
        guard let u = URLComponents(string: split.url), u.scheme?.lowercased() == "rtsp", let h = u.host, !h.isEmpty else {
            throw RtspError("rtp.ownRtspOnly", "Own RTP reception only for rtsp:// (rtsps through ffmpeg)")
        }
        self.url = split.url
        self.credentials = split.credentials ?? credentials
        self.host = h
        self.port = UInt16(u.port ?? 554)
        self.transport = transport
        self.timeout = timeout
        self.reorderMs = reorderMs
        self.queue = queue
    }

    // MARK: start

    public func start(_ done: @escaping (Result<SessionInfo, RtspError>) -> Void) {
        queue.async { self.connect(done) }
    }

    private func connect(_ done: @escaping (Result<SessionInfo, RtspError>) -> Void) {
        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        tcp.connectionTimeout = Int(timeout.rounded(.up))
        let c = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: port)!, using: NWParameters(tls: nil, tcp: tcp))
        conn = c
        parser = RtspStreamParser(
            onResponse: { [weak self] r in self?.answer(r) },
            onFrame: { [weak self] ch, data in if ch == 0 { self?.onRtp(data) } })
        var started = false
        let timer = DispatchWorkItem { [weak self] in
            guard !started else { return }
            started = true
            self?.shutdown()
            done(.failure(RtspError("rtsp.timeout", "RTSP: connection timed out")))
        }
        queue.asyncAfter(deadline: .now() + timeout, execute: timer)
        c.stateUpdateHandler = { [weak self] state in
            guard let self else { return }
            switch state {
            case .ready:
                guard !started else { return }
                started = true; timer.cancel()
                self.receive()
                self.handshake(done)
            case .failed(let e), .waiting(let e):
                if !started {
                    started = true; timer.cancel(); self.shutdown()
                    done(.failure(RtspError("rtsp.connectFailed", "RTSP: connection failed (\(e.localizedDescription))", ["reason": e.localizedDescription])))
                } else if case .failed = state { self.fail(RtspError("rtsp.connectionLost", "RTSP: connection lost")) }
            case .cancelled:
                if started { self.end(nil) }
            default: break
            }
        }
        c.start(queue: queue)
    }

    private func receive() {
        conn?.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { [weak self] data, _, complete, error in
            guard let self, !self.closed else { return }
            if let data, !data.isEmpty {
                do { try self.parser.push(data) } catch let e as RtspError { self.fail(e); return } catch {}
            }
            if complete || error != nil { self.end(nil); return }
            self.receive()
        }
    }

    private func handshake(_ done: @escaping (Result<SessionInfo, RtspError>) -> Void) {
        let fail: (RtspError) -> Void = { [weak self] e in self?.shutdown(); done(.failure(e)) }
        request("OPTIONS", url) { r in
            guard case .success(let opts) = r else { if case .failure(let e) = r { fail(e) }; return }
            let methods = (opts.headers["public"] ?? "").uppercased()
            self.request("DESCRIBE", self.url, ["Accept": "application/sdp"]) { r in
                guard case .success(let desc) = r else { if case .failure(let e) = r { fail(e) }; return }
                var base = desc.headers["content-base"] ?? desc.headers["content-location"] ?? self.url
                if base.hasSuffix("/") { base.removeLast() }
                let track: Track
                do { track = try parseSdp(desc.body, base: base) } catch let e as RtspError { fail(e); return } catch { return }
                var transportHeader = "RTP/AVP/TCP;unicast;interleaved=0-1"
                if self.transport == .udp {
                    guard let pair = Self.udpPair() else { fail(RtspError("rtsp.noPorts", "No free UDP ports")); return }
                    self.udp = pair
                    transportHeader = "RTP/AVP;unicast;client_port=\(pair.port)-\(pair.port + 1)"
                }
                self.request("SETUP", track.control, ["Transport": transportHeader]) { r in
                    guard case .success(let setup) = r else { if case .failure(let e) = r { fail(e) }; return }
                    let sess = setup.headers["session"] ?? ""
                    self.session = sess.split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces) }
                    let keepSeconds = Self.number(after: "timeout=", in: sess) ?? 60
                    self.setupReception(track, serverTransport: setup.headers["transport"] ?? "")
                    self.request("PLAY", track.session, ["Range": "npt=0.000-"]) { r in
                        guard case .success = r else { if case .failure(let e) = r { fail(e) }; return }
                        let keep = methods.contains("GET_PARAMETER") ? "GET_PARAMETER" : "OPTIONS"
                        self.every(max(5, Double(keepSeconds) / 2)) { [weak self] in
                            guard let self, self.pending == nil else { return }
                            self.request(keep, self.url) { _ in }
                        }
                        let info = SessionInfo(codec: track.codec, params: track.params, transport: self.transport)
                        self.info = info
                        done(.success(info))
                    }
                }
            }
        }
    }

    private func setupReception(_ track: Track, serverTransport: String) {
        let clock = RtpClock(rate: track.rate)
        let d = Depacketizer(codec: track.codec) { [weak self] au in self?.onAccessUnit?(au, clock.ms(au.ts)) }
        depack = d
        reorder = ReorderBuffer(window: udp != nil ? 64 : 0, maxWaitMs: reorderMs) { pkt, gap in d.push(pkt, gap: gap) }
        pt = track.pt
        guard let udp else { return }
        for fd in [udp.rtp, udp.rtcp] {
            let src = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
            let isRtp = fd == udp.rtp
            src.setEventHandler { [weak self] in self?.readUdp(fd, rtp: isRtp) }
            src.setCancelHandler { close(fd) }
            src.resume()
            udpSources.append(src)
        }
        // empty RTCP receiver report (RFC 3550 §6.4.2, RC = 0) as a sign of life through NAT
        if let serverRtcp = Self.number(after: "server_port=", in: serverTransport, second: true), let addr = Self.ipv4(host) {
            var rr: [UInt8] = [0x80, 201, 0, 1]
            rr += (0..<4).map { _ in UInt8.random(in: 0...255) }
            every(5) { [weak self] in
                guard let self, let u = self.udp else { return }
                var a = addr
                a.sin_port = UInt16(serverRtcp).bigEndian
                _ = withUnsafePointer(to: &a) { p in
                    p.withMemoryRebound(to: sockaddr.self, capacity: 1) { sendto(u.rtcp, rr, rr.count, 0, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
                }
            }
        }
        // missing packets are given up after reorderMs even if nothing else arrives
        every(max(0.005, reorderMs / 2000)) { [weak self] in self?.reorder?.drain() }
    }

    private func readUdp(_ fd: Int32, rtp: Bool) {
        var buf = [UInt8](repeating: 0, count: 65536)
        while true {
            let n = recv(fd, &buf, buf.count, MSG_DONTWAIT)
            if n <= 0 { return }
            if rtp { onRtp(Array(buf[0..<n])) }
        }
    }

    private func onRtp(_ b: [UInt8]) {
        guard let pkt = RtpPacket(b), pkt.pt == pt else { return }
        packets += 1; bytes += b.count
        reorder?.push(pkt)
    }

    // MARK: requests

    private func request(_ method: String, _ uri: String, _ headers: [String: String] = [:], _ done: @escaping (Result<RtspResponse, RtspError>) -> Void) {
        let send: (String?) -> Void = { [weak self] auth in self?.send(method, uri, headers, auth, done) }
        if let ch = challenge, let c = credentials {
            nc += 1
            send(authorization(challenge: ch, credentials: c, method: method, uri: uri, nc: nc))
        } else { send(nil) }
    }

    private func send(_ method: String, _ uri: String, _ headers: [String: String], _ auth: String?, _ done: @escaping (Result<RtspResponse, RtspError>) -> Void) {
        guard let conn, !closed else { return }
        cseq += 1
        var h: [(String, String)] = [("CSeq", String(cseq)), ("User-Agent", "lz-scopes-ios")]
        h += headers.sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
        if let s = session { h.append(("Session", s)) }
        if let a = auth { h.append(("Authorization", a)) }
        let text = "\(method) \(uri) RTSP/1.0\r\n" + h.map { "\($0.0): \($0.1)\r\n" }.joined() + "\r\n"
        let timer = DispatchWorkItem { [weak self] in
            self?.pending = nil
            done(.failure(RtspError("rtsp.noAnswer", "RTSP \(method): no answer", ["method": method])))
        }
        pendingTimer?.cancel()
        pendingTimer = timer
        queue.asyncAfter(deadline: .now() + timeout, execute: timer)
        pending = { [weak self] res in
            guard let self else { return }
            timer.cancel(); self.pending = nil
            if res.status == 401, let c = self.credentials, auth == nil {
                guard let ch = pickChallenge(res.headers["www-authenticate"] ?? "") else {
                    done(.failure(RtspError("rtsp.authUnknown", "RTSP: authentication required, unknown method"))); return
                }
                self.challenge = ch
                self.nc += 1
                self.send(method, uri, headers, authorization(challenge: ch, credentials: c, method: method, uri: uri, nc: self.nc), done)
                return
            }
            guard res.status == 200 else {
                done(.failure(res.status == 401
                    ? RtspError("rtsp.unauthorized", "RTSP \(method): 401 (credentials?)", ["method": method])
                    : RtspError("rtsp.status", "RTSP \(method): \(res.status)", ["method": method, "status": res.status])))
                return
            }
            done(.success(res))
        }
        conn.send(content: Data(text.utf8), completion: .contentProcessed { _ in })
    }

    private func answer(_ r: RtspResponse) { pending?(r) }

    // MARK: helpers

    private func every(_ seconds: Double, _ f: @escaping () -> Void) {
        let t = DispatchSource.makeTimerSource(queue: queue)
        t.schedule(deadline: .now() + seconds, repeating: seconds)
        t.setEventHandler(handler: f)
        t.resume()
        timers.append(t)
    }

    static func number(after key: String, in s: String, second: Bool = false) -> Int? {
        guard let r = s.range(of: key) else { return nil }
        let rest = s[r.upperBound...]
        let nums = rest.prefix { $0.isNumber || $0 == "-" }.split(separator: "-")
        return Int(second ? (nums.count > 1 ? nums[1] : "") : (nums.first ?? ""))
    }

    static func ipv4(_ host: String) -> sockaddr_in? {
        var hints = addrinfo(ai_flags: 0, ai_family: AF_INET, ai_socktype: SOCK_DGRAM, ai_protocol: 0, ai_addrlen: 0, ai_canonname: nil, ai_addr: nil, ai_next: nil)
        var res: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, nil, &hints, &res) == 0, let r = res, let a = r.pointee.ai_addr else { return nil }
        defer { freeaddrinfo(res) }
        return a.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee }
    }

    /// Two UDP sockets on an even/odd port pair, large receive buffer.
    static func udpPair() -> (rtp: Int32, rtcp: Int32, port: UInt16)? {
        for _ in 0..<20 {
            let port = UInt16(20000 + 2 * Int.random(in: 0..<20000))
            guard let a = bindUdp(port) else { continue }
            guard let b = bindUdp(port + 1) else { close(a); continue }
            var size: Int32 = 8 * 1024 * 1024
            // the system may cap it; halve until it is accepted
            while size > 65536 && setsockopt(a, SOL_SOCKET, SO_RCVBUF, &size, socklen_t(MemoryLayout<Int32>.size)) != 0 { size /= 2 }
            return (a, b, port)
        }
        return nil
    }

    static func bindUdp(_ port: UInt16) -> Int32? {
        let fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        guard fd >= 0 else { return nil }
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr = in_addr(s_addr: INADDR_ANY)
        let ok = withUnsafePointer(to: &addr) { p in
            p.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        if ok != 0 { close(fd); return nil }
        _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)
        return fd
    }

    // MARK: report / stop

    /// Counters for the stats message (same fields as the bridge).
    public func report() -> RtpReport {
        var r = RtpReport(transport: transport.rawValue)
        r.packets = packets; r.lost = reorder?.lost ?? 0; r.reordered = reorder?.reordered ?? 0; r.late = reorder?.late ?? 0
        r.accessUnits = depack?.aus ?? 0; r.droppedUnits = depack?.dropped ?? 0
        if let u = udp {
            var size: Int32 = 0, len = socklen_t(MemoryLayout<Int32>.size)
            if getsockopt(u.rtp, SOL_SOCKET, SO_RCVBUF, &size, &len) == 0 { r.udpBuffer = Int(size) }
        }
        return r
    }

    private func fail(_ e: RtspError) { end(e) }

    private func end(_ e: RtspError?) {
        guard !closed else { return }
        shutdown()
        onEnd?(e)
        onEnd = nil
    }

    public func stop() { queue.async { self.onEnd = nil; self.shutdown() } }

    private func shutdown() {
        guard !closed else { return }
        closed = true
        pendingTimer?.cancel()
        timers.forEach { $0.cancel() }
        timers = []
        if let s = session, let c = conn {
            cseq += 1
            c.send(content: Data("TEARDOWN \(url) RTSP/1.0\r\nCSeq: \(cseq)\r\nSession: \(s)\r\n\r\n".utf8), completion: .contentProcessed { _ in c.cancel() })
        } else { conn?.cancel() }
        conn = nil
        // the read sources close their socket when cancelled
        if udpSources.isEmpty, let u = udp { close(u.rtp); close(u.rtcp) }
        udpSources.forEach { $0.cancel() }
        udpSources = []
        udp = nil
    }
}
