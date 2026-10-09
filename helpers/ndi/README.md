# lz-ndi – NDI®-Helfer

Empfängt eine NDI®-Quelle und schreibt die Bilder im Helfer-Protokoll (`docs/frame-protocol.de.md`) auf stdout. Die Bridge startet ihn für Quellen `ndi:<Quellenname>`.

- **NDI-Runtime vom Nutzer:** Der Helfer lädt die Runtime zur Laufzeit (`$NDI_RUNTIME_DIR_V6`, dann Systempfade wie `/usr/local/lib/libndi.dylib`). lz-scopes liefert nichts von NDI aus. Runtime: NDI Tools bzw. NDI-Runtime von [ndi.video](https://ndi.video/); macOS auch `brew install --cask libndi`.
- **Ohne SDK baubar:** `ndi-min.h` enthält nur die nötigen Typen und Funktionsnamen aus den NDI-SDK-Headern 6.3, die dateiweise unter MIT stehen (Text in `licenses/ndi-sdk-headers-MIT.txt`). Laut NDI-Doku dürfen Open-Source-Projekte die Header mitführen und die Bibliothek dynamisch laden.
- **Formate und Bittiefe:** Die Bittiefe der Quelle steuert das NDI-Farbformat. Bei 16 bit kommt `NDIlib_recv_color_format_best`: 10-bit-Quellen als P216 → `p216le`, ohne Rundung auf 8 bit. Bei 8 bit kommt `_fastest`: UYVY, die halbe Datenmenge. BGRA/RGBA/NV12/I420/YV12 werden ebenfalls angenommen, Alpha wird ignoriert. Bei Zeilensprung liefert die Runtime laut SDK-Header einzelne Halbbilder; gemessen wird dann je Halbbild. Farbmetadaten liefert NDI hier nicht; die Bridge nimmt BT.709 über SD an (Matrix in der Karte fest einstellbar). Kein Ton.
- **Verkleinern im Helfer:** `--width N` (die Analysebreite der Quelle) mittelt UYVY und P216 per Box-Filter um einen ganzzahligen Faktor, solange das Bild mindestens N breit bleibt; ffmpeg skaliert den Rest. Gemittelt wird in Y′CbCr, Matrix und Range bleiben unverändert. 1080p bei 960 px: ein Viertel der Bytes durch alle Pipes.
- **Zwei Threads:** Ein Thread empfängt (`recv_capture_v3`, 100 ms Timeout), der Hauptthread schreibt. Liest die Bridge langsamer, als NDI liefert, wartet nur das neueste Bild; ältere zählt der Helfer als übersprungen. NDIs eigene Warteschlange bleibt dadurch leer.
- **Zähler:** Etwa einmal pro Sekunde meldet der Helfer `ndi.stats` (empfangene und von NDI verworfene Bilder, übersprungene, Warteschlange, Verbindungen). Die Bridge zählt Verluste in `dropped`, gibt die Zahlen als `helper` im `stats`-Datensatz weiter und zeigt in der Quellkarte einen Hinweis, solange Bilder verloren gehen oder die Quelle nicht verbunden ist.

**Windows:**
- Die Runtime v6 liegt unter `C:\Program Files\NDI\NDI 6 Runtime\v6`, gefunden über `NDI_RUNTIME_DIR_V6` ([ndi.link/NDIRedistV6](https://ndi.link/NDIRedistV6)). Nach der Installation LZ Scopes neu starten, sonst sieht die App die Variable nicht. Reste älterer Runtimes verursachen Ladefehler; dann sauber deinstallieren und neu installieren.
- Die Quellensuche läuft über mDNS (224.0.0.251:5353). Netzwerkprofil „Öffentlich“ blockiert sie: auf „Privat“ stellen und `lz-ndi.exe` in der Firewall freigeben. Quellen in einem anderen Subnetz im NDI Access Manager eintragen.
- „NDI Webcam Input“ stellt eine NDI-Quelle als Windows-Kamera bereit. Darüber läuft das Bild als Kamera-Quelle, nicht über diesen Helfer.

```sh
npm run build:helpers            # baut lz-ndi (und DeckLink, falls DECKLINK_SDK_DIR gesetzt)
helpers/bin/lz-ndi --list        # {"ok":true,"runtime":true,"version":"…","sources":[…]}
helpers/bin/lz-ndi --send-test "LZ Test" 30 1920x1080   # Testsender: P216, links Y′ 940, rechts 502
helpers/bin/lz-ndi --capture "<Name>" --depth 8 --width 960   # Helfer-Protokoll auf stdout
helpers/bin/lz-ndi --selftest     # prüft die Box-Filter-Mittelung ohne NDI ({"ok":true})
```

**Geprüft (09.10.2026, macOS, Runtime 6.3.2 aus dem libndi-Paket, nur entpackt):** Loopback mit dem eigenen Testsender in 1920×1080 P216, 25 fps, gemessen am Helfer-Ausgang:

| Einstellung | Bild am Ausgang | fps | Datenrate |
|---|---|---|---|
| `--depth 16 --width 0` | 1920×1080 P216 | 25 | 208 MB/s |
| `--depth 16 --width 960` | 960×540 P216 | 25 | 52 MB/s |
| `--depth 8 --width 960` | 960×540 UYVY | 25 | 26 MB/s |

Werte nach der Mittelung exakt (Y′ 940/502 bzw. 235/125 bei 8 bit, Cb/Cr 512). Hält der Leser 3 s an, empfängt der Helfer weiter (99 Bilder, 73 übersprungen, 0 von NDI verworfen) und liefert danach sofort wieder 25 fps. **Nicht geprüft:** echte Kameras/Mischer im Netz, NDI HX, Windows und Linux mit echter Quelle.

NDI® is a registered trademark of Vizrt NDI AB.
