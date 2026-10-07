**Deutsch** | [English](cable-planner-integration.md)

# LZ Scopes im cable-planner – Konzept

Stand 29.09.2026. Nichts davon ist gebaut. Es beschreibt, wie die Scopes in den cable-planner passen, ohne zu einem „Extra-Tool“ zu werden.

## Grundsatz

Messen gehört an das Gerät im Canvas, genau wie die ATEM-Multiviewer-Konfiguration, die Kamerasteuerung und das Videohub-Routing. Es gibt keine eigene Scopes-Ansicht in der Suite. Wer eine Kamera im Plan anklickt, findet dort *Vorschau* **und** *Scopes*.

## Was der cable-planner schon hat

- `StreamsSection` (#946): Streams je Gerät (`StreamEndpoint`: Protokoll, Richtung, Adresse ohne Zugangsdaten)
- `streamPreviewService` im Electron-Hauptprozess:
  - nur lokale Adressen
  - Zugangsdaten aus dem Schlüsselbund, sie erreichen den Renderer nie
  - ffmpeg wird gesucht, nicht mitgeliefert
  - holt bisher genau **ein** Standbild als `data:`-URI, damit die CSP des Fensters bleibt, wie sie ist
- `streamPreviewStore`: Freigabe und Sperre der Vorschau je Projekt

Das sind genau die Riegel, die Live-Scopes auch brauchen. Die Scopes erweitern also diesen Dienst und bauen keinen zweiten Weg.

## Vorschlag

### 1. Transport: IPC statt WebSocket

Hauptprozess:
- `streamScopeService.start(endpointId, { width, depth })` prüft dasselbe wie `streamPreviewService`: lokal, freigegeben, Zugangsdaten aus dem Schlüsselbund.
- Danach startet er ffmpeg mit `-f rawvideo -pix_fmt rgba|rgba64le`. Der Aufruf und die explizite Matrix stehen in [`frame-protocol.de.md`](frame-protocol.de.md).
- Die Frames gehen über einen `MessageChannelMain`-Port an den Renderer, als übertragbarer `ArrayBuffer`, also ohne Kopie.

Renderer:
- `source.pushInfo(info)`, danach je Frame `source.pushFrame(buf)`. Beides ist in lz-scopes vorhanden.

Warum so:
- Kein offener Port und keine CSP-Lockerung (`connect-src`).
- Die Adresse mit Passwort bleibt im Hauptprozess.
- Es braucht weder lz-camera-bridge noch die lz-scopes-Bridge.

Randbedingungen:
- Höchstens ein ffmpeg je Endpunkt, egal wie viele Panels hinsehen.
- ffmpeg läuft nur, solange ein Panel offen ist.
- Fehlt ffmpeg, kommt dieselbe Meldung `no-ffmpeg` wie bei der Vorschau.

### 2. Oberfläche am Gerät

- **Eigenschaften → Streams:** Neben *Vorschau* steht *Scopes* bei jedem sendenden Stream. Das Panel darunter zeigt Waveform und Vectorscope, per Kopf-Select auf Parade, Histogramm oder CIE umschaltbar (`ScopeView`, 2 Panels). Transfer und Farbraum stehen auf „auto“ und kommen aus ffprobe.
- **Am Gerät im Canvas:** Die Plakette bekommt optional ein kleines Live-Waveform (~120×60), nur solange es eingeschaltet ist. Doppelklick öffnet das große Panel.
- **Am Kabel (Messpunkt):** Ein Kabel, dessen Quellgerät einen sendenden Stream hat, bekommt im Kontextmenü *Signal messen*. Das entspricht dem Scope am Steckfeld: gemessen wird das, was auf dieser Leitung ankommt. Ohne Stream bleibt der Eintrag grau, mit dem Hinweis, woran es fehlt (etwa „SDI – Capture oder Encoder nötig“, wie in `lz-camera-bridge/docs/live-video.md`, Kategorie 4).
- **Vergleich:** Mehrere Geräte auswählen und *Scopes vergleichen* wählen. Das Panel zeigt je Quelle eine Parade nebeneinander, gedacht für das Matching mehrerer Kameras. Das ist der einzige Ort mit mehr als einer Quelle, und er entsteht aus der Auswahl im Canvas, nicht als eigene Ansicht.

### 3. Testbilder als Gerät

- Im Katalog steht ein virtuelles Gerät *Testbildgenerator* (Software, ohne Hardware). Es hat Ausgänge wie ein echter Generator und am Gerät die Musterwahl aus `PATTERNS`, samt Auflösung und Label.
- Ist ein Ausgang mit einem Display oder Beamer im Plan verbunden und dieses einem Bildschirm des Rechners zugeordnet, öffnet *Ausgeben* ein randloses Vollbildfenster auf genau diesem Bildschirm (`BrowserWindow` mit `screen.getAllDisplays()`). Das ist der Weg von `?out=` in lz-scopes, nur mit Zielbildschirm aus dem Plan.
- Die LZ-Displaytestbilder gehören dazu. Der cable-planner vendort nur die 1080p-Pngs, rund 600 KB.

### 4. Web-Viewer und Mobile

`src/viewer` und `src/mobile` haben kein ffmpeg. Dort bleiben *Scopes* und *Signal messen* ausgeblendet. Die Testbild-Musterwahl funktioniert, weil sie reines Canvas ist.

## Code-Teilung

- Den lz-scopes-Kern (`color`, `renderer`, `graticule`, `panel`, `sources`, `patterns`, `embed`) vendoren, genauso wie ihn lz-camera-bridge vendort: `src/renderer/vendor/lz-scopes/` mit `VENDOR.md` (Quelle und Commit).
- Ein Drift-Gate nach dem Muster der Suite (`npm run drift` in av-planner-suite) vergleicht gegen `larszu/lz-scopes@main`. So bleiben Planner und Bridge auf demselben Stand, ohne privates npm-Paket und ohne GitHub-Zugriff beim Installieren.
- Der Hauptprozess-Teil (ffmpeg-Argumente, Matrix, Backpressure) kommt nach `src/main/util/streamUrl.ts` dazu. `ffmpegArgs` gibt es dort schon, er bekommt eine Variante `rawvideo`.

## Reihenfolge

1. IPC-Transport und Streams-Abschnitt (*Scopes* neben *Vorschau*), mit Tests für die Argumente und die Freigabelogik
2. Messpunkt am Kabel und Plakette im Canvas
3. Testbildgenerator als Gerät, Ausgabe auf den zugeordneten Bildschirm
4. Vergleich mehrerer Quellen

## Offen für Lars

- Soll die Canvas-Plakette standardmäßig aus sein? Vorschlag: ja, denn Rechenlast und Netzlast entstehen nur, wenn jemand hinsieht.
- Soll der Testbildgenerator ein Katalogeintrag sein (sichtbar im Plan und in der Stückliste) oder eine Funktion am Display („Testbild zeigen“)? Vorschlag: Funktion am Display plus optionales Gerät, weil ein reales Gerät wie ein Blackmagic-Generator sonst doppelt geführt würde.
