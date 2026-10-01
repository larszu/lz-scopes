# Steuer-API (Bitfocus Companion, curl)

Die Bridge (`server/index.mjs`, in der Desktop-App eingebaut) nimmt Befehle an und reicht sie an das **Hauptfenster** weiter. Das Hauptfenster hält eine WebSocket-Verbindung zur Bridge (`/control?role=app`), führt die Befehle aus und meldet seinen Zustand zurück. Ohne offenes Hauptfenster antwortet die Bridge mit `503`.

| Weg | Adresse |
|---|---|
| HTTP | `POST /api/control` mit `Content-Type: application/json`, ein Befehl pro Anfrage |
| Zustand | `GET /api/control` → `{ ok, connected, state }` |
| Befehlsliste | `GET /api/control/commands` |
| WebSocket | `ws://host:port/control` – Befehle senden, Antworten und Zustand empfangen |

**Port:** Die Desktop-App nimmt 4192, wenn er frei ist, sonst einen freien Port (steht im Log: `bridge http://127.0.0.1:<port>`). `npm start` und die Bridge von `npm run dev` lauschen ebenfalls auf 4192 (im Dev-Betrieb reicht die UI auf 4191 `/control` weiter). 4190 wird bewusst nicht benutzt: Er steht auf der „bad ports“-Liste des Fetch-Standards, Chrome verweigert ihn.

## Zugriff

- Ohne Token nur von `127.0.0.1` / `::1`.
- Mit Token jeder, der es mitschickt: `Authorization: Bearer <token>` oder `?token=<token>`. Token setzen: `LZS_CONTROL_TOKEN=<token>` (Desktop-App und `npm start`) oder `--control-token <token>`. Damit Companion auf einem anderen Rechner die Bridge überhaupt erreicht, muss sie außerdem auf dem Netz lauschen: `LZS_HOST=0.0.0.0` (App) bzw. `--host 0.0.0.0`.
- Webseiten fremder Herkunft werden abgewiesen (Origin-Prüfung, nur `application/json`).

## Befehle

Jeder Befehl ist ein JSON-Objekt mit `cmd`. Panels, Quellen, Vorlagen und Szenen zählen wie in der App ab 1 oder werden mit Namen (bzw. id) angegeben.

