# lz-ndi – NDI®-Helfer

Empfängt eine NDI®-Quelle und schreibt die Bilder im Helfer-Protokoll (`docs/frame-protocol.de.md`) auf stdout. Die Bridge startet ihn für Quellen `ndi:<Quellenname>`.

- **NDI-Runtime vom Nutzer:** Der Helfer lädt die Runtime zur Laufzeit (`$NDI_RUNTIME_DIR_V6`, dann Systempfade wie `/usr/local/lib/libndi.dylib`). lz-scopes liefert nichts von NDI aus. Runtime: NDI Tools bzw. NDI-Runtime von [ndi.video](https://ndi.video/); macOS auch `brew install --cask libndi`.
- **Ohne SDK baubar:** `ndi-min.h` enthält nur die nötigen Typen und Funktionsnamen aus den NDI-SDK-Headern 6.3, die dateiweise unter MIT stehen (Text in `licenses/ndi-sdk-headers-MIT.txt`). Laut NDI-Doku dürfen Open-Source-Projekte die Header mitführen und die Bibliothek dynamisch laden.
- **Formate:** Empfang mit `NDIlib_recv_color_format_best`: 8-bit-Quellen als UYVY, Quellen mit mehr als 8 bit als P216 → `p216le`, ohne Rundung auf 8 bit. BGRA/RGBA/NV12/I420/YV12 werden ebenfalls angenommen, Alpha wird ignoriert. Bei Zeilensprung liefert die Runtime in diesem Modus laut SDK-Header einzelne Halbbilder; gemessen wird dann je Halbbild. Farbmetadaten liefert NDI hier nicht; die Bridge nimmt BT.709 über SD an (Matrix in der Karte fest einstellbar). Kein Ton.

```sh
npm run build:helpers            # baut lz-ndi (und DeckLink, falls DECKLINK_SDK_DIR gesetzt)
helpers/bin/lz-ndi --list        # {"ok":true,"runtime":true,"version":"…","sources":[…]}
helpers/bin/lz-ndi --send-test "LZ Test" 30   # Testsender: P216, links Y′ 940, rechts 502
```

**Geprüft (30.09.2026, macOS, Runtime 6.3.2 aus dem libndi-Paket, nur entpackt, nicht installiert):** Suche, Empfang und Bridge über den eigenen Testsender auf demselben Rechner (Loopback): 320×180 P216, 25 fps, 16 bit bis in den Browser-Datenstrom. **Nicht geprüft:** echte Kameras/Mischer im Netz, NDI HX, Windows und Linux.

NDI® is a registered trademark of Vizrt NDI AB.
