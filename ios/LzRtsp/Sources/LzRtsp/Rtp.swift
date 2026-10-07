// RTP reception, Swift port of server/rtp.mjs (same behaviour, same counters):
// RTP header (RFC 3550 §5.1), reorder buffer for UDP, depacketisers for H.264 (RFC 6184,
// packetization-mode 0/1: single NAL unit, STAP-A, FU-A) and HEVC (RFC 7798 without DONL:
// single NAL unit, AP, FU). An access unit is complete at the RTP marker bit – or, for senders
// that never set it, when the time stamp changes. Access units with a gap inside are dropped,
// and everything up to the next key frame (a scope must not show concealment).

import Foundation

public struct RtpPacket: Equatable {
    public var marker: Bool
    public var pt: UInt8
    public var seq: UInt16
    public var ts: UInt32
    public var ssrc: UInt32
    public var payload: [UInt8]

    /// nil if it is not RTP version 2 or too short.
    public init?(_ b: [UInt8]) {
        guard b.count >= 12, b[0] >> 6 == 2 else { return nil }
        let padding = b[0] & 0x20 != 0, ext = b[0] & 0x10 != 0, cc = Int(b[0] & 0x0f)
        var off = 12 + cc * 4
        if ext {
            guard b.count >= off + 4 else { return nil }
            off += 4 + Int(be16(b, off + 2)) * 4
        }
        var end = b.count
        if padding { end -= Int(b[b.count - 1]) }
        guard off <= end else { return nil }
        marker = b[1] & 0x80 != 0
        pt = b[1] & 0x7f
        seq = be16(b, 2)
        ts = be32(b, 4)
        ssrc = be32(b, 8)
        payload = Array(b[off..<end])
    }

    public init(marker: Bool, pt: UInt8, seq: UInt16, ts: UInt32, ssrc: UInt32 = 0, payload: [UInt8]) {
        self.marker = marker; self.pt = pt; self.seq = seq; self.ts = ts; self.ssrc = ssrc; self.payload = payload
    }
}

@inline(__always) func be16(_ b: [UInt8], _ o: Int) -> UInt16 { UInt16(b[o]) << 8 | UInt16(b[o + 1]) }
@inline(__always) func be32(_ b: [UInt8], _ o: Int) -> UInt32 {
    UInt32(b[o]) << 24 | UInt32(b[o + 1]) << 16 | UInt32(b[o + 2]) << 8 | UInt32(b[o + 3])
}

/// Signed distance a → b of 16-bit sequence numbers (−32768 … 32767).
public func seqDiff(_ a: UInt16, _ b: UInt16) -> Int { ((Int(b) - Int(a) + 0x18000) % 0x10000) - 0x8000 }

/// Puts UDP packets back in sequence order. A packet missing longer than `maxWaitMs` (or while
/// `window` packets wait behind it) counts as lost and is skipped. `window: 0` hands everything
/// through at once (TCP).
public final class ReorderBuffer {
    public private(set) var lost = 0, reordered = 0, late = 0, duplicates = 0
    private let onPacket: (RtpPacket, Bool) -> Void
    private let window: Int
    private let maxWaitMs: Double
    private var next: UInt16?
    private var highest: UInt16?
    private var held: [UInt16: (pkt: RtpPacket, at: Double)] = [:]
    private var gap = false
    private var skipped: [UInt16] = []
    private var skippedSet = Set<UInt16>()

    public init(window: Int = 64, maxWaitMs: Double = 30, onPacket: @escaping (RtpPacket, Bool) -> Void) {
        self.onPacket = onPacket; self.window = window; self.maxWaitMs = maxWaitMs
    }

