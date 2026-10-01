## LZ Scopes

Steuert LZ Scopes über die Steuer-API der Bridge (WebSocket `/control`).

### Einrichtung

- **Host / Port**: Rechner mit LZ Scopes. Die Desktop-App nimmt Port 4192, wenn er frei ist (sonst steht der Port im Log); `npm start` lauscht ebenfalls auf 4192.
- **Token**: nur nötig, wenn Companion auf einem anderen Rechner läuft. Dann LZ Scopes mit `LZS_HOST=0.0.0.0 LZS_CONTROL_TOKEN=<geheim>` starten (bzw. `node server/index.mjs --host 0.0.0.0 --control-token <geheim>`) und hier dasselbe Token eintragen. Ohne Token nimmt die Bridge nur Verbindungen von 127.0.0.1 an.
- Das Hauptfenster von LZ Scopes muss offen sein; es führt die Befehle aus. Der Verbindungsstatus zeigt „Bridge erreichbar, Fenster nicht verbunden“, solange es fehlt.

### Aktionen

Quelle wählen (alle Panels oder eins), Layout-Vorlage, Layout-Konfiguration laden, Scope je Panel, Panel maximieren, Einfrieren, QC-Protokoll leeren, Messrahmen löschen, Testbild wählen/weiter/zurück, Ausgabe öffnen/schließen (mit Overlay-Szene und Hintergrund Bild/Schwarz), Overlay-Szene wählen, Stream starten/stoppen, Transport für Videodateien.

Quellen, Panels, Vorlagen und Szenen werden wie in der App gezählt (ab 1) oder mit Namen angegeben.

### Feedbacks

Verbunden, QC-Ereignis aktiv, Eingefroren, Quelle aktiv, Clipping über Schwelle, Y′ max über / Y′ min unter Schwelle, Layout aktiv, Szene aktiv, Ausgabe offen, Stream läuft, Panel maximiert, Videodatei läuft.

### Variablen

`source`, `source_index`, `frozen`, `clip`, `clip_high`, `clip_low` (in %), `ymin`, `ymax` (in %), `layout`, `scene`, `outputs`, `streams`, `pattern`, `maximized`, `playing`, `qc_active`, `qc_last`, `connected`. Unbekannte Werte bleiben leer.

### Stream Deck

Stream Deck (und andere Bedienpulte) laufen über Bitfocus Companion: Tasten mit den Aktionen oben belegen, z. B. Scope je Panel umschalten (auch 3D-Farbvolumen, Sättigung über Luma, Kanal-Plot, Min/Max, Zeitverlauf, QC-Protokoll), Einfrieren, Testbild weiter; das Feedback „QC-Ereignis aktiv“ färbt eine Taste rot, solange ein QC-Ereignis läuft, `qc_last` zeigt das letzte als Text. Ein eigenes Stream-Deck-Plugin ist dafür nicht nötig.
