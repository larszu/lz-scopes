# iOS- und iPadOS-App – Recherche (#80)

Stand: 06.10.2026. Nur Quellen, die tatsächlich geöffnet wurden. Einschätzungen sind als solche markiert.

## Geöffnete Quellen

- capacitorjs.com/docs/ios: Capacitor 8 aktuell, „iOS 15+ is supported“, „Xcode 26.0+ is required“, WKWebView.
- capacitorjs.com/docs/ios/custom-code: lokale Plugins (`CAPPlugin`, `CAPBridgedPlugin`, `registerPluginInstance` in `capacitorDidLoad` einer `CAPBridgeViewController`-Unterklasse).
- npm-Metadaten und `LICENSE` in `node_modules`: @capacitor/core, /ios, /cli 8.5.2 **MIT** (Copyright Drifty Co.). Die Annahme „Apache-2.0“ im Auftrag stimmt nicht. Capacitor-Quelltext `CAPBridgeViewController.swift` und `WebViewDelegationHandler.swift`: `allowsInlineMediaPlayback = true`, Kamera- und Mikrofonanfragen der Seite werden mit `.grant` beantwortet (die Systemabfrage des Betriebssystems bleibt).
- github.com/capacitor-community/bluetooth-le: MIT; `requestDevice` mit Auswahldialog, Filter `name` und `namePrefix` (je nur einer), `startNotifications`, `write` und `writeWithoutResponse`; im Simulator kein Bluetooth; Plugin 8.x für Capacitor 8; Swift Package Manager unterstützt.
- webkit.org/blog/14445 (Safari 17.0): „WebKit now supports USB cameras on iPadOS 17. When a USB camera is attached to an iPad, it's included in the output of enumerateDevices and is selectable with getUserMedia along with the built-in cameras.“ Dazu WebGL in OffscreenCanvas ab iOS/iPadOS 17.
- webkit.org/blog/13966 (Safari 16.4): Video-Teil von WebCodecs; `isInspectable` für WKWebView ab iOS 16.4.
- bugs.webkit.org 208667: getUserMedia in WKWebView ab iOS 14.3. bugs.webkit.org 220184: auch für Inhalte aus dem App-Bundle bzw. eigenen Schemata (iOS 14.5), Hostname `localhost`, `allowsInlineMediaPlayback`.
- github.com/WebKit/standards-positions/issues/570: Web Bluetooth „position: oppose“ (Sicherheit, Datenschutz, Geräteunabhängigkeit).
- github.com/KhronosGroup/WebGL/issues/3093: iOS bietet unter OpenGL ES 3.0 `EXT_color_buffer_half_float`, aber nicht `EXT_color_buffer_float`. Die Diskussion endete mit einer Spezifikationsänderung.
- registry.khronos.org/webgl/extensions/EXT_color_buffer_half_float: in WebGL 2 macht die Erweiterung RGBA16F, RG16F und R16F zu Rendertargets. RGB16F ist dort nicht renderbar.
- developer.mozilla.org, Mixed content: `fetch`/XHR von https zu http sind blockierbar. Ausnahme sind nur Loopback-Adressen und `file:`.
- developer.apple.com/app-store/review/guidelines: 2.5.2 (kein Nachladen ausführbaren Codes), 2.5.6 (Web-Inhalte nur mit WebKit), 4.2 („beyond a repackaged website“).
- developer.apple.com/programs: 99 USD pro Jahr. TestFlight mit bis zu 10 000 externen Testern. Ohne Bezahlung (kostenloses Konto) nur „Device testing via Xcode“.
- ffmpeg.org/legal.html: LGPL nur ohne `--enable-gpl`/`--enable-nonfree`; zu App Stores sagt die Seite nichts.
- github.com/actions/runner-images, `macos-26-arm64-Readme.md`: Xcode 26.6 als Standard; iOS-Simulator-Laufzeiten 26.0 bis 26.5.
- Geöffnet, Inhalt aber nicht lesbar (JavaScript-Seiten): developer.apple.com, NSBonjourServices und TN3179 „Local network privacy“. Die Schlüssel `NSBonjourServices` und `NSLocalNetworkUsageDescription` sind deshalb nur aus Erfahrung gesetzt. Belegt werden sie erst mit dem Test auf dem echten Gerät.
- Eigene Messung am Mac (06.10.): Die Bridge mit `--host 0.0.0.0` erscheint per `dns-sd -B _lz-scopes._tcp` und löst per `dns-sd -L` auf `<Rechner>.local.:<Port>` mit TXT `v=1 path=/` auf.

