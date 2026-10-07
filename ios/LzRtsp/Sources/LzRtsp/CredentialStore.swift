// RTSP credentials in the Keychain (kSecClassInternetPassword, protocol RTSP, server + port),
// so the web side and its local storage never keep a camera password. One entry per
// host:port; readable only while the device is unlocked, never synced or backed up to
// another device (kSecAttrAccessibleWhenUnlockedThisDeviceOnly).

import Foundation
import Security

public enum CredentialStore {
    static let label = "LZ Scopes RTSP"

    public struct Entry: Equatable { public var host: String; public var port: Int; public var user: String }

    static func hostPort(_ url: String) -> (String, Int)? {
        guard let c = URLComponents(string: url), let h = c.host, !h.isEmpty else { return nil }
        return (h.lowercased(), c.port ?? 554)
    }

    static func query(_ host: String, _ port: Int) -> [CFString: Any] {
        [kSecClass: kSecClassInternetPassword, kSecAttrServer: host, kSecAttrPort: port,
         kSecAttrProtocol: kSecAttrProtocolRTSP, kSecAttrLabel: label]
    }

    /// Store (or replace) the credentials for the URL's host and port.
    @discardableResult
    public static func save(_ c: Credentials, for url: String) -> Bool {
        guard let (h, p) = hostPort(url) else { return false }
        SecItemDelete(query(h, p) as CFDictionary)
        var q = query(h, p)
        q[kSecAttrAccount] = c.user
        q[kSecValueData] = Data(c.pass.utf8)
        q[kSecAttrAccessible] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }

    public static func load(for url: String) -> Credentials? {
        guard let (h, p) = hostPort(url) else { return nil }
        var q = query(h, p)
        q[kSecReturnAttributes] = true
        q[kSecReturnData] = true
        q[kSecMatchLimit] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? [CFString: Any],
              let user = d[kSecAttrAccount] as? String, let pass = d[kSecValueData] as? Data else { return nil }
        return Credentials(user: user, pass: String(decoding: pass, as: UTF8.self))
    }

    @discardableResult
    public static func remove(host: String, port: Int) -> Bool {
        SecItemDelete(query(host.lowercased(), port) as CFDictionary) == errSecSuccess
    }

    /// Hosts with stored credentials (user names only, never the password).
    public static func list() -> [Entry] {
        let q: [CFString: Any] = [kSecClass: kSecClassInternetPassword, kSecAttrProtocol: kSecAttrProtocolRTSP, kSecAttrLabel: label,
                                  kSecReturnAttributes: true, kSecMatchLimit: kSecMatchLimitAll]
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let items = out as? [[CFString: Any]] else { return [] }
        return items.compactMap { d in
            guard let h = d[kSecAttrServer] as? String else { return nil }
            return Entry(host: h, port: (d[kSecAttrPort] as? Int) ?? 554, user: (d[kSecAttrAccount] as? String) ?? "")
        }.sorted { ($0.host, $0.port) < ($1.host, $1.port) }
    }
}
