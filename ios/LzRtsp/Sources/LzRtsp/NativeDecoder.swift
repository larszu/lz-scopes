// VideoToolbox decoding on the native side (VTDecompressionSession). Used when the WebView's
// WebCodecs VideoDecoder cannot take the stream (no HEVC support, or 10 bit whose output is
// not I420/NV12). VideoToolbox scales to the analysis width and delivers 8-bit Y′CbCr 4:2:0
// (NV12) in the stream's own range; the conversion to R′G′B′ is done here with the stream's
// matrix and the same formula as src/yuv.ts (ITU-R BT.709-6 §4.6, BT.2020-2 Table 5), not by
// the system, so code values stay the same as on the WebCodecs path.

import CoreMedia
import CoreVideo
import Foundation
import VideoToolbox

public final class NativeDecoder {
    public let format: StreamFormat
    public let width: Int
    public let height: Int
    private var session: VTDecompressionSession?
    private let fullRange: Bool
    private let kr: Double, kb: Double

    /// `targetWidth` 0 = native size; the height follows the aspect ratio (even numbers).
    public init(format: StreamFormat, targetWidth: Int) throws {
        self.format = format
        let w = targetWidth > 0 && targetWidth < format.width ? targetWidth : format.width
        width = w & ~1
        height = max(2, Int((Double(format.height) * Double(w) / Double(max(1, format.width))).rounded()) & ~1)
        fullRange = format.range == "pc"
        (kr, kb) = NativeDecoder.coefficients(format.decodeMatrix)
        let attrs: [CFString: Any] = [
            kCVPixelBufferPixelFormatTypeKey: fullRange ? kCVPixelFormatType_420YpCbCr8BiPlanarFullRange : kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
            kCVPixelBufferWidthKey: width,
            kCVPixelBufferHeightKey: height,
        ]
        var s: VTDecompressionSession?
        let status = VTDecompressionSessionCreate(allocator: nil, formatDescription: format.description, decoderSpecification: nil,
                                                  imageBufferAttributes: attrs as CFDictionary, outputCallback: nil, decompressionSessionOut: &s)
        guard status == noErr, let s else { throw RtspError("ios.decoderFailed", "VideoToolbox: decoder not available (\(status))", ["status": Int(status)]) }
        VTSessionSetProperty(s, key: kVTDecompressionPropertyKey_RealTime, value: kCFBooleanTrue)
        session = s
    }

    deinit { if let s = session { VTDecompressionSessionInvalidate(s) } }

    /// Kr, Kb as in src/yuv.ts MATRIX_K.
    static func coefficients(_ m: String) -> (Double, Double) {
        switch m {
        case "bt601": return (0.299, 0.114)
        case "bt2020": return (0.2627, 0.0593)
        case "smpte240m": return (0.212, 0.087)
        default: return (0.2126, 0.0722)
        }
    }

