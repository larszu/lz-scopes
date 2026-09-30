# Systemprofil und Monitor-Modus mitschalten (#17) – Recherche

Stand: 30.09.2026. Nur geöffnete Quellen. Was nicht geprüft werden konnte, ist markiert.

## macOS: ColorSync-Geräte-API

Geöffnet wurde der SDK-Header `ColorSync.framework/Headers/ColorSyncDevice.h` (Command Line Tools, macOS 26.6). Apples Online-Doku war per Abruf nicht lesbar.
- `ColorSyncDeviceSetCustomProfiles(CFStringRef deviceClass, CFUUIDRef deviceID, CFDictionaryRef profileInfo)`, ab 10.4. Schlüssel sind die Profile-IDs, mit denen das Gerät registriert ist (oder `kColorSyncDeviceDefaultProfileID`), Werte eine `CFURLRef`. Der Header sagt: „Pass kCFNull in lieu of the profile URL to unset the custom profile and reset the current profile to the factory profile.“ Scope standardmäßig aktueller Benutzer und aktueller Host.
- `ColorSyncDeviceCopyDeviceInfo` liefert `kColorSyncFactoryProfiles` (mit `kColorSyncDeviceDefaultProfileID`) und `kColorSyncCustomProfiles` (ProfileID → URL oder kCFNull).
- `CGDisplayCreateUUIDFromDisplayID(uint32_t)` bildet die CGDirectDisplayID auf die ColorSync-Geräte-ID ab.

**Umsetzung:** kleiner Swift-Helfer `helpers/colorsync/lzs-colorsync.swift` (`list`, `set`, `reset`), gebaut mit `npm run build:helpers` (arm64 + x86_64). Electron startet ihn als eigenen Prozess.

**Auf dem Test-Mac geprüft (30.09.2026, eingebautes Display „Color LCD“):** `list` liest das Werksprofil. `set 1 "sRGB Profile.icc"` setzt das Profil, `list` zeigt es als custom/current. `reset 1` stellt das Werksprofil wieder her, `list` danach entspricht dem Ausgangszustand. Nicht geprüft: externe Displays, mehrere Profile-IDs je Gerät, Referenzmodi der XDR-Displays (dafür gibt es keine öffentliche API, laut Issue).

Mitgelieferte Systemprofile (`/System/Library/ColorSync/Profiles`, auf dem Test-Mac gelistet): `sRGB Profile.icc`, `Display P3.icc`, `ITU-709.icc`, `ITU-2020.icc`, `DCI(P3) RGB.icc`, `AdobeRGB1998.icc` u. a.

## Windows: Farbverwaltung (mscms)

Geöffnet: Microsoft Learn zu [ColorProfileSetDisplayDefaultAssociation](https://learn.microsoft.com/en-us/windows/win32/api/icm/nf-icm-colorprofilesetdisplaydefaultassociation), [ColorProfileAddDisplayAssociation](https://learn.microsoft.com/en-us/windows/win32/api/icm/nf-icm-colorprofileadddisplayassociation), [ColorProfileGetDisplayDefault](https://learn.microsoft.com/en-us/windows/win32/api/icm/nf-icm-colorprofilegetdisplaydefault), [COLORPROFILESUBTYPE](https://learn.microsoft.com/en-us/windows/win32/api/icm/ne-icm-colorprofilesubtype).
- Alle drei Funktionen: Header `icm.h`, `Mscms.lib`, **mindestens Windows 10 Build 20348**. Adapter-LUID und Source-ID stammen aus der DisplayConfig-API (`QueryDisplayConfig`).
- `ColorProfileGetDisplayDefault(scope, targetAdapterID, sourceID, profileType, profileSubType, LPWSTR* profileName)`, den Namen mit `LocalFree` freigeben.
- `ColorProfileSetDisplayDefaultAssociation(scope, profileName, CPT_ICC, subtype, adapterLUID, sourceID)`: Nur CPT_ICC wird unterstützt, laut Tabelle der Subtyp-Seite ist `CPST_NONE` die Kombination für „default ICC profile associated with a device“.
- Das Profil muss installiert sein (`ColorProfileAddDisplayAssociation` ordnet es zu, optional als Standard).

**Umsetzung:** PowerShell mit eingebettetem C# (P/Invoke), ohne eigenes Binary. **Ungeprüft.** Kein Windows-Testrechner, Advanced Color/HDR wird nicht umgeschaltet.

## DDC/CI (Monitor-Modus)

Die VESA-MCCS-Norm selbst ist nicht öffentlich und wurde nicht eingesehen. Die Werte stammen aus ddcutil (`src/vcp/vcp_feature_codes.c`, GPL-2.0-or-later, nur als Fakt gelesen):
- VCP **0x10** „Brightness“ (MCCS 2.0) bzw. „Luminosity“ (3.0), kontinuierlich.
- VCP **0x14** „Select color preset“, Werte (SL-Byte): 0x01 sRGB, 0x02 Display Native, 0x03 4000 K, 0x04 5000 K, 0x05 6500 K, 0x06 7500 K, 0x07 8200 K, 0x08 9300 K, 0x09 10000 K, 0x0A 11500 K, 0x0B–0x0D User 1–3. Ab MCCS 2.2/3.0 trägt das MH-Byte eine Toleranz.
- Einen Rec.709- oder DCI-Wert gibt es in MCCS nicht. Solche Modi sind herstellerspezifisch.

Werkzeuge:
- **Linux:** `ddcutil setvcp 14 <wert> --display N` (GPL, externer Prozess, nur wenn installiert).
- **macOS:** [m1ddc](https://github.com/waydabber/m1ddc) (MIT, README gelesen) kann `set luminance`, aber **keinen** beliebigen VCP-Code, also kein 0x14. Nur Apple Silicon. LZ Scopes nutzt m1ddc nur für die Helligkeit, wenn es installiert ist.
- **Windows:** `dxva2.dll` `SetVCPFeature(hPhysicalMonitor, code, value)` über `GetPhysicalMonitorsFromHMONITOR`. Über dasselbe PowerShell/C#, **ungeprüft**.

## Sicherheit und Rücksetzen

- Vor dem ersten Umschalten eines Displays wird der vorherige Zustand (eigenes Profil oder „Werksprofil“) in `userData/display-profile-backup.json` geschrieben.
- Beim Beenden der App, über „Zurücksetzen“ und beim nächsten Start nach einem Absturz wird zurückgesetzt.
- Windows: Beim Beenden wird nicht synchron zurückgesetzt, weil PowerShell dafür zu langsam ist. Die Sicherung bleibt stehen, und der nächste Start setzt zurück (ungeprüft).
- Im Browser gibt es keine dieser APIs. Die Einstellung erscheint dort nicht.
