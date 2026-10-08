# Linux desktop app (Stand 08.10.2026)

Entscheidungen und Belege für den Linux-Build (AppImage + deb, x64). Nur Quellen, die geöffnet wurden.

## Paket

- **Ziele:** AppImage und deb, nur x64. Dateinamen ohne Leerzeichen (`lz-scopes-<version>-x86_64.AppImage`, `lz-scopes-<version>-amd64.deb`): GitHub ersetzt Leerzeichen in Asset-Namen durch Punkte, `latest-linux.yml` behält den Namen von electron-builder (bei macOS/Windows sichtbar: Asset `LZ.Scopes-1.5.0-universal.zip`, Feed `LZ-Scopes-1.5.0-universal.zip`). Der AppImage-Updater braucht beide gleich.
- **arm64 (Raspberry Pi 5, Jetson): nicht gebaut.** Es gibt kein `linux-arm64` im eigenen ffmpeg-Build (`scripts/ffmpeg-builds.json`); das hieße neuer Build-Lauf und neues ffmpeg-Release. Die Helfer (g++, `dlopen`) wären portabel, die NDI-Pfade kennen nur `x86_64-linux-gnu`. `beforePack` bricht ab, falls doch arm64 verlangt wird. Eigenes Issue.
- **Desktop-Eintrag:** Hauptkategorie `AudioVideo`, Zusatz `Video` (freedesktop Menu Spec), Name/Kommentar EN+DE.
- **Packfalle:** `extraMetadata.type = 'commonjs'` gilt für alle Plattformen; die CI prüft das gepackte `package.json` im asar.
- **Sandbox:** Das deb installiert nach `/opt/LZ Scopes` samt AppArmor-Profil (electron-builder `templates/linux/after-install.tpl`, Ubuntu 24+). Ein AppImage kann `chrome-sandbox` nicht SUID setzen; unter Ubuntu 24.04 (AppArmor sperrt unprivilegierte User-Namespaces) startet es dann nur mit `--no-sandbox`. Deshalb empfiehlt die README das deb; CI startet beide (AppImage mit `--no-sandbox --appimage-extract-and-run`, deb mit Sandbox).

## ffmpeg

Eigener Build `ffmpeg-9.0.2-lzs1` linux-x64, am Binary geprüft (`strings`):
- dynamisch gegen glibc (höchstes Symbol `GLIBC_2.38`) und libstdc++ (`GLIBCXX_3.4.32`, GCC 13) → Ubuntu 24.04, Debian 13, Fedora 39 oder neuer.
- Eingabegeräte: `video4linux2,v4l2`, `fbdev`. **Kein ALSA**, kein PulseAudio, kein x11grab: `build.sh` baut mit `--disable-autodetect`, ALSA ist eine Autodetect-Bibliothek.
- Folge: Die Bridge bietet unter Linux nur noch Geräte an, die ihr ffmpeg öffnen kann (`ffmpeg -devices`, `server/index.mjs`). v4l2-Video geht über die Bridge; Ton kommt über Chromium (`getUserMedia`, PulseAudio/PipeWire, höchstens 2 Kanäle). Mehrkanal-ALSA über die Bridge braucht ein ffmpeg mit `--enable-alsa` (neuer Build, eigenes Issue) oder `$FFMPEG` auf ein System-ffmpeg.

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
- DeckLink: Helfer gegen `/Linux/include` des SDK (gleicher Fetch/Hash wie Mac/Win); Treiber Desktop Video vom Nutzer (bringt eigene udev-Regeln). Ohne Hardware ungeprüft.
- NDI: Helfer lädt `libndi.so.6` (`$NDI_RUNTIME_DIR_V6`, `/usr/lib`, `/usr/local/lib`, `/usr/lib/x86_64-linux-gnu`). Ohne Runtime meldet `--list` den Fehler.