    /// Decode one access unit (NAL units without start codes) synchronously; the RGBA picture
    /// with `headerBytes` free bytes in front, or nil (VideoToolbox may hold a frame back).
    public func decode(nals: [[UInt8]], headerBytes: Int = 0) throws -> [UInt8]? {
        guard let session else { return nil }
        // AVCC/HVCC: 4-byte big-endian length per NAL unit; parameter sets live in the format description
        var avcc: [UInt8] = []
        for n in nals where !n.isEmpty && !format.codec.isParameterSet(format.codec.nalType(n[0])) {
            let l = UInt32(n.count)
            avcc += [UInt8(l >> 24), UInt8(l >> 16 & 0xff), UInt8(l >> 8 & 0xff), UInt8(l & 0xff)]
            avcc += n
        }
        guard !avcc.isEmpty else { return nil }
        var block: CMBlockBuffer?
        var st = CMBlockBufferCreateWithMemoryBlock(allocator: nil, memoryBlock: nil, blockLength: avcc.count, blockAllocator: nil,
                                                    customBlockSource: nil, offsetToData: 0, dataLength: avcc.count, flags: 0, blockBufferOut: &block)
        guard st == noErr, let block else { return nil }
        st = avcc.withUnsafeBytes { CMBlockBufferReplaceDataBytes(with: $0.baseAddress!, blockBuffer: block, offsetIntoDestination: 0, dataLength: avcc.count) }
        var sample: CMSampleBuffer?
        var size = avcc.count
        st = CMSampleBufferCreateReady(allocator: nil, dataBuffer: block, formatDescription: format.description, sampleCount: 1,
                                       sampleTimingEntryCount: 0, sampleTimingArray: nil, sampleSizeEntryCount: 1, sampleSizeArray: &size, sampleBufferOut: &sample)
        guard st == noErr, let sample else { return nil }
        var out: [UInt8]?
        var failure: OSStatus = noErr
        let s = VTDecompressionSessionDecodeFrame(session, sampleBuffer: sample, flags: [], infoFlagsOut: nil) { status, _, image, _, _ in
            if status != noErr { failure = status; return }
            if let image { out = self.rgba(image, headerBytes: headerBytes) }
        }
        if s != noErr || failure != noErr {
            throw RtspError("ios.decodeFailed", "VideoToolbox: frame not decoded (\(s != noErr ? s : failure))", ["status": Int(s != noErr ? s : failure)])
        }
        return out
    }

    /// NV12 → R′G′B′A 8 bit with the stream's matrix and range (src/yuv.ts yuv420ToRgba).
    func rgba(_ px: CVPixelBuffer, headerBytes: Int) -> [UInt8] {
        CVPixelBufferLockBaseAddress(px, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(px, .readOnly) }
        let w = min(width, CVPixelBufferGetWidthOfPlane(px, 0)), h = min(height, CVPixelBufferGetHeightOfPlane(px, 0))
        var out = [UInt8](repeating: 255, count: headerBytes + width * height * 4)
        guard let yBase = CVPixelBufferGetBaseAddressOfPlane(px, 0)?.assumingMemoryBound(to: UInt8.self),
              let cBase = CVPixelBufferGetBaseAddressOfPlane(px, 1)?.assumingMemoryBound(to: UInt8.self) else { return out }
        let ys = CVPixelBufferGetBytesPerRowOfPlane(px, 0), cs = CVPixelBufferGetBytesPerRowOfPlane(px, 1)
        let yScale = fullRange ? 1.0 / 255 : 1.0 / 219, yOff = fullRange ? 0.0 : 16, cScale = fullRange ? 1.0 / 255 : 1.0 / 224
        var Y = [Float](repeating: 0, count: 256), C = [Float](repeating: 0, count: 256)
        for i in 0..<256 { Y[i] = Float((Double(i) - yOff) * yScale); C[i] = Float((Double(i) - 128) * cScale) }
        let rCr = Float(2 * (1 - kr)), bCb = Float(2 * (1 - kb)), fkr = Float(kr), fkb = Float(kb), kg = Float(1 - kr - kb)
        @inline(__always) func clamp(_ v: Float) -> UInt8 { v <= 0 ? 0 : v >= 1 ? 255 : UInt8(v * 255 + 0.5) }
        out.withUnsafeMutableBufferPointer { o in
            for row in 0..<h {
                let yRow = yBase + row * ys, cRow = cBase + (row >> 1) * cs
                var i = headerBytes + row * width * 4
                for x in 0..<w {
                    let cx = (x >> 1) * 2
                    let cb = C[Int(cRow[cx])], cr = C[Int(cRow[cx + 1])], yy = Y[Int(yRow[x])]
                    let r = yy + rCr * cr, b = yy + bCb * cb, g = (yy - fkr * r - fkb * b) / kg
                    o[i] = clamp(r); o[i + 1] = clamp(g); o[i + 2] = clamp(b)
                    i += 4
                }
            }
        }
        return out
    }
}
