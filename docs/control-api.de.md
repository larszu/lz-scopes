**Deutsch** | [English](control-api.md)

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
| `source.split` | `source`, `layout` (`2x2`, `3x3`, `4x4`, `2+8`, `1+5`; `none` entfernt die Kachel-Kameras), `inset` optional (Rand je Seite als Anteil der Kachelhöhe, 0 … 0,25, Vorgabe 0,1). Legt je Multiviewer-Kachel eine Kamera an (#217), die Antwort nennt die Kameras |
| `panel.split` | `panel` (Bild-Panel), `mode` `toggle`/`on`/`off`, `source` optional (B), `spread` optional (`true` = die anderen nicht angepinnten Panels folgen). Der Split ist dann die Quelle `Split Panel N` (#177) |
| `panel.follow` | `panel`, `follow` (Bild-Panel, dessen Quelle samt Split dieses Panel zeigt; `0` = wieder die eigene Quelle) |
| `layout.preset` | `preset`: 1–6, Kennung (`lc`) oder Beschriftung (`2x2`, `Colorist`) |
| `layout.load` | `name` einer gespeicherten Layout-Konfiguration |
| `panel.scope` | `panel`, `scope` (`picture`, `wf-luma`, `wf-color`, `wf-skin`, `wf-rgb`, `parade`, `yrgb`, `ycbcr`, `vector`, `hls`, `cie`, `diamond`, `cube`, `surface`, `satlum`, `chplot`, `minmax`, `timeline`, `strip`, `qclog`, `hist`, `stats`, `tiles`, `noise`, `wshading`, `skinall`, `chart`, `drift`, `audio-meter`, `audio-loudness`, `audio-spectrum`, `audio-phase`, `audio-check`, `audio-surround`, `audio-field`, `audio-spl`, `audio-rta`, `clock`, `genlock`) |
| `panel.maximize` | `panel`, `mode` `toggle`\|`on`\|`off`; `off` ohne `panel` = zurück |
| `freeze` | `mode` `toggle`\|`on`\|`off`; alle Quellen im selben Moment der Szene (gemessene Latenz ausgeglichen) |
| `qc.clear` | – (QC-Protokoll leeren; Zustand `qc`: `active`, `total`, `last`) |
| `roi.clear` | `source` optional (ohne = alle): Messrahmen und Messpunkt löschen |
| `pattern.select` | `pattern` (id oder Name), `source` optional (sonst erste Testbild-Quelle) |
| `pattern.next`, `pattern.prev` | `source` optional |
| `output.open` | `name`, `view` (`overlay` Standard, `grid`, `panel`, `clean`), `panel`, `source`, `scene`, `bg` `picture`\|`black`, `display` (Bildschirm-id), `fullscreen` (Standard `true`), `stream`, `target`, `codec` (10-bit-Stream: `hevc10`, `hevc422`, `v210`, `prores`; braucht `target`) |
| `output.close` | `name` optional (ohne = alle) |
| `scene.select` | `scene`; `output` optional (ohne = Vorgabe und alle offenen Overlay-Ausgaben) |
| `stream.start` | `stream` (Name → `/out/<stream>.mjpeg`), `output` optional (sonst die erste offene Ausgabe; ist keine offen, öffnet sich ein Overlay-Fenster), `target` optional (`rtmp://`, `srt://`, `rtsp://`, `udp://`, `tcp://`, `rtp://`), `codec` optional (10 bit, wie bei `output.open`; ohne Angabe MJPEG; ein 10-bit-Codec geht nicht über RTMP) |
| `stream.stop` | `output` oder `stream` optional (ohne = alle) |
| `transport` | `op` `play`\|`pause`\|`toggle`\|`stop`\|`next`\|`prev`\|`forward`\|`rewind`\|`start`\|`end`, `source` optional (sonst die gezeigte Videodatei; ohne Videodatei die geöffneten Aufnahmen an ihrer gemeinsamen Uhr) |
| `audio.reset` | `source` optional (sonst alle Quellen mit Ton): I, LRA, Max M/S, Max TP, Zähler und Protokoll zurücksetzen (EBU Tech 3341) |
| `audio.pause` | `mode` `toggle`\|`on`\|`off`, `source` optional: I und LRA anhalten/fortsetzen (Tech 3341) |
| `generator` | `mode` `toggle`\|`on`\|`off`, `signal` optional (`sine`, `ebu-ident`, `glits`, `blits`, `ebu-multi`, `ident-lr`, `pink`, `pink-band`, `white`, `sweep`, `steps`, `polarity`, `avsync`, …), `freq` 10–20000 Hz, `level` −90–0 dBFS; über −6 dBFS nur mit `"force": true` |
| `record` | `mode` `toggle`\|`on`\|`off`, `source` optional (ohne = alle aufnehmbaren Quellen in eine gemeinsame Aufnahme, wie „Alle aufnehmen“; `toggle` beendet alle, sobald eine läuft) |
| `ring` | `mode` `toggle`\|`on`\|`off`, `source` optional (ohne = alle Bridge-Quellen): Ringpuffer der Quelle |
| `ring.save` | `pre` (s, optional), `post` (s, optional; Nachlauf): alle Ringpuffer mit derselben Zeitmarke sichern; ohne Angabe die Werte aus Einstellungen → Aufnahme |
| `record.mark` | `label` optional (ohne = M1, M2 …), `source` optional (ohne = alle laufenden Aufnahmen): Marker in die Begleitdatei |
| `record.event` | `kind` (Buchstaben, Ziffern, `_ . -`), `data` (beliebiger JSON-Wert bis 16 KB), `source` optional: Ereignis in die Begleitdatei, z. B. Paint-Änderungen |
| `setting` | `key` (`theme`, `scheme`, `sidebar`, `display`, `hdrPreview`, `unit`, `tint`, `precision`, `falseColour`, `skinLuma`, `skinHue`, `zebra`, `stage`, `deRef`, `lowLatency`, `refSource` (Quellen-ID oder leer = aus), `refMode` (`live`/`frozen`), `refOpacity` (5…100 %)), `value`: eine der Auswahlen, eine Zahl im Bereich, `true`/`false` oder `[lo, hi]` für `skinLuma`. Dieselbe Beschreibung baut das Einstellungen-Fenster und die ⚙-Zeilen der Panels (src/ui/schema.ts); `state.settings` listet Schlüssel, Werte, Auswahlen und Bereiche |

Antwort: `{ ok, result?, error?, state }`. `error` ist ein englischer Text, der Befehl und Problem nennt (z. B. `source.select: source missing`, `Token missing or wrong`). Status `400` = ungültiger Befehl, `422` = nicht ausführbar (z. B. Szene unbekannt), `503` = kein Hauptfenster, `401`/`403` = Zugriff. Skripte sollten sich auf `ok` und den Statuscode stützen, nicht auf den Wortlaut.

## Zustand (Feedbacks)

```json
{
  "source": { "index": 1, "id": "s1", "name": "Kamera 1", "status": "live" },
  "frozen": false,
  "clip": 0.4, "clipHigh": 0.4, "clipLow": 0,
  "yMin": 3.1, "yMax": 98.7,
  "outside": { "gamut": "709", "share": 12.4, "far": 3.1 },
  "layoutName": "Grading", "preset": "lc",
  "maximized": null,
  "scene": { "id": "…", "name": "Waveform unten" },
  "outputs": [{ "name": "key", "view": "overlay", "scene": "Waveform unten", "stream": "scopes" }],
  "pattern": { "id": "smpte75", "name": "SMPTE 75 % Balken + PLUGE" },
  "playing": null,
  "audio": { "source": "Kamera 1", "momentary": -22.8, "shortTerm": -23.1, "integrated": -23.0, "lra": 4.2, "maxTP": -2.1,
             "paused": false, "seconds": 312, "avOffsetMs": 12.5, "ident": "EBU-Stereo-Ident (R 49)", "identProblems": [] },
  "generator": { "running": false, "signal": "sine", "level": -18, "freq": 1000, "channels": 2 },
  "light": { "target": { "schema": "lz-scopes.light-target/1", "label": "Key", "place": "Stage left", "note": "", "time": "2026-11-24T10:00:00.000Z", "device": "LM3",
             "lux": 1200, "quantity": "lx", "ev100": 8.91, "x": 0.4232, "y": 0.3990, "u": 0.2435, "v": 0.5165, "cct": 3200, "duv": 0 },
             "latest": { "…": "same fields, without label/place/note" }, "delta": { "duv": 0.0042, "cct": 180, "duvDiff": 0.0011, "ev": -0.35 }, "points": 12 },
  "recording": { "active": 1, "sources": [{ "name": "Kamera 1", "id": "s1", "seconds": 312, "take": "20261010-213005" }], "ring": [{ "name": "Kamera 2", "id": "s2", "pre": 60, "buffered": 60 }] },
  "settings": [{ "key": "unit", "kind": "select", "label": "Skala", "value": "percent", "options": ["percent", "bit8", "bit10", "nits"] }, …],
  "sources": [], "layouts": [], "presets": [], "panels": [], "scenes": [], "patterns": []
}
```

Namen (Quellen, Szenen, Testbilder, Ident) stehen so da, wie die App sie zeigt; selbst vergebene Namen bleiben, wie eingegeben.

`outside` ist der Anteil der aktiven Quelle außerhalb des Zielfarbraums eines offenen CIE-Panels (#181; `null`, wenn keines offen ist), `far` der Teil deutlich außerhalb – dieselbe Regel wie die Gamut-Warnung in der Bildansicht. `clip`, `yMin`, `yMax` sind Prozent (0,1-genau) der aktiven Quelle – das ist die Quelle, die die meisten sichtbaren Panels zeigen. Ohne Statistik stehen sie auf `null`. `audio` gilt für die aktive Quelle mit Ton (sonst die erste mit Ton), Werte in LUFS/LU/dBTP auf 0,1 gerundet, `avOffsetMs` nach ITU-R BT.1359-1 (+ = Ton vor Bild), `null` ohne Messwert. `layoutName` ist die zuletzt geladene Layout-Konfiguration bzw. die Beschriftung der Vorlage. `light` (#184) ist die Lichtmessung: `target` der als Ziel gemerkte Punkt (★ im Lichtmesser; `null` ohne Ziel), `latest` die letzte Messung des aktiven Geräts, `delta` letzte Messung minus Ziel (Δu′v′ CIE 1976, ΔCCT in K, ΔDuv, Helligkeit in EV). `ev100` ist EV bei ISO 100 mit der Lichtmess-Konstante C = 250 (flacher Empfänger, ISO 2720). Andere Werkzeuge (light-planner für die Leuchten, camera-bridge für den Farbabgleich der Kamera) lesen das Ziel hier; das in der App kopierte bzw. gespeicherte Ziel-JSON hat dieselben Felder und dazu das Spektrum bei Spektrometer-Messungen.

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
curl -s -H "$J" -d '{"cmd":"record","mode":"on"}' $B                       # alle Quellen aufnehmen
curl -s -H "$J" -d '{"cmd":"record.mark","label":"Gamma +2"}' $B
curl -s -H "$J" -d '{"cmd":"record","mode":"off"}' $B
curl -s -H "$J" -d '{"cmd":"ring","mode":"on"}' $B                         # Ringpuffer für alle Bridge-Quellen
curl -s -H "$J" -d '{"cmd":"ring.save","post":5}' $B                       # letzte Sekunden + 5 s Nachlauf sichern
# mit Token von einem anderen Rechner
curl -s -H "$J" -H 'Authorization: Bearer geheim' -d '{"cmd":"freeze"}' http://studio.local:4192/api/control
```

Im Browser öffnet `output.open` ein Fenster nur, wenn Pop-ups für die Seite erlaubt sind; die Desktop-App öffnet es immer.

## Ereignisprotokoll und Prometheus

Die Bridge führt ein **Ereignisprotokoll ohne Schwellwerte** (`server/eventlog.mjs`, Ringpuffer mit 2000 Einträgen, bis zum Neustart der Bridge): jede Änderung am Fluss eines Streams (Start, Stopp, Ende, Fehler), an seinem Bildformat und seinen Tonkanälen, am PTP-Zustand, an Domäne, Grandmaster, Taktklasse und UTC-Versatz, am Lock-Zustand des Grandmasters (ST 2059-2 SM-TLV) und am ST-2110-RTP-Strom, den das Uhr-Panel beobachtet. PTP und RTP werden nur verfolgt, solange das Uhr-Panel ihre Monitore laufen lässt. In der App: Quellen → Ereignisprotokoll …

| Pfad | Antwort |
|---|---|
| `GET /api/events` | `{ max, total, events: [{ id, t, kind, source, item, from, to }] }`, `?since=<id>` für die neueren |
| `GET /api/events?format=csv` | dasselbe als CSV (Semikolon, Zeiten in UTC) |
| `DELETE /api/events` | leert das Protokoll |
| `GET /metrics` | Prometheus-Textformat 0.0.4: Streams (Bilder, verworfen, Bytes, Größe, fps), PTP (Zustand, Versatz, Jitter, Laufzeit, Taktklasse, Lock-Status), RTP (Pakete, Verzug, Raster), Zahl der Ereignisse |

Zugriff: von diesem Rechner immer, von anderen nur mit dem Steuer-Token (`Authorization: Bearer <token>`), Webseiten fremder Herkunft nie. Quellen erscheinen ohne Benutzername, Passwort und Query. Beispiel für die Abfrage:

```yaml
scrape_configs:
  - job_name: lz-scopes
    static_configs: [{ targets: ['studio.local:4192'] }]
    authorization: { credentials: geheim }   # nur wenn Prometheus auf einem anderen Rechner läuft
```
## ST-2110-Mitschnitt (pcap)

Für `st2110:`-Quellen (docs/research/st2110-empfang.md) schneidet die Bridge die empfangenen Flows als pcap mit. Zugriff wie oben: Mitschnitte enthalten Anlagen-Adressen.

| Pfad | |
|---|---|
| `GET /api/st2110` | laufende Services `[{ id, flows, capture }]` |
| `GET /api/st2110/pcap?id=&seconds=5&mb=50` | Schnappschuss aller Flows des Service (beide 2022-7-Wege), Download |
| `POST /api/st2110/ring` `{id, mode:"on"\|"off", seconds?, mb?}` | Ringpuffer auf der Platte (Vorgabe 60 s / 200 MB) |
| `POST /api/st2110/ring/save` `{id}` | → `{ ok, file, bytes, url }` |
| `GET /api/st2110/file?name=` | ein gesicherter Mitschnitt |

`id` kann fehlen, wenn nur ein Service läuft. Der Zustand der aktiven Quelle (`state.st2110`) enthält die Flow-Zähler und die ST-2022-7-Auswertung. IP-/UDP-Kopf in der Datei sind nachgebaut, die Zeitstempel sind Software-Empfangszeiten (keine Hardware-Zeitstempel).

## Companion-Modul

`companion/` enthält das Modul `companion-module-lz-scopes` (API `@companion-module/base` ~1.14.1, wie das Modul in lz-camera-bridge) mit Aktionen für die Befehle oben (außer `record.event`), Feedbacks (Aufnahme läuft, Ringpuffer läuft, Verbunden, Eingefroren, Quelle aktiv, Clipping/Y′ über Schwelle, Layout, Szene, Ausgabe offen, Stream läuft, Panel maximiert, Videodatei läuft, Tongenerator läuft, I/LRA angehalten, Max True Peak über Schwelle, Ident-Befund), Variablen (auch Lautheit M/S/I/LRA, True Peak, A/V-Versatz, Ident, laufende Aufnahmen und Aufnahmedauer) und Presets.

```bash
cd companion
npm ci
npm test            # Befehle, Zustand, Feedbacks; prüft die Befehle gegen server/control.mjs
npm run build       # → dist/
COMPANION_DEV_MODULES=~/companion-dev npm run sync   # in Companions Ordner für Entwickler-Module kopieren
```

In Companion unter *Settings → Developer modules path* den Ordner (`~/companion-dev`) eintragen, dann die Verbindung „LZ Scopes“ anlegen.

**Eigenes Repo?** Für den eigenen Einsatz nicht: Companion lädt das Modul aus dem Entwickler-Ordner. Für die offizielle Modulliste von Bitfocus braucht es ein eigenes Repo in der Bitfocus-Organisation (`companion-module-<hersteller>-<produkt>`, freie Lizenz, Paket per `@companion-module/tools`). Der Ordner `companion/` ist so aufgebaut, dass er sich dafür unverändert herauslösen lässt.