## Architektur: Entscheidung Capacitor

| Weg | Für | Gegen |
|---|---|---|
| **Capacitor + WKWebView** | dieselbe Web-App (WebGL2, dockview), fertige Plugin-Struktur, SPM, CLI für Sync, MIT | eine weitere Abhängigkeit |
| eigener Swift-Wrapper | volle Kontrolle | Brücke JS↔Swift, Asset-Handler und Plugin-System nachbauen, nur um Capacitor nachzubilden |
| PWA / Home-Bildschirm über GitHub Pages | kein Store | https-Seite darf die Bridge (`ws://` im LAN) nicht erreichen (Mixed Content); kein Bluetooth; kein Bonjour |
| nativ mit Metal | beste Leistung | alle Scopes, Shader und die UI doppelt pflegen |

**Entscheidung:** Capacitor 8 mit Swift Package Manager (kein CocoaPods), Projekt in `ios/`. Begründung: Nur so bleibt es eine Codebasis. Was die WebView nicht kann (Bonjour, Kameraliste), übernimmt ein kleines lokales Swift-Plugin (`ios/App/App/LzNative.swift`). Bluetooth übernimmt @capacitor-community/bluetooth-le. Mindestversion **iOS/iPadOS 17**: USB-Kameras und WebGL in OffscreenCanvas gibt es erst ab 17.

Zu 4.2 (Mindestfunktion): Die App ist keine verpackte Website. Sie bietet Bluetooth-Messgerät, Bonjour-Suche, Kamera und USB-Capture. Ob Apple das beim Review so sieht, ist offen (Einschätzung).

## Kann WKWebView, was die App braucht?

| Fähigkeit | Befund | Folge |
|---|---|---|
| WebGL2 | Seit Safari 15 vorhanden (in den geöffneten Quellen nicht eigens belegt; WebGL in OffscreenCanvas ab 17 belegt) | läuft |
| `EXT_color_buffer_float` | laut Khronos #3093 auf iOS-GPUs historisch nicht vorhanden | Renderer nimmt jetzt auch `EXT_color_buffer_half_float`, denn die Scopes sammeln in RGBA16F (`src/renderer.ts`) |
| Float-Blending | RGBA16F ist mit der Half-Float-Erweiterung renderbar. `EXT_float_blend` betrifft nur 32 bit | GPU-Statistik (`src/gpuStats.ts`, RGBA32F) fällt dort weg, die Scopes nicht |
| getUserMedia (Kamera) | ab iOS 14.3, aus App-Inhalten ab 14.5 | Kamera-Quelle wie im Browser |
| USB-C-Capture (UVC) | iPadOS 17: in `enumerateDevices` und `getUserMedia` | Quelle „Kamera/Capture“; nur iPad, nicht iPhone |
| Web Bluetooth | WebKit lehnt es ab | `navigator.bluetooth`-Nachbildung über CoreBluetooth (`src/native/webBluetooth.ts`) |
| WebCodecs | Video-Teil seit Safari 16.4 | Grundlage für RTSP direkt (siehe unten) |
| Bildschirmaufnahme, Ordner beobachten | `getDisplayMedia` und File System Access fehlen in WKWebView (Einschätzung aus dem Code-Verhalten) | Schaltflächen in der App deaktiviert, mit Begründung |

Die App schreibt beim Start ins Konsolenlog, welche Erweiterungen die WebView wirklich hat (`[lzs-ios] … EXT_color_buffer_float=…`). Die CI hängt das Log aus dem Simulator an. Der Simulator rechnet auf der Mac-GPU, das echte Gerät kann abweichen.

## Woher kommen die Bilder auf iPhone und iPad?

