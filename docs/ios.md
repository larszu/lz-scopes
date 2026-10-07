[Deutsch](ios.de.md) | **English**

# iPhone and iPad app

The app is the same web app as in the browser and the desktop app, wrapped with [Capacitor](https://capacitorjs.com) (MIT) in `ios/`. Background and sources are in [research/ios-app.md](research/ios-app.md) (German).

**Status:** builds in CI and starts in the iOS Simulator (iPhone and iPad; screenshots are an artefact of the `iOS` workflow). **Nothing has been tested on real devices:** Bluetooth (Opple), USB capture, camera, Bonjour over Wi-Fi, scope performance and Stage Manager.

## What the app can do

| Input | iPhone | iPad | Path |
|---|---|---|---|
| Test patterns, files, photos | yes | yes | as in the browser |
| Built-in camera | yes | yes | getUserMedia |
| USB-C capture card (UVC) | no | iPadOS 17 and later | getUserMedia; the system camera list is under “iPad: Kameras und USB-Capture” (iPad: cameras and USB capture) |
| RTSP camera (`rtsp://`, H.264/HEVC) | yes, directly | yes, directly | own RTSP/RTP reception in the app, no bridge (see “RTSP direct”) |
| SRT, `rtsps://`, HLS, NDI, DeckLink, Resolve | via the bridge | via the bridge | bridge on a computer in the same network |
| Opple Light Master | yes | yes | CoreBluetooth (@capacitor-community/bluetooth-le); picks the Light Master with the strongest signal |
| Screen/window, watch folder | no | no | not available in WKWebView, buttons disabled |

Operation: on the iPad the normal layout with sidebar applies. Split View, Slide Over and Stage Manager are supported (all orientations, no forced full screen). Below 700 px width the header bar scrolls horizontally. On the iPhone the app starts the first time with the picture above the waveform (layout “1/1”) and the sidebar closed. Scopes take all touches; the page itself does not scroll. Apple Pencil and trackpad work through the normal pointer events.

## RTSP direct

The app receives `rtsp://` cameras itself: “+ Source → RTSP / Network”, enter the address, connect. TCP or UDP follows the source's transport setting; over UDP with more than 2 % loss it switches to TCP by itself. Basic and Digest authentication work. User and password typed into the address (`rtsp://user:pass@camera/stream`) go into the iOS Keychain (this device only) and are removed from the address; Settings → RTSP direct lists the stored entries (user names only) and forgets them. There you can also send `rtsp://` through the bridge again.

How the picture gets to the scopes: the app's own RTSP/RTP code (Swift, `ios/LzRtsp`, a port of the bridge's `server/rtsp.mjs`/`rtp.mjs`) collects the H.264/HEVC frames and hands them compressed to the WebView, which decodes them with WebCodecs. Where WebKit cannot (HEVC 10 bit, or no HEVC), VideoToolbox decodes in the app and the frames arrive at the analysis width. No ffmpeg in the app.

Limits: 8 bit, the camera's own compression; no sound; `rtsps://` only via the bridge; UDP only over IPv4. Tested with a local test server (mediamtx, SMPTE bars) in unit tests and in the iOS Simulator, **not yet on a real iPhone/iPad and not with real cameras**. Details: [docs/research/ios-rtsp.md](research/ios-rtsp.md).

## Bridge on the network

On the computer with the sources:

```bash
npm start -- --host 0.0.0.0                  # from the repo
open --env LZS_HOST=0.0.0.0 -a "LZ Scopes"   # desktop app on the Mac
```

When the bridge listens on more than 127.0.0.1, it announces itself via Bonjour as `_lz-scopes._tcp` (`LZS_BONJOUR=0` turns this off). In the app: Settings → Bridge → “Find bridge on the network”. If the field is empty and there is exactly one bridge, the app fills it in itself. Otherwise enter the address by hand; `192.168.1.20` is enough (port 4192 and `ws://` are added).

Caution: any computer on the network can then open streams through the bridge, including the cameras and capture devices of that computer. Use only in trusted networks. Control, meters and PTP stay limited to the computer itself.

## Building

Requirement: a Mac with Xcode 26 or later (Capacitor 8).

```bash
npm ci
npm run ios:sync      # vite build + cap sync ios
npm run ios:open      # opens ios/App/App.xcodeproj in Xcode
```

In Xcode choose the target “App”, a simulator or a connected device, then Run. For your own device, choose the team under Signing & Capabilities. With a free Apple account this works only for your own devices, and the app then runs for only a few days.

CI: `.github/workflows/ios.yml` builds on `macos-26` without signing for the simulator. It then starts an iPhone and an iPad simulator next to a bridge on the runner and uploads screenshots and the console log. The log contains the line `[lzs-ios] … WebGL2 …` with the float extensions of the WebView.

## Signing and TestFlight: what is needed

This costs money and is therefore the owner's decision. Recommendation: TestFlight.

1. **Apple Developer Program** (USD 99 per year, developer.apple.com/programs), as an individual or as a company. A company needs a D-U-N-S number and then appears as the seller in the store.
2. **Team ID** (10 characters, under Membership). Choose the team in Xcode under Signing & Capabilities. For CI it goes into the repo as the secret `APPLE_TEAM_ID`.
3. Register the **App ID** `de.zumpelars.lzscopes` and create the app “LZ Scopes” in App Store Connect (platform iOS, one build for iPhone and iPad).
4. **Signing in CI.** Recommended is an App Store Connect API key (Users and Access → Integrations → Team Keys, role “App Manager”). Xcode then signs automatically (`-allowProvisioningUpdates` with `-authenticationKeyPath/-ID/-IssuerID`); nobody has to maintain certificates and profiles by hand. Secrets:
   - `ASC_KEY_ID`, `ASC_ISSUER_ID`
   - `ASC_KEY_P8` (content of the .p8 file, Base64)
   - `APPLE_TEAM_ID`

   Alternative: distribution certificate as .p12 plus provisioning profile as secrets (`IOS_DIST_P12`, `IOS_DIST_P12_PASSWORD`, `IOS_PROFILE`).
5. **Upload** with `xcodebuild archive`, then `-exportArchive` (method App Store Connect, destination upload). Then invite the testers in TestFlight.

The upload workflow has not been built yet, because without an account and secrets there is nothing to test. Steps 4 and 5 are therefore untested. With the secrets it can be added following the pattern of `release.yml`, triggered by an `ios-v*` tag.

Also needed before the App Store: privacy details (camera, microphone, Bluetooth, local network; no data is collected), screenshots from real devices and a support URL.
