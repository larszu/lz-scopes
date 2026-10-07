// Stream format from the parameter sets: picture size and colour tags through CoreMedia
// (CMVideoFormatDescriptionCreateFromH264/HEVCParameterSets parses the SPS including VUI),
// the WebCodecs codec string (RFC 6381 for avc1; ISO/IEC 14496-15 Annex E for hvc1) and the
// names the bridge uses in its `info` message (ffprobe names, server/index.mjs decodeParams).

import CoreMedia
import Foundation

public struct StreamFormat {
    public var codec: VideoCodec
    public var width: Int
    public var height: Int
    /// WebCodecs codec string, e.g. avc1.640028 or hvc1.1.6.L120.B0
    public var codecString: String
    /// ffprobe names: matrix (color_space), primaries, transfer, range ("tv" | "pc" | "unknown")
    public var matrix: String
    public var primaries: String
    public var transfer: String
    public var range: String
    /// HEVC Main 10 / H.264 High 10 and above: WebKit's VideoDecoder output is not I420/NV12 there
    public var highBitDepth: Bool
    public var description: CMVideoFormatDescription

    /// Matrix for the Y′CbCr → R′G′B′ conversion (as decodeParams() in server/index.mjs).
    public var decodeMatrix: String {
        if matrix.hasPrefix("bt2020") { return "bt2020" }
        if matrix == "bt709" { return "bt709" }
        if matrix == "smpte170m" || matrix == "bt470bg" { return "bt601" }
        if matrix == "smpte240m" { return "smpte240m" }
        return height > 576 ? "bt709" : "bt601"
    }

    public init?(codec: VideoCodec, params: [[UInt8]]) {
        let sets = Self.order(codec, params)
        guard !sets.isEmpty else { return nil }
        var fd: CMFormatDescription?
        let status: OSStatus = sets.withPointers { ptrs, sizes in
            codec == .h264
                ? CMVideoFormatDescriptionCreateFromH264ParameterSets(allocator: nil, parameterSetCount: ptrs.count, parameterSetPointers: ptrs,
                                                                      parameterSetSizes: sizes, nalUnitHeaderLength: 4, formatDescriptionOut: &fd)
                : CMVideoFormatDescriptionCreateFromHEVCParameterSets(allocator: nil, parameterSetCount: ptrs.count, parameterSetPointers: ptrs,
                                                                      parameterSetSizes: sizes, nalUnitHeaderLength: 4, extensions: nil, formatDescriptionOut: &fd)
        }
        guard status == noErr, let d = fd else { return nil }
        self.codec = codec
        description = d
        let dims = CMVideoFormatDescriptionGetPresentationDimensions(d, usePixelAspectRatio: false, useCleanAperture: true)
        width = Int(dims.width.rounded()); height = Int(dims.height.rounded())
        let ext = CMFormatDescriptionGetExtensions(d) as? [String: Any] ?? [:]
        func tag(_ k: CFString) -> String? { ext[k as String] as? String }
        matrix = Self.matrixName(tag(kCMFormatDescriptionExtension_YCbCrMatrix))
        primaries = Self.primariesName(tag(kCMFormatDescriptionExtension_ColorPrimaries))
        transfer = Self.transferName(tag(kCMFormatDescriptionExtension_TransferFunction))
        if let full = ext[kCMFormatDescriptionExtension_FullRangeVideo as String] as? Bool { range = full ? "pc" : "tv" } else { range = "unknown" }
        let sps = sets.first { codec.nalType($0[0]) == (codec == .h264 ? 7 : 33) } ?? []
        codecString = codec == .h264 ? Self.avcString(sps) : Self.hevcString(sps)
        highBitDepth = codec == .h264 ? (sps.count > 1 && [110, 122, 244].contains(sps[1])) : Self.hevcProfile(sps) == 2
    }

    /// Parameter sets in the order CoreMedia expects (H.264: SPS, PPS; HEVC: VPS, SPS, PPS), one each.
    static func order(_ codec: VideoCodec, _ params: [[UInt8]]) -> [[UInt8]] {
        let types = codec == .h264 ? [7, 8] : [32, 33, 34]
        let list = types.compactMap { t in params.first { !$0.isEmpty && codec.nalType($0[0]) == t } }
        return list.count == types.count ? list : []
    }

    /// RFC 6381 §3.3: avc1.PPCCLL from profile_idc, constraint flags and level_idc of the SPS.
    static func avcString(_ sps: [UInt8]) -> String {
        guard sps.count >= 4 else { return "avc1.42e01e" }
        return String(format: "avc1.%02x%02x%02x", sps[1], sps[2], sps[3])
    }

