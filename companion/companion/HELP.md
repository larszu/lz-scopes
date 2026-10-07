## LZ Scopes

Controls LZ Scopes through the control API of its bridge (WebSocket `/control`). [Deutsch weiter unten](#deutsch).

### Setup

- **Host / Port**: the computer running LZ Scopes. The desktop app takes port 4192 when it is free (otherwise the port is in the log); `npm start` listens on 4192 as well.
- **Token**: only needed when Companion runs on another computer. Start LZ Scopes with `LZS_HOST=0.0.0.0 LZS_CONTROL_TOKEN=<secret>` (or `node server/index.mjs --host 0.0.0.0 --control-token <secret>`) and enter the same token here. Without a token the bridge only accepts connections from 127.0.0.1.
- The main window of LZ Scopes must be open; it executes the commands. The connection status shows “Bridge reachable, LZ Scopes window not connected” while it is missing.

### Actions

Select source (all panels or one), layout preset, load layout configuration, scope per panel, maximise panel, freeze, clear QC log, clear measuring frame, select/next/previous test pattern, open/close output (with overlay scene and picture/black background), select overlay scene, start/stop stream, transport for video files, reset loudness, pause/resume I/LRA, tone generator.

Sources, panels, presets and scenes count as in the app (from 1) or are given by name.

### Feedbacks

Connected, QC event active, frozen, source active, clipping above threshold, Y′ max above / Y′ min below threshold, layout active, scene active, output open, stream running, panel maximised, video file playing, tone generator running, I/LRA paused, max true peak above threshold, ident finding.

### Variables

`source`, `source_index`, `frozen`, `clip`, `clip_high`, `clip_low` (in %), `ymin`, `ymax` (in %), `layout`, `scene`, `outputs`, `streams`, `pattern`, `maximized`, `playing`, `loudness_*`, `true_peak`, `av_offset`, `ident`, `ident_problems`, `generator`, `qc_active`, `qc_last`, `connected`. Unknown values stay empty.

### Stream Deck

Stream Deck (and other control surfaces) work through Bitfocus Companion: assign the actions above to keys, e.g. switch the scope of a panel (including 3D colour volume, saturation over luma, channel plot, min/max, timeline, QC log), freeze, next test pattern; the feedback “QC event active” turns a key red while a QC event is running, `qc_last` shows the last one as text. No separate Stream Deck plugin is needed.

Error messages of the bridge (in the Companion log) are in English, e.g. `source.select: source missing` or `Token missing or wrong`.

---

## Deutsch

Steuert LZ Scopes über die Steuer-API der Bridge (WebSocket `/control`). Aktionen, Feedbacks und Variablen heißen in Companion englisch; die Übersicht oben gilt unverändert.

### Einrichtung

- **Host / Port**: Rechner mit LZ Scopes. Die Desktop-App nimmt Port 4192, wenn er frei ist (sonst steht der Port im Log); `npm start` lauscht ebenfalls auf 4192.
- **Token**: nur nötig, wenn Companion auf einem anderen Rechner läuft. Dann LZ Scopes mit `LZS_HOST=0.0.0.0 LZS_CONTROL_TOKEN=<geheim>` starten (bzw. `node server/index.mjs --host 0.0.0.0 --control-token <geheim>`) und hier dasselbe Token eintragen. Ohne Token nimmt die Bridge nur Verbindungen von 127.0.0.1 an.
- Das Hauptfenster von LZ Scopes muss offen sein; es führt die Befehle aus. Der Verbindungsstatus zeigt „Bridge reachable, LZ Scopes window not connected“, solange es fehlt.

### Aktionen, Feedbacks, Variablen

Quelle wählen (*Select source*), Layout-Vorlage (*Layout preset*), Layout-Konfiguration laden, Scope je Panel, Panel maximieren, Einfrieren (*Freeze*), QC-Protokoll leeren, Messrahmen löschen, Testbild wählen/weiter/zurück, Ausgabe öffnen/schließen (mit Overlay-Szene und Hintergrund Bild/Schwarz), Overlay-Szene wählen, Stream starten/stoppen, Transport für Videodateien, Lautheit zurücksetzen, I/LRA anhalten, Tongenerator. Quellen, Panels, Vorlagen und Szenen werden wie in der App gezählt (ab 1) oder mit Namen angegeben.

Feedbacks färben Tasten bei Verbindung, QC-Ereignis, Einfrieren, aktiver Quelle, Clipping bzw. Y′ über/unter einer Schwelle, aktivem Layout bzw. aktiver Szene, offener Ausgabe, laufendem Stream, maximiertem Panel, laufender Videodatei, laufendem Tongenerator, angehaltener I/LRA-Messung, Max True Peak über Schwelle und Ident-Befund. Die Variablen stehen oben; unbekannte Werte bleiben leer.

### Stream Deck

Stream Deck und andere Bedienpulte laufen über Bitfocus Companion: Tasten mit den Aktionen belegen, z. B. Scope je Panel umschalten, Einfrieren, Testbild weiter; das Feedback *QC event active* färbt eine Taste rot, solange ein QC-Ereignis läuft, `qc_last` zeigt das letzte als Text. Ein eigenes Stream-Deck-Plugin ist dafür nicht nötig.

Fehlermeldungen der Bridge (im Companion-Log) sind englisch, z. B. `source.select: source missing` oder `Token missing or wrong`.
