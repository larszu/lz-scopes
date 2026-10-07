// LZ Scopes · native side of the iOS/iPadOS app (docs/ios.md, docs/research/ios-app.md).
//
// The scopes themselves are the web app (WebGL2 in WKWebView). This file only adds what the
// WebView cannot do on its own:
//   - finding bridges in the local network (Bonjour, service type _lz-scopes._tcp, which
//     server/bonjour.mjs announces), because WebKit has no mDNS API;
//   - listing the cameras the system sees (built-in and, from iPadOS 17, USB/UVC), so the app
//     can say honestly whether a capture card is attached even if WebKit does not offer it;
//   - device facts (iPhone or iPad) for the compact layout.
// Bluetooth for the Opple Light Master comes from @capacitor-community/bluetooth-le (MIT).
//
// Registered as a local plugin as described in https://capacitorjs.com/docs/ios/custom-code.

import AVFoundation
import Capacitor
import Foundation
import UIKit

/// Bridge view controller that registers the app's own plugin.
class LzBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LzNativePlugin())
    }
}

@objc(LzNativePlugin)
public class LzNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LzNativePlugin"
    public let jsName = "LzNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "info", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "browseBridges", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cameras", returnType: CAPPluginReturnPromise),
    ]

    private var browses: [BridgeBrowse] = []

    @objc func info(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let device = UIDevice.current
            let idiom: String
            switch device.userInterfaceIdiom {
            case .pad: idiom = "pad"
            case .phone: idiom = "phone"
            case .mac: idiom = "mac"
            default: idiom = "other"
            }
            var onMac = false
            if #available(iOS 14.0, *) { onMac = ProcessInfo.processInfo.isiOSAppOnMac }
            call.resolve([
                "idiom": idiom,
                "system": device.systemName,
                "version": device.systemVersion,
                "model": device.model,
                "iosAppOnMac": onMac,
                "multitasking": UIApplication.shared.supportsMultipleScenes,
            ])
        }
    }

    /// Browse for `_lz-scopes._tcp` for `timeout` ms and resolve every service found.
    @objc func browseBridges(_ call: CAPPluginCall) {
        let timeout = max(500, min(15000, call.getDouble("timeout") ?? 3000)) / 1000
        DispatchQueue.main.async {
            var session: BridgeBrowse?
            session = BridgeBrowse(timeout: timeout) { [weak self] list, error in
                self?.browses.removeAll { $0 === session }
                var result: [String: Any] = ["bridges": list]
                if let error = error { result["error"] = error }
                call.resolve(result)
            }
            if let s = session {
                self.browses.append(s)
                s.start()
            }
        }
    }

    /// Cameras the system offers. `external` = USB/UVC (AVCaptureDevice.DeviceType.external, iPadOS 17).
    @objc func cameras(_ call: CAPPluginCall) {
        var types: [AVCaptureDevice.DeviceType] = [.builtInWideAngleCamera, .builtInUltraWideCamera, .builtInTelephotoCamera]
        if #available(iOS 17.0, *) { types.append(.external) }
        let session = AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .unspecified)
        let list: [[String: Any]] = session.devices.map { d in
            var external = false
            if #available(iOS 17.0, *) { external = d.deviceType == .external }
            let position: String
            switch d.position {
            case .front: position = "front"
            case .back: position = "back"
            default: position = "unspecified"
            }
            return ["id": d.uniqueID, "name": d.localizedName, "manufacturer": d.manufacturer, "external": external, "position": position]
        }
        let auth: String
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: auth = "authorized"
        case .denied: auth = "denied"
        case .restricted: auth = "restricted"
        default: auth = "notDetermined"
        }
        call.resolve(["cameras": list, "authorization": auth])
    }
}

/// One Bonjour browse: NetServiceBrowser plus resolve of each service, ends after `timeout`.
final class BridgeBrowse: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
    private let browser = NetServiceBrowser()
    private let timeout: TimeInterval
    private var services: [NetService] = []
    private var done: (([[String: Any]], String?) -> Void)?
    private var error: String?

    init(timeout: TimeInterval, done: @escaping ([[String: Any]], String?) -> Void) {
        self.timeout = timeout
        self.done = done
    }

    func start() {
        browser.delegate = self
        browser.searchForServices(ofType: "_lz-scopes._tcp.", inDomain: "local.")
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in self?.finish() }
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        services.append(service)
        service.delegate = self
        service.resolve(withTimeout: max(1, timeout - 0.3))
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
        let code = errorDict[NetService.errorCode]?.intValue ?? 0
        // -72008 (NoAuth): local network access denied or NSBonjourServices missing
        error = code == -72008 ? "Zugriff auf das lokale Netzwerk verweigert (Einstellungen → Datenschutz → Lokales Netzwerk)" : "Bonjour-Suche fehlgeschlagen (\(code))"
        finish()
    }

    func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) {}

    private func finish() {
        guard let done = done else { return }
        self.done = nil
        browser.stop()
        let list: [[String: Any]] = services.compactMap { s in
            guard s.port > 0 else { return nil }
            var txt: [String: String] = [:]
            if let data = s.txtRecordData() {
                for (k, v) in NetService.dictionary(fromTXTRecord: data) { txt[k] = String(data: v, encoding: .utf8) ?? "" }
            }
            return ["name": s.name, "host": s.hostName ?? "", "port": s.port, "addresses": BridgeBrowse.addresses(s.addresses ?? []), "txt": txt]
        }
        services.forEach { $0.stop() }
        done(list, list.isEmpty ? error : nil)
    }

    /// Numeric IPv4 addresses first, then IPv6 (link-local ones need a zone and are skipped).
    static func addresses(_ datas: [Data]) -> [String] {
        var v4: [String] = [], v6: [String] = []
        for d in datas {
            d.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
                guard let base = raw.baseAddress else { return }
                let sa = base.assumingMemoryBound(to: sockaddr.self)
                let family = Int32(sa.pointee.sa_family)
                guard family == AF_INET || family == AF_INET6 else { return }
                var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                guard getnameinfo(sa, socklen_t(d.count), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 else { return }
                let s = String(cString: host)
                if family == AF_INET { v4.append(s) } else if !s.lowercased().hasPrefix("fe80") { v6.append(s) }
            }
        }
        return Array(NSOrderedSet(array: v4 + v6)) as? [String] ?? v4 + v6
    }
}
