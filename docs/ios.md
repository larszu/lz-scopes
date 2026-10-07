# iPhone- und iPad-App

Die App ist dieselbe Web-App wie im Browser und in der Desktop-App, verpackt mit [Capacitor](https://capacitorjs.com) (MIT) in `ios/`. Hintergrund und Quellen stehen in [research/ios-app.md](research/ios-app.md).

**Stand:** baut in der CI und startet im iOS-Simulator (iPhone und iPad, Bildschirmfotos als Artefakt des Workflows `iOS`). **Auf echten Geräten ist nichts geprüft:** Bluetooth (Opple), USB-Capture, Kamera, Bonjour im WLAN, Leistung der Scopes und Stage Manager.

## Was die App kann

| Eingang | iPhone | iPad | Weg |
|---|---|---|---|
| Testbilder, Dateien, Fotos | ja | ja | wie im Browser |
| Eingebaute Kamera | ja | ja | getUserMedia |
| USB-C-Capture-Karte (UVC) | nein | ab iPadOS 17 | getUserMedia, Liste der Systemkameras im Abschnitt „iPad: Kameras und USB-Capture“ |
| RTSP, SRT, HLS, NDI, DeckLink, Resolve | über die Bridge | über die Bridge | Bridge auf einem Rechner im selben Netz |
| Opple Light Master | ja | ja | CoreBluetooth (@capacitor-community/bluetooth-le); nimmt den Light Master mit dem stärksten Signal |
| Bildschirm/Fenster, Ordner beobachten | nein | nein | gibt es in WKWebView nicht, Schaltflächen deaktiviert |

Bedienung: Auf dem iPad gilt das normale Layout mit Seitenleiste. Split View, Slide Over und Stage Manager werden unterstützt (alle Ausrichtungen, kein Vollbildzwang). Unter 700 px Breite wird die Kopfleiste waagerecht scrollbar. Auf dem iPhone startet die App beim ersten Mal mit Bild über Waveform (Layout „1/1“), die Seitenleiste ist zu. Scopes nehmen alle Berührungen an, die Seite selbst scrollt nicht. Apple Pencil und Trackpad laufen über die normalen Pointer-Events.

## Bridge im Netz

Auf dem Rechner mit den Quellen:

```bash
npm start -- --host 0.0.0.0                  # aus dem Repo
open --env LZS_HOST=0.0.0.0 -a "LZ Scopes"   # Desktop-App am Mac
```

Lauscht die Bridge nicht nur auf 127.0.0.1, meldet sie sich per Bonjour als `_lz-scopes._tcp` (`LZS_BONJOUR=0` schaltet das ab). In der App: Seitenleiste → Bridge → „Bridge im Netz suchen“. Ist das Feld leer und es gibt genau eine Bridge, trägt die App sie selbst ein. Sonst die Adresse von Hand eingeben, `192.168.1.20` reicht (Port 4192 und `ws://` werden ergänzt).

Achtung: Im Netz kann dann jeder Rechner über die Bridge Streams öffnen, also auch die Kameras und Capture-Geräte des Rechners. Nur in vertrauenswürdigen Netzen. Steuerung, Messgeräte und PTP bleiben auf den Rechner selbst beschränkt.

## Bauen

Voraussetzung: Mac mit Xcode 26 oder neuer (Capacitor 8).

```bash
npm ci
npm run ios:sync      # vite build + cap sync ios
npm run ios:open      # öffnet ios/App/App.xcodeproj in Xcode
```

In Xcode Ziel „App“, ein Simulator oder ein angeschlossenes Gerät, dann Run. Für ein eigenes Gerät unter Signing & Capabilities das Team wählen. Mit einem kostenlosen Apple-Konto geht das nur für eigene Geräte, und die App läuft dann nur einige Tage.

CI: `.github/workflows/ios.yml` baut auf `macos-26` ohne Signierung für den Simulator. Dann startet sie neben einer Bridge auf dem Runner je einen iPhone- und einen iPad-Simulator und lädt Bildschirmfotos und das Konsolenlog hoch. Das Log enthält die Zeile `[lzs-ios] … WebGL2 …` mit den Float-Erweiterungen der WebView.

## Signierung und TestFlight: was Lars braucht

Das kostet Geld und ist deshalb Lars' Entscheidung. Empfehlung: TestFlight.

1. **Apple Developer Program** (99 USD pro Jahr, developer.apple.com/programs). Als Einzelperson oder als Firma. Die Firma braucht eine D-U-N-S-Nummer und erscheint dann als Anbieter im Store.
2. **Team-ID** (10 Zeichen, unter Membership). In Xcode unter Signing & Capabilities das Team wählen. Für die CI kommt sie als Secret `APPLE_TEAM_ID` ins Repo.
3. **App-ID** `de.zumpelars.lzscopes` registrieren und in App Store Connect die App „LZ Scopes“ anlegen (Plattform iOS, ein Build für iPhone und iPad).
4. **Signierung in der CI.** Empfohlen ist ein App-Store-Connect-API-Schlüssel (Users and Access → Integrations → Team Keys, Rolle „App Manager“). Damit signiert Xcode automatisch (`-allowProvisioningUpdates` mit `-authenticationKeyPath/-ID/-IssuerID`), Zertifikate und Profile muss niemand von Hand pflegen. Secrets:
   - `ASC_KEY_ID`, `ASC_ISSUER_ID`
   - `ASC_KEY_P8` (Inhalt der .p8-Datei, Base64)
   - `APPLE_TEAM_ID`

   Alternative: Distributionszertifikat als .p12 plus Provisioning-Profil als Secrets (`IOS_DIST_P12`, `IOS_DIST_P12_PASSWORD`, `IOS_PROFILE`).
5. **Hochladen** mit `xcodebuild archive`, dann `-exportArchive` (Methode App Store Connect, Ziel Upload). Danach in TestFlight die Tester einladen.

Der Upload-Workflow ist noch nicht gebaut, weil es ohne Konto und Secrets nichts zu prüfen gibt. Schritte 4 und 5 sind deshalb ungeprüft. Mit den Secrets lässt er sich nach dem Muster von `release.yml` ergänzen, ausgelöst durch einen `ios-v*`-Tag.

Vor dem App Store zusätzlich nötig: Datenschutzangaben (Kamera, Mikrofon, Bluetooth, lokales Netz; es werden keine Daten erhoben), Screenshots echter Geräte und eine Support-URL.