| `cmd` | Felder |
|---|---|
| `state` | – (Antwort `result` = Zustand) |
| `source.select` | `source`; `panel` optional (ohne = alle Panels) |
| `layout.preset` | `preset`: 1–6, Kennung (`lc`) oder Beschriftung (`2x2`, `Colorist`) |
| `layout.load` | `name` einer gespeicherten Layout-Konfiguration |
| `panel.scope` | `panel`, `scope` (`picture`, `wf-luma`, `wf-color`, `wf-skin`, `wf-rgb`, `parade`, `yrgb`, `ycbcr`, `vector`, `cie`, `diamond`, `cube`, `satlum`, `chplot`, `timeline`, `hist`, `stats`, `audio-meter`, `audio-loudness`, `audio-spectrum`, `audio-phase`, `clock`) |
| `panel.maximize` | `panel`, `mode` `toggle`\|`on`\|`off`; `off` ohne `panel` = zurück |
| `freeze` | `mode` `toggle`\|`on`\|`off` |
| `roi.clear` | `source` optional (ohne = alle): Messrahmen und Messpunkt löschen |
| `pattern.select` | `pattern` (id oder Name), `source` optional (sonst erste Testbild-Quelle) |
| `pattern.next`, `pattern.prev` | `source` optional |
| `output.open` | `name`, `view` (`overlay` Standard, `grid`, `panel`, `clean`), `panel`, `source`, `scene`, `bg` `picture`\|`black`, `display` (Bildschirm-id), `fullscreen` (Standard `true`), `stream`, `target`, `codec` (10-bit-Stream: `hevc10`, `hevc422`, `v210`, `prores`; braucht `target`) |
| `output.close` | `name` optional (ohne = alle) |
| `scene.select` | `scene`; `output` optional (ohne = Vorgabe und alle offenen Overlay-Ausgaben) |
| `stream.start` | `stream` (Name → `/out/<stream>.mjpeg`), `output` optional (sonst die erste offene Ausgabe; ist keine offen, öffnet sich ein Overlay-Fenster), `target` optional (`rtmp://`, `srt://`, `rtsp://`, `udp://`, `tcp://`, `rtp://`), `codec` optional (10 bit, wie bei `output.open`; ohne MJPEG, RTMP geht dann nicht) |
| `stream.stop` | `output` oder `stream` optional (ohne = alle) |
| `transport` | `op` `play`\|`pause`\|`toggle`\|`stop`\|`next`\|`prev`\|`forward`\|`rewind`\|`start`\|`end`, `source` optional (sonst die gezeigte Videodatei) |
| `audio.reset` | `source` optional (sonst alle Quellen mit Ton): I, LRA, Max M/S, Max TP, Zähler und Protokoll zurücksetzen (EBU Tech 3341) |
| `audio.pause` | `mode` `toggle`\|`on`\|`off`, `source` optional: I und LRA anhalten/fortsetzen (Tech 3341) |
| `generator` | `mode` `toggle`\|`on`\|`off`, `signal` optional (`sine`, `ebu-ident`, `glits`, `blits`, `ebu-multi`, `ident-lr`, `pink`, `pink-band`, `white`, `sweep`, `steps`, `polarity`, `avsync`, …), `freq` 10–20000 Hz, `level` −90–0 dBFS; über −6 dBFS nur mit `"force": true` |

Antwort: `{ ok, result?, error?, state }`. Status `400` = ungültiger Befehl, `422` = nicht ausführbar (z. B. Szene unbekannt), `503` = kein Hauptfenster, `401`/`403` = Zugriff.

## Zustand (Feedbacks)

```json
{
  "source": { "index": 1, "id": "s1", "name": "Kamera 1", "status": "live" },
  "frozen": false,
  "clip": 0.4, "clipHigh": 0.4, "clipLow": 0,
  "yMin": 3.1, "yMax": 98.7,
  "layoutName": "Grading", "preset": "lc",
  "maximized": null,
  "scene": { "id": "…", "name": "Waveform unten" },
  "outputs": [{ "name": "key", "view": "overlay", "scene": "Waveform unten", "stream": "scopes" }],
  "pattern": { "id": "smpte75", "name": "SMPTE 75 % Balken + PLUGE" },
  "playing": null,
  "audio": { "source": "Kamera 1", "momentary": -22.8, "shortTerm": -23.1, "integrated": -23.0, "lra": 4.2, "maxTP": -2.1,
             "paused": false, "seconds": 312, "avOffsetMs": 12.5, "ident": "EBU-Stereo-Ident (R 49)", "identProblems": [] },
  "generator": { "running": false, "signal": "sine", "level": -18, "freq": 1000, "channels": 2 },
  "sources": [], "layouts": [], "presets": [], "panels": [], "scenes": [], "patterns": []
}
```

`clip`, `yMin`, `yMax` sind Prozent (0,1-genau) der aktiven Quelle – das ist die Quelle, die die meisten sichtbaren Panels zeigen. Ohne Statistik stehen sie auf `null`. `audio` gilt für die aktive Quelle mit Ton (sonst die erste mit Ton), Werte in LUFS/LU/dBTP auf 0,1 gerundet, `avOffsetMs` nach ITU-R BT.1359-1 (+ = Ton vor Bild), `null` ohne Messwert. `layoutName` ist die zuletzt geladene Layout-Konfiguration bzw. die Beschriftung der Vorlage.

