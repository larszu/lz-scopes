// lzs-colorsync: small helper for LZ Scopes (#17). Reads and sets the ColorSync display profile
// through the public ColorSync device API (SDK header ColorSyncDevice.h):
//   ColorSyncDeviceCopyDeviceInfo, ColorSyncDeviceSetCustomProfiles, CGDisplayCreateUUIDFromDisplayID.
//
//   lzs-colorsync list                       → JSON array of active displays
//   lzs-colorsync set <displayID> <file.icc> → custom profile for the display's default profile ID
//   lzs-colorsync reset <displayID>          → remove the custom profile (factory profile again)
//
// The display ID is the CGDirectDisplayID (Electron's screen Display.id on macOS).
import ColorSync
import CoreGraphics
import Foundation

func fail(_ msg: String) -> Never {
  FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
  exit(1)
}

func info(_ id: CGDirectDisplayID) -> (uuid: CFUUID, dict: NSDictionary)? {
  guard let uuid = CGDisplayCreateUUIDFromDisplayID(id)?.takeRetainedValue() else { return nil }
  guard let d = ColorSyncDeviceCopyDeviceInfo(kColorSyncDisplayDeviceClass.takeUnretainedValue(), uuid)?.takeRetainedValue() else { return nil }
  return (uuid, d as NSDictionary)
}

func key(_ k: Unmanaged<CFString>) -> String { k.takeUnretainedValue() as String }

/// Default profile ID, factory URL and custom URL for that ID.
func profiles(_ d: NSDictionary) -> (id: String, factory: URL?, custom: URL?) {
  let factory = d[key(kColorSyncFactoryProfiles)] as? NSDictionary ?? [:]
  let custom = d[key(kColorSyncCustomProfiles)] as? NSDictionary ?? [:]
  let id = factory[key(kColorSyncDeviceDefaultProfileID)] as? String ?? "1"
  let f = (factory[id] as? NSDictionary)?[key(kColorSyncDeviceProfileURL)] as? URL
  let c = custom[id] as? URL
  return (id, f, c)
}

let args = CommandLine.arguments
guard args.count >= 2 else { fail("usage: lzs-colorsync list | set <displayID> <file.icc> | reset <displayID>") }

switch args[1] {
case "list":
  var n: UInt32 = 0
  CGGetActiveDisplayList(0, nil, &n)
  var ids = [CGDirectDisplayID](repeating: 0, count: Int(n))
  CGGetActiveDisplayList(n, &ids, &n)
  var out: [[String: Any]] = []
  for id in ids {
    guard let (uuid, d) = info(id) else { continue }
    let p = profiles(d)
    out.append([
      "id": Int(id), "uuid": CFUUIDCreateString(nil, uuid) as String,
      "name": d[key(kColorSyncDeviceDescription)] as? String ?? "",
      "builtin": CGDisplayIsBuiltin(id) != 0, "profileId": p.id,
      "factory": p.factory?.path ?? NSNull(), "custom": p.custom?.path ?? NSNull(),
      "current": (p.custom ?? p.factory)?.path ?? NSNull(),
    ])
  }
  let data = try! JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
  print(String(data: data, encoding: .utf8)!)
case "set", "reset":
  guard args.count >= 3, let raw = UInt32(args[2]) else { fail("display ID missing") }
  guard let (uuid, d) = info(raw) else { fail("display \(raw) not found") }
  let p = profiles(d)
  var value: Any = kCFNull!
  if args[1] == "set" {
    guard args.count >= 4 else { fail("profile path missing") }
    let url = URL(fileURLWithPath: args[3])
    guard FileManager.default.fileExists(atPath: url.path) else { fail("profile not found: \(url.path)") }
    value = url as NSURL
  }
  let dict: NSDictionary = [p.id: value]
  let ok = ColorSyncDeviceSetCustomProfiles(kColorSyncDisplayDeviceClass.takeUnretainedValue(), uuid, dict as CFDictionary)
  if !ok { fail("ColorSyncDeviceSetCustomProfiles failed") }
  print("{\"ok\":true}")
default:
  fail("unknown command \(args[1])")
}