1. **Bridge im Netz** (Hauptweg): Desktop-App bzw. `npm start` auf einem Rechner, mit `--host 0.0.0.0` / `LZS_HOST=0.0.0.0`. Eine lokale ffmpeg-Bridge auf dem Gerät ist ausgeschlossen: Unter iOS gibt es keine Unterprozesse, und Richtlinie 2.5.2 verbietet nachgeladenen Code. Dazu kommt die Lizenz (siehe unten). Die Bridge meldet sich per Bonjour als `_lz-scopes._tcp` (`server/bonjour.mjs`, bonjour-service, MIT). Die App sucht danach (`NetServiceBrowser`) und trägt eine einzelne gefundene Bridge selbst ein. Die Bridge erlaubt `/stream` aus dem Netz schon heute. `/meter`, `/clock` und `/control?role=app` bleiben auf denselben Ursprung beschränkt, deshalb gehen ArgyllCMS-Messgeräte, PTP-Details und die Fernsteuerung des iPads über die Bridge nicht. Das ist bewusst so und nicht geändert.
2. **Eingebaute Kamera**: getUserMedia.
3. **USB-C-Capture-Karte** (iPad, iPadOS 17): getUserMedia, siehe oben. Das Plugin listet zusätzlich, was AVFoundation sieht (`AVCaptureDevice.DeviceType.external`), und vergleicht es mit dem WebKit-Angebot. So sieht man ehrlich, wenn eine Karte am System hängt, WebKit sie aber nicht anbietet.
4. **Fotos und Dateien**: `<input type=file>` öffnet die iOS-Dateiauswahl (Fotos, Dateien, iCloud).
5. **RTSP direkt** (gebaut in #90, siehe [ios-rtsp.md](ios-rtsp.md); ursprünglicher Plan): Die eigene RTP-Annahme (`server/rtsp.mjs`, `server/rtp.mjs`, eigener Code nach RFC 2326/3550/6184/7798, ohne ffmpeg) lässt sich nach Swift portieren, mit `Network.framework` für TCP-interleaved. Die H.264/HEVC-Zugriffseinheiten gehen dann komprimiert an die WebView und werden dort mit WebCodecs `VideoDecoder` dekodiert. Alternativ dekodiert VideoToolbox. Lizenzrechtlich ist das sauber, weil es eigener Code ist. Offen ist der Transport JS↔Swift bei hoher Datenrate. Der Capacitor-Bridge-Weg kodiert per JSON/Base64, ein lokaler WebSocket wäre die Alternative. Eigener Schritt, eigenes Issue.

## Verteilung und Lizenzen

- **Ad-hoc / Xcode direkt**: Mit kostenlosem Konto läuft die App nur auf eigenen Geräten und muss alle 7 Tage neu signiert werden. Das ist Erfahrungswissen, auf der geöffneten Apple-Seite steht nur „Device testing via Xcode“.
- **TestFlight**: braucht das Apple Developer Program (99 USD pro Jahr). Für Lars, ein paar Kunden und Kollegen ist das der passende Weg. Interne Tester (Team) brauchen keine Beta-Prüfung, externe brauchen eine (Erfahrungswissen).
- **App Store**: später, wenn die Bridge-Suche und die Eingänge auf echten Geräten geprüft sind. Dazu kommen Datenschutzangaben (Kamera, Mikrofon, Bluetooth, lokales Netz; nichts verlässt das Gerät).
- **Empfehlung**: Developer Program abschließen, dann TestFlight intern. Das ist eine Kostenfrage für Lars, Details in [docs/ios.de.md](../ios.de.md).
- **ffmpeg**: kommt nicht in die App. Die Desktop-Builds sind GPLv3 und laufen als eigener Prozess, unter iOS geht beides nicht. Selbst ein LGPL-Build müsste nach ffmpeg.org dynamisch gelinkt und austauschbar sein. Das passt schlecht zum App Store (Einschätzung). Mit eigenem RTP-Code und WebCodecs/VideoToolbox ist ffmpeg nicht nötig.
- Neue Komponenten: Capacitor (MIT), @capacitor-community/bluetooth-le (MIT), bonjour-service (MIT) mit multicast-dns, dns-packet, thunky, @leichtgewicht/ip-codec, fast-deep-equal (alle MIT). Einträge in THIRD_PARTY.md und licenses/.