    public func push(_ pkt: RtpPacket, now: Double = nowMs()) {
        if window == 0 { onPacket(pkt, false); return }
        if next == nil { next = pkt.seq }
        let d = seqDiff(next!, pkt.seq)
        if d < 0 { // already delivered, or given up as lost
            if skippedSet.remove(pkt.seq) != nil { late += 1 } else { duplicates += 1 }
            return
        }
        if d > 0x4000 { reset(pkt, now: now); return } // sender restarted
        if held[pkt.seq] != nil { duplicates += 1; return }
        if let h = highest, seqDiff(h, pkt.seq) < 0 { reordered += 1 } else { highest = pkt.seq }
        held[pkt.seq] = (pkt, now)
        drain(now: now)
    }

    /// Deliver what is in order; give up on gaps that waited too long.
    public func drain(now: Double = nowMs()) {
        guard var n = next else { return }
        defer { next = n }
        while true {
            if let h = held.removeValue(forKey: n) {
                onPacket(h.pkt, gap)
                gap = false
                n = n &+ 1
                continue
            }
            if held.isEmpty { return }
            let oldest = held.values.map(\.at).min() ?? now
            if held.count < window && now - oldest < maxWaitMs { return }
            let skip = held.keys.map { seqDiff(n, $0) }.min() ?? 0
            lost += skip
            for k in 0..<min(skip, 256) { remember(n &+ UInt16(k)) }
            n = n &+ UInt16(truncatingIfNeeded: skip)
            gap = true
        }
    }

    private func remember(_ s: UInt16) {
        if skippedSet.insert(s).inserted { skipped.append(s) }
        if skipped.count > 1024 {
            let drop = skipped.prefix(skipped.count - 512)
            for x in drop { skippedSet.remove(x) }
            skipped.removeFirst(drop.count)
        }
    }

    private func reset(_ pkt: RtpPacket, now: Double) {
        held.removeAll(); next = pkt.seq; highest = nil; gap = true
        push(pkt, now: now)
    }
}

public func nowMs() -> Double { ProcessInfo.processInfo.systemUptime * 1000 }

public enum VideoCodec: String {
    case h264, hevc

    func nalType(_ first: UInt8) -> Int { self == .h264 ? Int(first & 0x1f) : Int((first >> 1) & 0x3f) }
    func isKey(_ t: Int) -> Bool { self == .h264 ? t == 5 : (16...21).contains(t) }
    func isParameterSet(_ t: Int) -> Bool { self == .h264 ? (t == 7 || t == 8) : (32...34).contains(t) }
}

/// One access unit in Annex B form (4-byte start codes).
public struct AccessUnit {
    public var data: [UInt8]
    public var key: Bool
    public var ts: UInt32
    public var nals: [[UInt8]]
}

let startCode: [UInt8] = [0, 0, 0, 1]

public final class Depacketizer {
    public let codec: VideoCodec
    public private(set) var aus = 0, dropped = 0
    private let onAccessUnit: (AccessUnit) -> Void
    private var nals: [[UInt8]] = []
    private var ts: UInt32?
    private var fu: [UInt8]?
    private var broken = false
    private var needKey = true

    public init(codec: VideoCodec, onAccessUnit: @escaping (AccessUnit) -> Void) {
        self.codec = codec; self.onAccessUnit = onAccessUnit
    }

    /// `gap` = packets were lost right before this one.
    public func push(_ pkt: RtpPacket, gap: Bool = false) {
        // a gap could have taken the end of the pending access unit or the start of this one
        if gap && nals.count + (fu != nil ? 1 : 0) > 0 { broken = true }
        if let t = ts, pkt.ts != t { flush() } // sender without marker bit
        if gap { broken = true; fu = nil }
        ts = pkt.ts
        if codec == .h264 { h264(pkt.payload) } else { hevc(pkt.payload) }
        if pkt.marker { flush() }
    }

