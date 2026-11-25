# Line-up und Weißabgleich: Abgleich mit Lehrvideos und „Broadcast Monitor“ (#211)

Stand 24.11.2026. Vergleich der Abläufe aus #211 mit dem, was LZ Scopes heute kann (Shading-Assistent [shading-ablauf.md](shading-ablauf.md), Kamera-Abgleich [kamera-abgleich.md](kamera-abgleich.md)).

**Grenze dieser Notiz:** Die Videos selbst wurden nicht angesehen. Gelesen sind Titel, Kanal, Länge und Beschreibung (YouTube-oEmbed und Videoseite); Untertitel waren ohne Anmeldung nicht abrufbar. Alles, was unten über den Inhalt steht, stammt aus diesen Texten oder ist als Annahme markiert. Der eigentliche Abgleich „Schritt für Schritt gegen das Video“ ist offen.

## Quellen

| Video | Kanal | Länge | Was die Beschreibung sagt |
|---|---|---|---|
| [Introducing Broadcast Monitor](https://www.youtube.com/watch?v=Wa0bFtfdg4A) | Doug Johnson Productions | 28:09 | Windows-Programm: Bild, Waveform, Vectorscope, Histogramm; Mehrkanal-Pegel und Stereo-Phase; DeckLink/UltraStudio, Kameras, NDI, Netzstreams, Dateien; speicherbare Layouts; eingebaute Farbbalken; Ausgabe des Layouts über NDI oder Blackmagic-Hardware |
| [Camera Line up – Auto](https://www.youtube.com/watch?v=New5QihhJl0) | Q3 Media Training (Birmingham City University, 11/2020) | 0:30 | nur „Broadcast Studio Production – Vision Mixing and Camera Systems“ |
| [Camera Line up – Manual YCrCb](https://www.youtube.com/watch?v=Z2DhCidKqYA) | Q3 Media Training | 0:48 | wie oben |
| [White Balance – Color Correction for Broadcast](https://www.youtube.com/watch?v=yxceiOl5VJ4) | Sold out Media | 16:54 | Mehrkamera-Weißabgleich vor der Sendung: CCUs, CCU-Fernbedienungen, Vectorscope, Histogramm, Schwarz setzen, Weiß setzen, Farben anpassen, Kameras von Hand angleichen, Korrektur in der Nachbearbeitung |
| [Multi-camera Set Up for High End Production](https://www.youtube.com/watch?v=dnT-zRhWVK4) | Tektronix | 11:57 | Kurzfassung des NAB-2014-Vortrags von George Palmer, Gerät WFM5200 |

## Abgleich: Line-up-Ablauf

| Schritt (aus Beschreibung bzw. Tektronix-App-Note 25W-27159) | LZ Scopes heute | Lücke |
|---|---|---|
| Schwarz setzen (Blende zu, Pedestal) | Shading-Assistent Schritt „Schwarz, Blende zu“ | – |
| Schwarzbalance | Schritt „Black Balance“, Waveform-Lupe für Schwarz | – |
| Weiß setzen, Weißabgleich auf Testtafel | Schritte „Graukeil“ und „Weiß“ | – |
| Vectorscope zur Kontrolle der Farbneutralität | Vectorscope mit Referenzspur, Farbtafel-Match | – |
| Histogramm | Histogramm mit Referenzumriss | – |
| Kameras von Hand angleichen | Referenzkamera und Geisterspur, Δ-Kennzahlen, Kachelansicht bis 8 Kameras | – |
| **Auto-Line-up** (Annahme aus dem Titel: automatischer Abgleich an der CCU, danach Kontrolle am Messgerät) | Assistent prüft, löst aber nichts aus; ein „Auto-Setup“-Schritt fehlt | Schritt „Auto-Setup an der CCU ausgelöst?“ vor Schwarz, danach dieselben Prüfungen als Kontrolle |
| **Manuelles Line-up in Y′CrCb** (Annahme aus dem Titel: Abgleich an einer Y′/Cb/Cr-Parade, Cb und Cr auf Mitte) | YCbCr-Parade vorhanden; der Assistent bewertet R′−G′ und B′−G′ | Toleranz zusätzlich als Cb/Cr-Abweichung anzeigen (Wandlung ist in `src/shading/guide.ts` `cbcr()` schon da) |
| CCU-Fernbedienung | Touch Shading und Paint-Werte über lz-camera-bridge | an echten Kameras ungeprüft (#116) |

## Abgleich: „Broadcast Monitor“

| Funktion laut Beschreibung | LZ Scopes |
|---|---|
| Bild, Waveform, Vectorscope, Histogramm | ja |
| Mehrkanal-Pegel, Stereo-Phase | ja (Pegel & Lautheit, Goniometer mit Korrelation) |
| DeckLink/UltraStudio, NDI, Netzstreams, Dateien, Kameras | ja; DeckLink nie mit Hardware geprüft, NDI nur im Loopback |
| speicherbare Layouts | ja (*Datei → Layouts …*) |
| eingebaute Farbbalken | ja (rund 40 Testbilder) |
| Ausgabe des Layouts über NDI oder Blackmagic-Hardware | Ausgabefenster und 10-bit-Stream über die Bridge; ob NDI-/DeckLink-Ausgabe des ganzen Layouts geht, hier nicht geprüft |
| nur Windows | LZ Scopes: macOS, Windows, Linux, Browser, iPad |

Keine Funktion aus der Beschreibung, die LZ Scopes ganz fehlt. Ob das Video Bedienideen zeigt, die über die Liste hinausgehen, ist offen, solange es nicht angesehen ist.

## Offen

- Die fünf Videos ansehen und die Tabellen oben gegen den gezeigten Ablauf prüfen (Reihenfolge, Toleranzen, Begriffe).
- Shading-Assistent: Schritt „Auto-Setup“ und Cb/Cr-Anzeige, falls das Ansehen die Annahmen bestätigt.
