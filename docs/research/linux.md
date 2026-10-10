# Linux desktop app (Stand 10.10.2026)

Entscheidungen und Belege für den Linux-Build (AppImage + deb, x64 und arm64). Nur Quellen, die geöffnet wurden.

## Paket

- **Ziele:** AppImage und deb für x64 und arm64. Dateinamen ohne Leerzeichen (`lz-scopes-<version>-x86_64.AppImage`, `lz-scopes-<version>-amd64.deb`, `lz-scopes-<version>-arm64.AppImage`, `lz-scopes-<version>-arm64.deb`): GitHub ersetzt Leerzeichen in Asset-Namen durch Punkte, `latest-linux.yml` behält den Namen von electron-builder (bei macOS/Windows sichtbar: Asset `LZ.Scopes-1.5.0-universal.zip`, Feed `LZ-Scopes-1.5.0-universal.zip`). Der AppImage-Updater braucht beide gleich.
- **arm64 (Raspberry Pi 5, Jetson):** eigener Runner `ubuntu-22.04-arm` (kostenlos für öffentliche Repos), kein Cross-Build: ffmpeg (`linux-arm64` in `scripts/ffmpeg-builds.json`), die Helfer (g++ des Runners) und die serialport-Prebuilds müssen zur Paket-Architektur passen. `electron-builder.js` nennt deshalb keine Arch im `linux.target` (eine Arch dort baut electron-builder *zusätzlich* zu `--x64`/`--arm64`), `extraResources` nimmt `vendor/ffmpeg/linux-${arch}`, und `beforePack` bricht ab, wenn ffmpeg oder ein Helfer eine andere ELF-Maschine hat. Ubuntu 22.04 statt 24.04 wegen glibc 2.35: Raspberry Pi OS 12 (Bookworm) hat 2.36, JetPack 6 basiert auf Ubuntu 22.04. Update-Feed `latest-linux-arm64.yml` (electron-updater wählt ihn selbst). Ungeprüft auf echter Hardware, auch Raspberry Pi OS mit 16-KB-Seiten-Kernel (Pi 5).
- **Desktop-Eintrag:** Hauptkategorie `AudioVideo`, Zusatz `Video` (freedesktop Menu Spec), Name/Kommentar EN+DE.
- **Packfalle:** `extraMetadata.type = 'commonjs'` gilt für alle Plattformen; die CI prüft das gepackte `package.json` im asar.
- **Sandbox:** Das deb installiert nach `/opt/LZ Scopes` samt AppArmor-Profil (electron-builder `templates/linux/after-install.tpl`, Ubuntu 24+). Ein AppImage kann `chrome-sandbox` nicht SUID setzen; unter Ubuntu 24.04 (AppArmor sperrt unprivilegierte User-Namespaces) startet es dann nur mit `--no-sandbox`. Deshalb empfiehlt die README das deb; CI startet beide (AppImage mit `--no-sandbox --appimage-extract-and-run`, deb mit Sandbox).

## ffmpeg

Eigener Build `ffmpeg-9.0.2-lzs2` (`scripts/ffmpeg-build/build.sh`, `.github/workflows/ffmpeg-build.yml`):
- **linux-x64** auf `ubuntu-24.04`: dynamisch gegen glibc (höchstes Symbol `GLIBC_2.38`) und libstdc++ (GCC 13) → Ubuntu 24.04, Debian 13, Fedora 39 oder neuer.
- **linux-arm64** auf `ubuntu-22.04-arm` mit GCC 12 (GCC 11 kennt `-march=armv9-a` der SVE2-Teile von x265 nicht): glibc 2.35, libstdc++ des Systems → Ubuntu 22.04, JetPack 6, Raspberry Pi OS 12 oder neuer. Der Runner (Neoverse) kann SVE2, Pi 5 (Cortex-A76) und Jetson Orin (Cortex-A78AE) nicht; x265 und FFmpeg wählen ihre ARM-Routinen zur Laufzeit. Die CI kodiert deshalb x264, x265 10 bit und v210 einmal unter `qemu-aarch64 -cpu cortex-a76`; das QEMU 6.2 von Ubuntu 22.04 kennt dieses Modell nicht und nimmt `cortex-a72` (ARMv8.0, Teilmenge der A76). Damit ist gezeigt, dass das Binary ohne SVE/SVE2 und ohne ARMv8.2-Erweiterungen läuft; die Routinen, die x265/FFmpeg erst auf einer A76 wählen (z. B. dotprod), bleiben ungeprüft.
- **Eingabegeräte:** `video4linux2,v4l2`, `fbdev` und `alsa`. ALSA ist trotz `--disable-autodetect` ausdrücklich eingeschaltet (`--enable-alsa`) und dynamisch gegen die `libasound.so.2` des Systems gelinkt (LGPL-2.1; Electron braucht sie ohnehin, das deb hängt von ihr ab). Kein PulseAudio (`--enable-libpulse` wäre eine weitere harte Abhängigkeit, PipeWire/PulseAudio erreichen ALSA-Programme über ihr ALSA-Plugin), kein x11grab.
- **Bridge:** bietet nur Geräte an, die ihr ffmpeg öffnen kann (`ffmpeg -devices`, `server/index.mjs`): v4l2-Video aus `/dev/video*`, ALSA-Aufnahmegeräte aus `/proc/asound/pcm` als `audio:alsa:hw:<Karte>,<Gerät>` mit allen Kanälen (`#ch=<n>`). Ein `hw:`-Gerät, das PipeWire oder PulseAudio gerade belegt, meldet „Device or resource busy“. Daneben gibt es Ton über Chromium (`getUserMedia`, PulseAudio/PipeWire, höchstens 2 Kanäle).
- **Geprüft in CI:** `ffmpeg -devices` listet `alsa` (ffmpeg-build.yml, ci.yml, release.yml, test/ffmpeg.test.ts); ci.yml nimmt mit dem mitgelieferten ffmpeg 8 Kanäle über alsa-lib vom `null`-Gerät auf (x64 und arm64). Die Runner-Kernel haben kein `snd-aloop`, also keine Soundkarte und kein `/proc/asound/pcm`: Dass die Bridge ein echtes Gerät als `audio:alsa:` anbietet, prüft `scripts/linux-smoke.sh` nur, wo eine Soundkarte da ist – auf den Runnern nicht; dort abgedeckt sind `-devices`-Auswertung und `/proc/asound/pcm`-Parser als Unit-Tests. Mit echter Soundkarte ungeprüft.

