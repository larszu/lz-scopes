# ffmpeg in der Desktop-App: weitergebbarer Build (Recherche 30.09.2026)

## Ausgangslage

Bis v0.1.0 bündelte die App `ffmpeg-static` 5.3.0 (Release `b6.1.1`). Geprüft wurden alle fünf Binaries dieses Releases (Konfigurationszeile im Binary, `ffmpeg -L`):

| Binary | Konfiguration | weitergebbar |
|---|---|---|
| darwin-arm64 | `--enable-gpl --enable-version3 --enable-nonfree` (x264, x265, kein SRT); `-L`: „has nonfree parts compiled in … not legally redistributable“ | **nein** |
| darwin-x64 | `--enable-gpl --enable-version3`, kein SRT | ja (GPLv3) |
| win32-x64 | `--enable-gpl --enable-version3 --enable-libsrt` | ja (GPLv3) |
| linux-x64, linux-arm64 | `--enable-gpl --enable-version3 --enable-libsrt` | ja (GPLv3) |

Weil `scripts/ffmpeg-universal.mjs` das arm64-Binary in das Universal-Binary einbaute, war **jeder** macOS-Installer betroffen. Ein nonfree-Build darf gar nicht weitergegeben werden (FFmpeg `LICENSE.md`: „the resulting binaries will be unredistributable“).

## Was die Bridge braucht

Aus `server/*.mjs`: rawvideo, Decoder H.264/HEVC/ProRes/MJPEG, `libx264` (H.264-Push, WebCodecs-Weg `server/flv.mjs`), `libx265` mit 10 bit 4:2:0 und 4:2:2 (`out10.mjs`), `prores_ks`, `v210`, NUT/MPEG-TS/FLV/RTSP, `srt` (libsrt), avfoundation/dshow/v4l2/alsa, lavfi, Filter `scale`, `showinfo`, `fps`, PCM/AAC. `libx264`/`libx265` sind GPL – ein LGPL-Build reicht also nicht (die LGPL-Varianten von BtbN haben weder x264 noch x265). **Gebraucht wird ein GPL-Build ohne nonfree.**

## Geprüfte Quellen

| Quelle | Plattform | Ergebnis |
|---|---|---|
| Martin Riedl, ffmpeg.martin-riedl.de, Release 9.0.2 (arm64 `1789931890_9.0.2`, amd64 `1789931006_9.0.2`) | macOS | `--enable-gpl --enable-version3`, **kein nonfree**, libsrt 1.5.7, x264, x265 4.2 (8/10/12 bit), OpenSSL 3.6.4; statisch, nur Systemframeworks; minos 12.0; SHA-256-Dateien liegen daneben. Build-Skript Apache-2.0, öffentlich; Commit `6a611e1` (develop, 20.09.2026) passt zu `versions.txt` (fribidi 1.0.16, srt 1.5.7). Gemessen: libx265 yuv420p10le/yuv422p10le, prores_ks, v210/NUT, x264/FLV, MJPEG, AAC, Protokoll srt, avfoundation – arm64 nativ, x64 unter Rosetta. |
| Martin Riedl, Linux amd64 9.0.2 | Linux | **`--enable-nonfree`** – nicht verwendet |
| BtbN/FFmpeg-Builds, `autobuild-2026-09-30-13-08`, `n9.0.2-17-g2a571b6068` win64-gpl(-shared) | Windows | `--enable-gpl --enable-version3`, **kein nonfree**, libsrt, x264, x265; Skripte MIT, alle Abhängigkeiten per Commit gepinnt (Repo-Stand `6c9aec5`); Monatsend-Builds bleiben erhalten (Release-Liste reicht bis `autobuild-2024-10-31`), Tagesbuilds werden nach rund zwei Wochen gelöscht. GitHub liefert SHA-256 je Asset. |
| BtbN linux64-gpl, gleiches Autobuild | Linux | wie oben, nur für CI/Tests |
| Gyan.dev 9.0.2 essentials (GyanD/codexffmpeg, dauerhafte Releases) | Windows | GPLv3, kein nonfree, libsrt – aber die Build-Skripte sind nicht öffentlich, „Source Code“ verweist nur auf den FFmpeg-Commit. Deshalb BtbN. |
| evermeet.cx / osxexperts | macOS | aus `ffmpeg-static`-Binaries abgeleitet: x64 ohne nonfree, arm64 **mit** nonfree; kein SRT. Nicht verwendet. |
| Homebrew-Bottle | macOS | dynamisch gelinkt gegen Dutzende Homebrew-Dylibs unter `/opt/homebrew`, nicht verschiebbar – für ein App-Bundle ungeeignet. |
| Eigener Build in CI | beide | sauberste Lösung (nur ffmpeg + x264 + x265 + srt + TLS, kleiner, exakte Quellen), aber eigener Pflegeaufwand. Offen, siehe unten. |