    private func h264(_ p: [UInt8]) {
        guard !p.isEmpty else { return }
        let type = p[0] & 0x1f
        switch type {
        case 1...23: nals.append(p)
        case 24: aggregate(p, from: 1) // STAP-A
        case 28: // FU-A: FU indicator (F, NRI) + FU header (S, E, R, type)
            guard p.count >= 2 else { return }
            let s = p[1] & 0x80 != 0, e = p[1] & 0x40 != 0
            if s { fu = [(p[0] & 0xe0) | (p[1] & 0x1f)] + p[2...] }
            else if fu != nil { fu! += p[2...] }
            else { broken = true; return } // middle of a NAL unit whose start is missing
            if e { nals.append(fu!); fu = nil }
        default: broken = true // STAP-B, MTAP, FU-B: interleaved mode, not supported
        }
    }

    private func hevc(_ p: [UInt8]) {
        guard p.count >= 2 else { return }
        let type = (p[0] >> 1) & 0x3f
        switch type {
        case 0..<48: nals.append(p)
        case 48: aggregate(p, from: 2) // AP without DONL
        case 49: // FU: payload header (2) + FU header (S, E, FuType)
            guard p.count >= 3 else { return }
            let s = p[2] & 0x80 != 0, e = p[2] & 0x40 != 0, ft = p[2] & 0x3f
            if s { fu = [(p[0] & 0x81) | (ft << 1), p[1]] + p[3...] }
            else if fu != nil { fu! += p[3...] }
            else { broken = true; return }
            if e { nals.append(fu!); fu = nil }
        default: broken = true // PACI (50) and others
        }
    }

    /// STAP-A / AP: 16-bit size + NAL unit, repeated.
    private func aggregate(_ p: [UInt8], from start: Int) {
        var o = start
        while o + 2 <= p.count {
            let n = Int(be16(p, o)); o += 2
            if n == 0 || o + n > p.count { broken = true; break }
            nals.append(Array(p[o..<(o + n)])); o += n
        }
    }

    private func flush() {
        let list = nals, t = ts ?? 0
        let wasBroken = broken || fu != nil
        nals = []; fu = nil; broken = false
        if wasBroken { dropped += 1; needKey = true; return }
        if list.isEmpty { return }
        let key = list.contains { !$0.isEmpty && codec.isKey(codec.nalType($0[0])) }
        if needKey && !key { dropped += 1; return }
        needKey = false
        aus += 1
        var data: [UInt8] = []
        data.reserveCapacity(list.reduce(0) { $0 + $1.count + 4 })
        for n in list { data += startCode; data += n }
        onAccessUnit(AccessUnit(data: data, key: key, ts: t, nals: list))
    }
}

/// Unwraps 32-bit RTP time stamps into a monotonic ms time line.
public final class RtpClock {
    let rate: Double
    private var first: UInt32?
    private var last: UInt32 = 0
    private var wraps: Int64 = 0

    public init(rate: Int = 90000) { self.rate = Double(rate) }

    public func ms(_ ts: UInt32) -> Double {
        if first == nil { first = ts; last = ts }
        var w = wraps
        if ts < last && last - ts > 0x8000_0000 { wraps += 1; w = wraps; last = ts }
        else if ts > last && ts - last > 0x8000_0000 { w -= 1 } // late packet from before a wrap
        else if ts > last { last = ts }
        return (Double(Int64(ts) + w * 0x1_0000_0000 - Int64(first!)) * 1000) / rate
    }
}

/// NAL units of an Annex B byte stream (3- or 4-byte start codes).
public func splitAnnexB(_ b: [UInt8]) -> [[UInt8]] {
    var out: [[UInt8]] = []
    var i = 0, start = -1
    while i + 2 < b.count {
        if b[i] == 0 && b[i + 1] == 0 && b[i + 2] == 1 {
            if start >= 0 {
                var end = i
                if end > start && b[end - 1] == 0 { end -= 1 }
                out.append(Array(b[start..<end]))
            }
            i += 3; start = i
        } else { i += 1 }
    }
    if start >= 0 && start < b.count { out.append(Array(b[start...])) }
    return out.filter { !$0.isEmpty }
}
