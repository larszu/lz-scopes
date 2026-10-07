// swift-tools-version: 6.0
import PackageDescription

// RTSP/RTP reception directly on iPhone/iPad (issue #90, docs/research/ios-rtsp.md): own port of
// server/rtsp.mjs and server/rtp.mjs, VideoToolbox decoding, and a loopback WebSocket that speaks
// the LZ Scopes frame protocol (docs/frame-protocol.md) to the WebView. No ffmpeg.
// macOS is listed only so `swift test` runs the unit tests on a Mac and in CI.
let package = Package(
    name: "LzRtsp",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "LzRtsp", targets: ["LzRtsp"]),
    ],
    targets: [
        .target(name: "LzRtsp", swiftSettings: [.swiftLanguageMode(.v5)]),
        .testTarget(name: "LzRtspTests", dependencies: ["LzRtsp"], resources: [.copy("Fixtures")], swiftSettings: [.swiftLanguageMode(.v5)]),
    ]
)