    /// general profile_tier_level of an HEVC SPS (H.265 §7.3.2.2.1, §7.3.3) as raw RBSP bytes.
    static func hevcPtl(_ sps: [UInt8]) -> [UInt8]? {
        let rbsp = unescape(Array(sps.dropFirst(2))) // NAL unit header is 2 bytes
        // byte 0: sps_video_parameter_set_id(4) max_sub_layers_minus1(3) temporal_id_nesting(1);
        // then 12 bytes general PTL: profile_space(2) tier(1) profile_idc(5), 32 compat flags,
        // 48 constraint flags, level_idc(8)
        guard rbsp.count >= 13 else { return nil }
        return Array(rbsp[1..<13])
    }

    static func hevcProfile(_ sps: [UInt8]) -> Int { hevcPtl(sps).map { Int($0[0] & 0x1f) } ?? 0 }

    /// ISO/IEC 14496-15 Annex E: hvc1.[A-C]?profile.compat(reversed, hex).[LH]level.constraints
    static func hevcString(_ sps: [UInt8]) -> String {
        guard let p = hevcPtl(sps) else { return "hvc1.1.6.L93.B0" }
        let space = Int(p[0] >> 6), tier = (p[0] >> 5) & 1, profile = Int(p[0] & 0x1f)
        let compat = UInt32(p[1]) << 24 | UInt32(p[2]) << 16 | UInt32(p[3]) << 8 | UInt32(p[4])
        var rev: UInt32 = 0
        for i in 0..<32 where compat & (1 << i) != 0 { rev |= 1 << (31 - i) }
        var cons = Array(p[5..<11])
        while let last = cons.last, last == 0 { cons.removeLast() }
        let spaceLetter = space == 0 ? "" : String(UnicodeScalar(UInt8(64 + space)))
        var s = "hvc1.\(spaceLetter)\(profile).\(String(rev, radix: 16, uppercase: true)).\(tier == 1 ? "H" : "L")\(p[11])"
        for c in cons { s += "." + String(c, radix: 16, uppercase: true) }
        if cons.isEmpty { s += ".0" }
        return s
    }

    /// Remove emulation prevention bytes (00 00 03 → 00 00).
    static func unescape(_ b: [UInt8]) -> [UInt8] {
        var out: [UInt8] = []
        out.reserveCapacity(b.count)
        var zeros = 0
        for x in b {
            if zeros >= 2 && x == 3 { zeros = 0; continue }
            out.append(x)
            zeros = x == 0 ? zeros + 1 : 0
        }
        return out
    }

    static func name(_ v: String?, _ table: [(CFString, String)]) -> String {
        guard let v else { return "unknown" }
        return table.first { ($0.0 as String) == v }?.1 ?? "unknown"
    }

    static func matrixName(_ v: String?) -> String {
        name(v, [(kCMFormatDescriptionYCbCrMatrix_ITU_R_709_2, "bt709"), (kCMFormatDescriptionYCbCrMatrix_ITU_R_601_4, "smpte170m"),
                 (kCMFormatDescriptionYCbCrMatrix_ITU_R_2020, "bt2020nc"), (kCMFormatDescriptionYCbCrMatrix_SMPTE_240M_1995, "smpte240m")])
    }

    static func primariesName(_ v: String?) -> String {
        name(v, [(kCMFormatDescriptionColorPrimaries_ITU_R_709_2, "bt709"), (kCMFormatDescriptionColorPrimaries_EBU_3213, "bt470bg"),
                 (kCMFormatDescriptionColorPrimaries_SMPTE_C, "smpte170m"), (kCMFormatDescriptionColorPrimaries_ITU_R_2020, "bt2020"),
                 (kCMFormatDescriptionColorPrimaries_DCI_P3, "smpte431"), (kCMFormatDescriptionColorPrimaries_P3_D65, "smpte432")])
    }

    static func transferName(_ v: String?) -> String {
        name(v, [(kCMFormatDescriptionTransferFunction_ITU_R_709_2, "bt709"), (kCMFormatDescriptionTransferFunction_SMPTE_ST_2084_PQ, "smpte2084"),
                 (kCMFormatDescriptionTransferFunction_ITU_R_2100_HLG, "arib-std-b67"), (kCMFormatDescriptionTransferFunction_ITU_R_2020, "bt2020-10"),
                 (kCMFormatDescriptionTransferFunction_SMPTE_240M_1995, "smpte240m"), (kCMFormatDescriptionTransferFunction_Linear, "linear"),
                 (kCMFormatDescriptionTransferFunction_sRGB, "iec61966-2-1")])
    }
}

extension Array where Element == [UInt8] {
    /// Stable pointers to every element for the CoreMedia parameter-set calls.
    func withPointers<R>(_ body: ([UnsafePointer<UInt8>], [Int]) -> R) -> R {
        let copies = map { bytes -> UnsafeMutablePointer<UInt8> in
            let p = UnsafeMutablePointer<UInt8>.allocate(capacity: bytes.count)
            p.initialize(from: bytes, count: bytes.count)
            return p
        }
        defer { copies.forEach { $0.deallocate() } }
        return body(copies.map { UnsafePointer($0) }, map(\.count))
    }
}