Die Builds stehen mit URL, Version und SHA-256 in `scripts/ffmpeg-builds.json`; `scripts/ffmpeg-fetch.mjs` lädt sie, prüft die Prüfsummen und bricht ab, wenn die Konfigurationszeile `--enable-nonfree` enthält oder libsrt/x264/x265 fehlen. Größe: Universal-ffmpeg und -ffprobe je 161 MB (gzip je ~62 MB), Windows shared (ffmpeg, ffprobe, DLLs) 190 MB (gzip ~75 MB). Ein lokal gebautes macOS-DMG (Universal, mit ffmpeg + ffprobe) hat 371 MB.

## Pflichten bei der Weitergabe (GPLv3, LGPL, MPL-2.0, Apache-2.0)

- **Lizenztexte beilegen:** GPLv3 §4/§6; die Texte liegen in `licenses/ffmpeg/` (GPL-2.0/3.0, LGPL-2.1/3.0, FFmpeg `LICENSE.md` aus dem 9.0.2-Tarball, MPL-2.0 aus libsrt v1.5.7, Apache-2.0 für OpenSSL) und gehen nach `<resources>/ffmpeg/licenses/`.
- **Quelltext:** GPLv3 §6 d) – bei Download-Weitergabe gleichwertiger Zugang zum „Corresponding Source“ am selben Ort. `release.yml` (Job `sources`) hängt an jedes Release: FFmpeg 9.0.2-Tarball (SHA-256 gepinnt), FFmpeg-Commit `2a571b6068` (Windows), BtbN-Skripte `6c9aec5`, Martin-Riedl-Skript `6a611e1`. Die Skripte nennen jede Bibliothek mit Version bzw. Commit und Download-URL.
- **MPL-2.0 (libsrt):** Quelltext der MPL-Dateien zugänglich machen und auf die Lizenz hinweisen (§3.2) – über die Skripte/Versionen oben und `MPL-2.0-srt.txt`.
- **Nur über die Kommandozeile:** LZ Scopes startet ffmpeg als eigenen Prozess (Pipe/argv) und linkt es nicht; die Pflichten oben gelten für die mitgelieferten ffmpeg-Dateien. (Ob das als bloße Zusammenstellung gilt, wurde hier nicht rechtlich geprüft.)

## Offen / Entscheidung für Lars

1. **Volle Quell-Spiegelung der Bibliotheken.** Hinterlegt sind FFmpeg selbst und die Build-Skripte (mit Versionen/Commits und Upstream-URLs). Die einzelnen Bibliotheks-Tarballs werden nicht mitgespiegelt; Martin Riedls Skript lädt x264 als `master`-Tarball, die exakte x264-Revision ist nur als „0.165.x“ bekannt. Strikt genommen verlangt §6 d), dass der Weitergebende die Verfügbarkeit sicherstellt. Abhilfe: **eigener minimaler Build in CI** (macOS universal + Windows, nur ffmpeg/x264/x265/srt/TLS), Quell-Tarballs als Release-Assets – kleiner (geschätzt ¼ der Größe) und lückenlos.
2. **ffprobe auf macOS** kostet ~62 MB im DMG. Ohne ffprobe liest die Bridge Größe/Farbe aus dem ffmpeg-Banner (wie mit ffmpeg-static); Container-Timecode fiele weg.

## Quellen (geöffnet)

- ffmpeg-static `b6.1.1`-Binaries (github.com/eugeneware/ffmpeg-static/releases), Konfigurationszeilen selbst ausgelesen
- https://ffmpeg.martin-riedl.de/ (Downloads, `.sha256`, `versions.txt`), https://git.martin-riedl.de/ffmpeg/build-script (README, `build.sh`, `version/*`, Commits `develop`)
- https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-30-13-08 (Assets, Digests, `LICENSE.txt`), Release-Liste per GitHub-API
- https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2 (`README.txt`)
- FFmpeg 9.0.2-Tarball: `LICENSE.md`, `COPYING.*`; libsrt v1.5.7 `LICENSE`; https://www.apache.org/licenses/LICENSE-2.0.txt