Über WebSocket kommen `{type:"hello", connected, state, commands}` beim Verbinden, `{type:"state", state}` bei jeder Änderung (höchstens viermal pro Sekunde), `{type:"connected", connected}` wenn das Hauptfenster kommt oder geht, und `{type:"result", id, ok, result?, error?}` auf jeden Befehl (die `id` des Befehls wird zurückgegeben).

## Beispiele

```bash
B=http://127.0.0.1:4192/api/control   # Desktop-App und npm start
J='content-type: application/json'
curl -s $B | jq .state.frozen                                              # Zustand
curl -s -H "$J" -d '{"cmd":"freeze","mode":"toggle"}' $B                   # Einfrieren
curl -s -H "$J" -d '{"cmd":"source.select","source":2}' $B                 # Quelle 2 in allen Panels
curl -s -H "$J" -d '{"cmd":"source.select","source":"Kamera 1","panel":3}' $B
curl -s -H "$J" -d '{"cmd":"layout.preset","preset":"2x2"}' $B
curl -s -H "$J" -d '{"cmd":"layout.load","name":"Grading"}' $B
curl -s -H "$J" -d '{"cmd":"panel.scope","panel":2,"scope":"vector"}' $B
curl -s -H "$J" -d '{"cmd":"panel.maximize","panel":1}' $B
curl -s -H "$J" -d '{"cmd":"roi.clear"}' $B
curl -s -H "$J" -d '{"cmd":"pattern.next"}' $B
curl -s -H "$J" -d '{"cmd":"output.open","name":"key","view":"overlay","bg":"black","scene":"Studio","fullscreen":false}' $B
curl -s -H "$J" -d '{"cmd":"scene.select","scene":"Studio","output":"key"}' $B
curl -s -H "$J" -d '{"cmd":"stream.start","stream":"scopes","output":"key","target":"srt://10.0.0.5:9000"}' $B
curl -s -H "$J" -d '{"cmd":"stream.stop"}' $B
curl -s -H "$J" -d '{"cmd":"output.close"}' $B
curl -s -H "$J" -d '{"cmd":"transport","op":"next"}' $B
# mit Token von einem anderen Rechner
curl -s -H "$J" -H 'Authorization: Bearer geheim' -d '{"cmd":"freeze"}' http://studio.local:4192/api/control
```

Im Browser öffnet `output.open` ein Fenster nur, wenn Pop-ups für die Seite erlaubt sind; die Desktop-App öffnet es immer.

## Companion-Modul

`companion/` enthält das Modul `companion-module-lz-scopes` (API `@companion-module/base` ~1.14.1, wie das Modul in lz-camera-bridge) mit Aktionen für alle Befehle oben, Feedbacks (Verbunden, Eingefroren, Quelle aktiv, Clipping/Y′ über Schwelle, Layout, Szene, Ausgabe offen, Stream läuft, Panel maximiert, Videodatei läuft, Tongenerator läuft, I/LRA angehalten, Max True Peak über Schwelle, Ident-Befund), Variablen (auch Lautheit M/S/I/LRA, True Peak, A/V-Versatz, Ident) und Presets.

```bash
cd companion
npm ci
npm test            # Befehle, Zustand, Feedbacks; prüft die Befehle gegen server/control.mjs
npm run build       # → dist/
COMPANION_DEV_MODULES=~/companion-dev npm run sync   # in Companions Ordner für Entwickler-Module kopieren
```

In Companion unter *Settings → Developer modules path* den Ordner (`~/companion-dev`) eintragen, dann die Verbindung „LZ Scopes“ anlegen.

**Eigenes Repo?** Für den eigenen Einsatz nicht: Companion lädt das Modul aus dem Entwickler-Ordner. Für die offizielle Modulliste von Bitfocus braucht es ein eigenes Repo in der Bitfocus-Organisation (`companion-module-<hersteller>-<produkt>`, freie Lizenz, Paket per `@companion-module/tools`). Der Ordner `companion/` ist so aufgebaut, dass er sich dafür unverändert herauslösen lässt.