## Bildschirmaufnahme

Unter Wayland liefert Chromium Bildschirm und Fenster über xdg-desktop-portal/PipeWire; der Schalter `--enable-features=WebRTCPipeWireCapturer` wird gesetzt (auf aktuellen Chromium Standard, unter X11 wirkungslos). Unter Wayland zeigt das Portal einen eigenen Auswahldialog; die Vorschauliste der App kann dort weniger zeigen als unter X11. Ungeprüft auf echter Hardware.

## Web Bluetooth (Opple Light Master)

WebBluetoothCG, implementation-status.md: Linux „partially implemented and not supported“, braucht Kernel 3.19+ und BlueZ 5.41+; in Chrome nur mit Flag. In Chromium ist das Blink-Feature `WebBluetooth` außerhalb von Android/ChromeOS/Mac/Windows „experimental“; die App schaltet unter Linux nur dieses Feature ein (`--enable-blink-features=WebBluetooth`). Die UI sagt unter Linux, dass es nur teilweise geht und ungeprüft ist.
- <https://github.com/WebBluetoothCG/web-bluetooth/blob/main/implementation-status.md>

## Display-Profil (#17)

colord über `colormgr` (Ausgabeformat aus `client/cd-util.c`: `Label:`-Zeilen, `Profile n:` mit Dateiname in der Folgezeile, Profil 1 = Standard; Beschriftungen übersetzt, daher `LANG=C`). Ablauf: `find-profile-by-filename` bzw. `import-profile`, `device-add-profile`, `device-make-profile-default`; Zurück: vorheriges Profil wieder Standard, sonst `device-remove-profile`. Wirkt nur, wo der Desktop colord-Profile anwendet (GNOME/mutter; X11-Desktops mit xiccd), nicht unter KDE Plasma 6. Ohne `colormgr` meldet die App „nicht verfügbar“. **Ungeprüft** (kein Linux-Rechner mit Monitor); Parser mit Unit-Test.
- <https://github.com/hughsie/colord/blob/main/client/cd-util.c>

## Update

`electron-updater` nur im AppImage (`APPIMAGE` gesetzt): einmal nach dem Start prüfen, im Hintergrund laden, beim Beenden installieren, Systembenachrichtigung EN/DE. deb, macOS (ad-hoc signiert, Squirrel.Mac lehnt das ab) und Windows bleiben beim manuellen Download. Erst mit dem übernächsten Release (AppImage 1.6.0 → neuere Version) wirklich prüfbar.

## Geräte

- v4l2: `/dev/video*` lesbar für die Gruppe `video`; ALSA `/dev/snd/*` für `audio`. Nutzer ggf. `sudo usermod -aG video,audio $USER`.
- DeckLink: Helfer gegen `/Linux/include` des SDK (gleicher Fetch/Hash wie Mac/Win), unter x64 und arm64 gebaut und ohne Treiber gestartet; Treiber Desktop Video vom Nutzer (bringt eigene udev-Regeln). Desktop Video gibt es seit 12.4 auch für AArch64 (Linux 5.10+); Blackmagic nennt als getestete ARM-Plattformen nur Jetson AGX Xavier und Clara AGX, nicht Jetson Orin oder Raspberry Pi 5 (dort nur über einen PCIe-Adapter am M.2/FFC-Anschluss denkbar). Ohne Hardware ungeprüft.
  - <https://www.blackmagicdesign.com/support/content/readme/1fc57acbb3f44c05bea7b8cbdf79f6aa>
- NDI: Helfer lädt `libndi.so.6` (`$NDI_RUNTIME_DIR_V6`, `/usr/lib`, `/usr/local/lib`, `/usr/lib/x86_64-linux-gnu` bzw. unter arm64 `/usr/lib/aarch64-linux-gnu`). Ohne Runtime meldet `--list` den Fehler.
