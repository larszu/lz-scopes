// RTSP 1.0 pieces (RFC 2326), Swift port of server/rtsp.mjs: authentication (RFC 2617, Basic
// and Digest with MD5, qop auth or none), SDP (RFC 4566) with the first H.264/HEVC video track
// and its out-of-band parameter sets (RFC 6184 §8.1, RFC 7798 §7.1), and the TCP stream parser
// that splits responses from interleaved `$` frames (RFC 2326 §10.12).
// Errors carry the bridge's message codes (server/messages.mjs) so the web UI translates them
// with the same keys (src/i18n/*/bridge.ts).

import CryptoKit
import Foundation

public struct RtspError: Error, CustomStringConvertible {
    public let code: String
    public let message: String
    public let params: [String: Any]
    public init(_ code: String, _ message: String, _ params: [String: Any] = [:]) {
        self.code = code; self.message = message; self.params = params
    }
    public var description: String { message }
}

public struct Credentials: Equatable {
    public var user: String
    public var pass: String
    public init(user: String, pass: String) { self.user = user; self.pass = pass }
}

func md5(_ s: String) -> String {
    Insecure.MD5.hash(data: Data(s.utf8)).map { String(format: "%02x", $0) }.joined()
}

/// `Digest realm="…", nonce="…", qop="auth"` → ["realm": …, "nonce": …, "qop": …]
public func parseAuthParams(_ h: String) -> [String: String] {
    var out: [String: String] = [:]
    let re = try! NSRegularExpression(pattern: #"(\w+)=(?:"([^"]*)"|([^,\s]+))"#)
    let ns = h as NSString
    for m in re.matches(in: h, range: NSRange(location: 0, length: ns.length)) {
        let k = ns.substring(with: m.range(at: 1)).lowercased()
        let v = m.range(at: 2).location != NSNotFound ? ns.substring(with: m.range(at: 2)) : ns.substring(with: m.range(at: 3))
        out[k] = v
    }
    return out
}

/// Authorization header for a challenge (RFC 2617 §3.2.2).
public func authorization(challenge: String, credentials c: Credentials, method: String, uri: String, nc: Int = 1,
                          cnonce: String = randomHex(8)) -> String {
    if challenge.lowercased().hasPrefix("basic") {
        return "Basic " + Data("\(c.user):\(c.pass)".utf8).base64EncodedString()
    }
    let p = parseAuthParams(challenge)
    let realm = p["realm"] ?? "", nonce = p["nonce"] ?? ""
    let ha1 = md5("\(c.user):\(realm):\(c.pass)"), ha2 = md5("\(method):\(uri)")
    let qop = (p["qop"] ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.contains("auth") ? "auth" : nil
    let ncs = String(format: "%08x", nc)
    let response = qop != nil ? md5("\(ha1):\(nonce):\(ncs):\(cnonce):auth:\(ha2)") : md5("\(ha1):\(nonce):\(ha2)")
    var h = "Digest username=\"\(c.user)\", realm=\"\(realm)\", nonce=\"\(nonce)\", uri=\"\(uri)\", response=\"\(response)\""
    if let o = p["opaque"] { h += ", opaque=\"\(o)\"" }
    if qop != nil { h += ", qop=auth, nc=\(ncs), cnonce=\"\(cnonce)\"" }
    return h
}

public func randomHex(_ n: Int) -> String {
    (0..<n).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
}

/// Prefer Digest over Basic when the server offers both (several WWW-Authenticate lines joined by ", ").
public func pickChallenge(_ h: String) -> String? {
    if h.isEmpty { return nil }
    if let r = h.range(of: #"Digest\s[\s\S]*?(?=,\s*Basic\b|$)"#, options: [.regularExpression, .caseInsensitive]) {
        return String(h[r])
    }
    return h.trimmingCharacters(in: .whitespaces).lowercased().hasPrefix("basic") ? "Basic" : nil
}

public struct Track: Equatable {
    public var codec: VideoCodec
    public var pt: UInt8
    public var rate: Int
    /// out-of-band parameter sets (H.264: SPS, PPS; HEVC: VPS, SPS, PPS), without start codes
    public var params: [[UInt8]]
    public var control: String
    public var session: String
}

/// The first H.264/HEVC video track of an SDP. Throws for anything this client does not handle.
public func parseSdp(_ sdp: String, base: String) throws -> Track {
    var sessionAttrs: [String] = []
    var media: [(m: String, attrs: [String])] = []
    for raw in sdp.components(separatedBy: "\n") {
        let l = raw.hasSuffix("\r") ? String(raw.dropLast()) : raw
        if l.hasPrefix("m=") { media.append((l, [])) }
        else if l.hasPrefix("a=") {
            if media.isEmpty { sessionAttrs.append(String(l.dropFirst(2))) } else { media[media.count - 1].attrs.append(String(l.dropFirst(2))) }
        }
    }
    let sessCtl = sessionAttrs.first { $0.hasPrefix("control:") }.map { String($0.dropFirst(8)).trimmingCharacters(in: .whitespaces) }
    let root = sessCtl != nil && sessCtl != "*" ? resolveUrl(sessCtl!, base: base) : base
    for md in media {
        let parts = md.m.dropFirst(2).split(whereSeparator: { $0 == " " || $0 == "\t" }).map(String.init)
        guard parts.count >= 4, parts[0] == "video" else { continue }
        for pt in parts[3...] {
            guard let map = md.attrs.first(where: { $0.hasPrefix("rtpmap:\(pt) ") }) else { continue }
            let enc = map.split(separator: " ").dropFirst().first.map { $0.split(separator: "/").map(String.init) } ?? []
            guard let name = enc.first?.lowercased() else { continue }
            let codec: VideoCodec
            if name == "h264" { codec = .h264 } else if name == "h265" { codec = .hevc } else { continue }
            let rate = enc.count > 1 ? Int(enc[1]) ?? 90000 : 90000
            var fmtp: [String: String] = [:]
            if let f = md.attrs.first(where: { $0.hasPrefix("fmtp:\(pt) ") }) {
                for item in f.dropFirst("fmtp:\(pt) ".count).split(separator: ";") {
                    let x = item.trimmingCharacters(in: .whitespaces)
                    guard let i = x.firstIndex(of: "=") else { continue }
                    fmtp[x[..<i].lowercased()] = String(x[x.index(after: i)...])
                }
            }
            if codec == .h264 && Int(fmtp["packetization-mode"] ?? "0") == 2 {
                throw RtspError("rtsp.h264Interleaved", "H.264 in interleaved mode (packetization-mode=2) not supported")
            }
            if codec == .hevc && (Int(fmtp["sprop-max-don-diff"] ?? "0") ?? 0) > 0 {
                throw RtspError("rtsp.hevcDonl", "HEVC with DONL (sprop-max-don-diff > 0) not supported")
            }
            let keys = codec == .h264 ? ["sprop-parameter-sets"] : ["sprop-vps", "sprop-sps", "sprop-pps"]
            let params = keys.flatMap { (fmtp[$0] ?? "").split(separator: ",").map(String.init) }
                .compactMap { base64Bytes($0) }.filter { !$0.isEmpty }
            let ctl = md.attrs.first { $0.hasPrefix("control:") }.map { String($0.dropFirst(8)).trimmingCharacters(in: .whitespaces) }
            return Track(codec: codec, pt: UInt8(pt) ?? 96, rate: rate, params: params,
                         control: ctl != nil ? resolveUrl(ctl!, base: root) : root, session: root)
        }
    }
    throw RtspError("rtsp.noTrack", "No H.264/HEVC video track in the SDP")
}

func base64Bytes(_ s: String) -> [UInt8]? {
    var t = s.trimmingCharacters(in: .whitespaces)
    while t.count % 4 != 0 { t += "=" }
    return Data(base64Encoded: t).map { [UInt8]($0) }
}

func resolveUrl(_ ctl: String, base: String) -> String {
    if ctl.lowercased().hasPrefix("rtsp://") || ctl.lowercased().hasPrefix("rtsps://") { return ctl }
    return base.hasSuffix("/") ? base + ctl : "\(base)/\(ctl)"
}

public struct RtspResponse {
    public var status: Int
    /// lower-case names; repeated headers joined with ", "
    public var headers: [String: String]
    public var body: String
}

/// Splits an incoming TCP byte stream into RTSP responses and interleaved `$` frames.
public final class RtspStreamParser {
    private var buf: [UInt8] = []
    private var pos = 0
    private let onResponse: (RtspResponse) -> Void
    private let onFrame: (UInt8, [UInt8]) -> Void

    public init(onResponse: @escaping (RtspResponse) -> Void, onFrame: @escaping (UInt8, [UInt8]) -> Void) {
        self.onResponse = onResponse; self.onFrame = onFrame
    }

    public func push<C: Collection>(_ chunk: C) throws where C.Element == UInt8 {
        buf.append(contentsOf: chunk)
        defer { if pos > 65536 || pos == buf.count { buf.removeFirst(pos); pos = 0 } }
        while pos < buf.count {
            if buf[pos] == 0x24 { // '$' channel length(16) data
                guard buf.count - pos >= 4 else { return }
                let n = Int(be16(buf, pos + 2))
                guard buf.count - pos >= 4 + n else { return }
                onFrame(buf[pos + 1], Array(buf[(pos + 4)..<(pos + 4 + n)]))
                pos += 4 + n
                continue
            }
            guard let end = headerEnd() else {
                if buf.count - pos > 65536 { throw RtspError("rtsp.headerTooLong", "RTSP: header too long") }
                return
            }
            let head = String(decoding: buf[pos..<end], as: UTF8.self).components(separatedBy: "\r\n")
            var headers: [String: String] = [:]
            for l in head.dropFirst() {
                guard let i = l.firstIndex(of: ":") else { continue }
                let k = l[..<i].trimmingCharacters(in: .whitespaces).lowercased()
                let v = l[l.index(after: i)...].trimmingCharacters(in: .whitespaces)
                headers[k] = headers[k].map { "\($0), \(v)" } ?? v
            }
            let len = Int(headers["content-length"] ?? "0") ?? 0
            guard buf.count >= end + 4 + len else { return }
            let body = String(decoding: buf[(end + 4)..<(end + 4 + len)], as: UTF8.self)
            pos = end + 4 + len
            let first = head.first ?? ""
            if first.hasPrefix("RTSP/"), let code = first.split(separator: " ").dropFirst().first.flatMap({ Int($0) }) {
                onResponse(RtspResponse(status: code, headers: headers, body: body))
            }
            // requests from the server (e.g. ANNOUNCE, GET_PARAMETER) are not answered
        }
    }

    private func headerEnd() -> Int? {
        var i = pos
        while i + 3 < buf.count {
            if buf[i] == 13 && buf[i + 1] == 10 && buf[i + 2] == 13 && buf[i + 3] == 10 { return i }
            i += 1
        }
        return nil
    }
}

/// Loss over a few seconds above which UDP gives way to TCP (as in server/rtsp.mjs).
public let udpLossLimit = 0.02

public struct RtpReport: Equatable {
    public var transport: String
    public var packets = 0, lost = 0, reordered = 0, late = 0, accessUnits = 0, droppedUnits = 0
    public var udpBuffer = 0

    public var json: [String: Any] {
        var o: [String: Any] = ["transport": transport, "packets": packets, "lost": lost, "reordered": reordered,
                                "late": late, "accessUnits": accessUnits, "droppedUnits": droppedUnits]
        if udpBuffer > 0 { o["udpBuffer"] = udpBuffer }
        return o
    }
}

/// Should a UDP session give way to TCP? Same rule as udpTooLossy() in server/rtsp.mjs.
public func udpTooLossy(_ a: RtpReport, _ b: RtpReport) -> Bool {
    let got = b.packets - a.packets, lost = b.lost - a.lost
    let aus = b.accessUnits - a.accessUnits, dropped = b.droppedUnits - a.droppedUnits
    if got + lost < 50 { return false }
    return Double(lost) / Double(got + lost) > udpLossLimit || (aus + dropped > 10 && Double(dropped) / Double(aus + dropped) > 0.25)
}

/// rtsp://user:pass@host:port/path → URL without credentials, plus the credentials.
public func splitCredentials(_ url: String) -> (url: String, credentials: Credentials?) {
    guard var c = URLComponents(string: url), let user = c.user, !user.isEmpty else { return (url, nil) }
    let cred = Credentials(user: c.user ?? "", pass: c.password ?? "")
    c.user = nil; c.password = nil
    return (c.string ?? url, cred)
}
