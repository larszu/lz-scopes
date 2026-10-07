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
| evermeet.cx / osxexperts | macOS | Seiten nicht geöffnet. Die macOS-Binaries von ffmpeg-static (oben) zeigen: x64 ohne nonfree, arm64 **mit** nonfree, beide ohne SRT. Nicht verwendet. |
| Homebrew-Bottle | macOS | dynamisch gelinkt gegen Dutzende Homebrew-Dylibs unter `/opt/homebrew`, nicht verschiebbar – für ein App-Bundle ungeeignet. |
| Eigener Build in CI | beide | sauberste Lösung (nur ffmpeg + x264 + x265 + srt + TLS, kleiner, exakte Quellen), aber eigener Pflegeaufwand. Offen, siehe unten. |

Die Builds stehen mit URL, Version und SHA-256 in `scripts/ffmpeg-builds.json`; `scripts/ffmpeg-fetch.mjs` lädt sie, prüft die Prüfsummen und bricht ab, wenn die Konfigurationszeile `--enable-nonfree` enthält oder libsrt/x264/x265 fehlen. Größe: Universal-ffmpeg und -ffprobe je 161 MB (gzip je ~62 MB), Windows shared (ffmpeg, ffprobe, DLLs) 190 MB (gzip ~75 MB). Ein lokal gebautes macOS-DMG (Universal, mit ffmpeg + ffprobe) hat 371 MB.

## Pflichten bei der Weitergabe (GPLv3, LGPL, MPL-2.0, Apache-2.0)

- **Lizenztexte beilegen:** GPLv3 §4/§6; die Texte liegen in `licenses/ffmpeg/` (GPL-2.0/3.0, LGPL-2.1/3.0, FFmpeg `LICENSE.md` aus dem 9.0.2-Tarball, MPL-2.0 aus libsrt v1.5.7, Apache-2.0 für OpenSSL) und gehen nach `<resources>/ffmpeg/licenses/`.
- **Quelltext:** GPLv3 §6 d) – bei Download-Weitergabe gleichwertiger Zugang zum „Corresponding Source“ am selben Ort. `release.yml` (Job `sources`) hängt an jedes Release: FFmpeg 9.0.2-Tarball (SHA-256 gepinnt), FFmpeg-Commit `2a571b6068` (Windows), BtbN-Skripte `6c9aec5`, Martin-Riedl-Skript `6a611e1`. Die Skripte nennen jede Bibliothek mit Version bzw. Commit und Download-URL.
- **MPL-2.0 (libsrt):** Quelltext der MPL-Dateien zugänglich machen und auf die Lizenz hinweisen (§3.2) – über die Skripte/Versionen oben und `MPL-2.0-srt.txt`.
- **Nur über die Kommandozeile:** LZ Scopes startet ffmpeg als eigenen Prozess (Pipe/argv) und linkt es nicht; die Pflichten oben gelten für die mitgelieferten ffmpeg-Dateien. (Ob das als bloße Zusammenstellung gilt, wurde hier nicht rechtlich geprüft.)

## Eigener Build (ab 07.10.2026)

Mit den Fremd-Builds blieb eine Lücke: Die Bibliotheks-Tarballs wurden nicht mitgespiegelt, und bei Martin Riedl war die x264-Revision nur als „0.165.x“ bekannt. Diese Lücke aus §6 d) ist geschlossen. Die App liefert jetzt einen eigenen, minimalen Build aus.
- **Inhalt:** FFmpeg 9.0.2, x264 (stable, b35605a), x265 4.2, libsrt 1.5.7, mbedTLS 3.6.7 und zlib 1.3.2. Alles ist statisch gelinkt, mit `--disable-autodetect`. x265 ist nur mit 10 bit gebaut; mehr braucht der 10-bit-Stream nicht. Auf macOS kommen nur Systemframeworks sowie `libc++` und `libbz2` aus `/usr/lib` hinzu.
- **Herkunft:** `scripts/ffmpeg-build/` mit `sources.txt`. Jedes Archiv ist per SHA-256 festgelegt. x264 kommt über seinen Commit-Hash, weil die GitLab-Archive nicht bytegleich sind; die CI hat beim selben Commit eine andere Prüfsumme gemessen.
- **Gebaut und geprüft** in `.github/workflows/ffmpeg-build.yml`: jedes Ziel auf seinem eigenen OS, mit test/ffmpeg.test.ts und test/out10.test.ts. Geprüft werden Lizenz, SRT, v210 bit-exakt sowie HEVC Main 10 über TCP und SRT.
- **Veröffentlicht** als Pre-Release `ffmpeg-9.0.2-lzs1`, zusammen mit allen Quellarchiven, `build.sh` und `sources.txt`. Jedes App-Release hängt dieselben Archive an.
- **Größe** (lokal gemessen, darwin-arm64): ffmpeg und ffprobe je 28 MB; der Build von Martin Riedl hatte je 66 MB.
- **ffprobe** wird weiter mitgeliefert, weil der Container-Timecode davon abhängt.
- **Windows:** mingw-w64 winpthreads (MIT, Lizenztext in licenses/ffmpeg/) und die GCC-Laufzeit (Runtime Library Exception) sind statisch gelinkt.

## Quellen (geöffnet)

- ffmpeg-static `b6.1.1`-Binaries (github.com/eugeneware/ffmpeg-static/releases), Konfigurationszeilen selbst ausgelesen
- https://ffmpeg.martin-riedl.de/ (Downloads, `.sha256`, `versions.txt`), https://git.martin-riedl.de/ffmpeg/build-script (README, `build.sh`, `version/*`, Commits `develop`)
- https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-30-13-08 (Assets, Digests, `LICENSE.txt`), Release-Liste per GitHub-API
- https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2 (`README.txt`)
- FFmpeg 9.0.2-Tarball: `LICENSE.md`, `COPYING.*`; libsrt v1.5.7 `LICENSE`; https://www.apache.org/licenses/LICENSE-2.0.txt
