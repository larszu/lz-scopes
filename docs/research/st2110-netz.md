# ST 2110 im Netz: Empfang 2110-20/2022-6, Paket-Timing, PTP, Generator, NMOS (Epic #225)

Stand 25.11.2026. Betrifft #228, #229, #231, #237, #240. Code: `server/st2110/`, `server/ptp.mjs`.

## Quellen

| Quelle | Wofür | Zugang |
|---|---|---|
| SMPTE ST 2110-10:2022 (pub.smpte.org) | RTP-Takt-Offset 0 zur Epoche, Zeitstempel am Ausrichtungspunkt (abgeschnitten), `ts-refclk`, `mediaclk:direct=0`, Standard UDP Size Limit 1460, 2022-7 als `group:DUP` | frei, geöffnet |
| SMPTE ST 2110-20:2022 | Nutzlastkopf (Extended Sequence Number, SRD Length/F/Row/C/Offset), Marker, 90 kHz, pgroups (Tab. 2), SDP-Parameter §7 (`sampling`, `depth`, `TCS`, `RANGE`, `colorimetry`, `TP`, `MAXUDP`) | frei, geöffnet |
| SMPTE ST 2110-21:2022 | TVD, TRS, TRODEFAULT, RACTIVE, Lesefahrplan gapped/linear/interlaced, Netzwerk-Kompatibilitätsmodell (CINST, CMAX, β = 1,1), virtueller Empfangspuffer (VRX, VRXFULL), Formeln §7.1.2–7.1.4, SDP `TP`, `TROFF`, `CMAX` | frei, geöffnet |
| SMPTE ST 2022-6:2012 | HBRMT-Nutzlastkopf, Codetabellen FRAME/FRATE/SAMPLE, 1376-Byte-Nutzlast, Rahmen beginnt mit EAV vor Zeile 1, Beispiel XYZ 2D8h | frei, geöffnet |
| SMPTE ST 2022-8:2019 | 2022-6 im SDP (`SMPTE2022-6/27000000`) | frei, geöffnet |
| RFC 3550, RFC 4570, RFC 7104, RFC 8331 | RTP-Kopf, Source-Filter, DUP-Gruppe, ANC-Nutzlast (2110-40) | frei |
| AMWA IS-04 v1.3.3, IS-05 v1.1 (GitHub AMWA-TV; Digest `lz-camera-bridge/docs/wissen/nmos.md`) | Ressourcen, Version als TAI „s:ns“, Registrierung, Heartbeat, staged/active, Aktivierungsarten | offen |
| [Wissen] SMPTE ST 274/296/292-1 (nicht frei) | Zeilensummen (PL), aktive Zeilen, C/Y-Verschachtelung, LN-Wörter | nicht geöffnet, im Code markiert |
| [Wissen] IEEE 1588-2008 §7.5.2.2.2 (nicht frei) | EUI-64 aus EUI-48: FF-FE in Oktett 3–4, OUI vorn | nicht geöffnet |
| [Wissen] Linux sysfs (`/sys/class/net/<if>/statistics`, `device/ptp`) | Last je Interface, PTP-Hardware-Uhr vorhanden | Kernel-Doku, nicht geöffnet |

RP 2110-25 ist nicht frei und wurde nicht gelesen. Die drei Werte, die #229 nach RP 2110-25 nennt, sind hier so definiert (Namen wie im VB440):

- **RTP-Offset** (Align Offset): RTP-Zeit des Bildes minus Ausrichtungspunkt N·TFRAME. Ein normgerechter Sender liegt bei 0 bis −11 µs (Abschneiden auf das 90-kHz-Raster).
- **First Packet Margin** (FTP Margin): TVD (= Ausrichtungspunkt + TROFFSET) minus Ankunft des ersten Pakets. Positiv = das erste Paket kam vor seiner Lesezeit.
- **Path Delay** (Path Display): Ankunft des ersten Pakets minus RTP-Zeit. Enthält Senderversatz, Netzlaufzeit und den Fehler der Empfängeruhr.

## Was gebaut ist

### Empfang (#228, Stufe 1)

`server/st2110/receiver.mjs` ist ein Software-Empfänger mit normalen UDP-Sockets (Node). Er läuft als Helfer-Prozess (Protokoll wie DeckLink/AJA/NDI, `docs/frame-protocol.md`) und liefert v210. Damit geht das Bild denselben Weg wie bei SDI-Karten, auch die v210-Durchreichung ohne ffmpeg.

- 2110-20: YCbCr 4:2:2 mit 8, 10 und 12 bit (12 bit auf 10 gekürzt), progressiv und interlaced, 1–3 SRD-Köpfe je Paket. Bilder mit fehlenden Paketen werden gezählt und nicht an die Scopes gegeben.
- 2022-6: HD/3G 10 bit 4:2:2 (1080i/p, PsF, 720p). TRS-Prüfung je Zeile, aktives Bild nach v210.
- 2022-7: zwei Beine, das erste Paket je Sequenznummer gewinnt.
- Format aus dem SDP: `colorimetry` → Matrix/Primärfarben, `TCS` → Transfer (PQ, HLG …), `RANGE` → Bereich. Die HDR-Erkennung der Scopes folgt daraus.
- Die Quelle heißt `st2110:net1`, `st2110:net2`. Jeder Eingang ist eine SDP-Datei im Konfigurationsordner; der Empfänger beobachtet sie und wechselt ohne Neustart der Quelle.

Grenzen: Ein Node-Thread schafft kleine Bilder und Teststreams. 1080p50 sind rund 216 000 Pakete/s, das schafft er nicht verlustfrei. Nicht gebaut: RGB und 4:4:4, UHD-Praxis, Kernel-Bypass.

**Stufe 2 (offen):** Empfang unter Linux mit Kernel-Bypass, z. B. AF_XDP oder Intel Media Transport Library (MTL, BSD-3-Clause), als eigener Helfer in `helpers/` mit demselben Protokoll. Erst damit sind 1080p50/59,94 und UHD realistisch. Auf dem Mac nicht vorgesehen.

### Paket-Timing (#229)

`server/st2110/timing.mjs`, je Flow:

- ST 2110-21: NPACKETS aus dem Flow gelernt, Modell aus SDP (`TP`, `TROFF`, `CMAX`, `MAXUDP`). CINST nach §6.6.1 (Eimer leert sich alle TDRAIN = TFRAME/NPACKETS/β ab der Epoche), VRX nach §6.6.2 gegen den signalisierten Lesefahrplan und gegen den späteren Start, den ein Empfänger mindestens bräuchte. Urteil: CINST ≤ CMAX, VRX ≤ VRXFULL ohne Unterlauf.
- RP-2110-25-Werte wie oben, je Bild; Mittel, Min, Max.
- IAT, Paketrate, Bitrate, Burstiness (Pakete je ms: Maximum gegen Mittel), Verlust, Umordnung, Doppelte; Verlauf je Sekunde (60 s) für eine spätere Wasserfall-Anzeige.

**Alle Werte stammen aus Software-Zeitstempeln** (Zeit des JavaScript-Callbacks, nicht der Netzwerkkarte) und tragen `timestamps: 'software'`. Sie taugen zum Erkennen grober Fehler (falsches TP, fehlende Pakete, Versatz im ms-Bereich), nicht zur Abnahme eines Senders. DSCP und TTL liefert Node nicht (kein IP_RECVTOS/IP_RECVTTL), sie bleiben leer.

### PTP-Monitor (#231)

`server/ptp.mjs` ergänzt:

- Liste aller Leader aller Domains mit Klasse, Genauigkeit, Prioritäten, Zeitquelle, OUI (nur wenn die Identität aus einer MAC gebildet ist; Herstellername nicht, die IEEE-Liste ist nicht eingebaut) und Zeitdifferenz ihres Sync zum gewählten Grandmaster der Domain.
- Grandmaster-Wechsel als Ereignis (letzte 50).
- Nur der gewählte Leader steuert den angezeigten Offset (vorher mischten mehrere Leader).
- Unter Linux: welches Interface eine PTP-Hardware-Uhr hat, Empfangslast in Mbit/s und Paketen/s.

Hardware-Zeitstempel werden **nicht** genutzt: Node kann `SO_TIMESTAMPING` nicht anfordern. Das braucht einen eigenen Helfer (C, Linux) oder linuxptp (`ptp4l`/`phc2sys`, GPL, nur als separates Programm). Absolute Path Delay je Flow gibt es nur als „Path Delay“ der Timing-Werte, also mit der Ungenauigkeit der Software-Zeit.

### Testsignal-Generator (#237)

`server/st2110/generator.mjs`:

- 2110-20: Farbbalken 100/0/75/0 und Rampe, 10 oder 8 bit 4:2:2, BT.709/BT.2020, 1080i/p, 720p, 2160p, Lesefahrplan nach 2110-21 (Pakete bei TPRj − TRS/2).
- 2110-30: L24, 1–64 Kanäle, Sinus mit Pegel (Standard 1 kHz, −18 dBFS), 1 ms oder 125 µs.
- 2110-40: ATC (LTC-Typ) aus der PTP-Zeit minus Schaltsekunden, ganzzahlige Bildraten.
- 2022-6: 720p/1080p HD-SDI-Rahmen mit Balken; CRC-Wörter fest 200h (nicht berechnet).
- 2022-7: dieselben Pakete an zwei Ziele.

Gesteuert über `/api/st2110/generators` (Bridge) und als NMOS-Sender. Software-Takt: Node sendet in Bündeln je Schleifendurchlauf. Ein Generator-Flow erfüllt darum CINST meist **nicht** (gemessen im Loopback: CINST bis 87 bei CMAX 4 für das kleine Testbild). Für Empfangstests reicht das, als Referenzsender für Timing-Messungen nicht. Nicht gebaut: GLITS/BLITS, Drop-Frame-ATC, Steuerung über die Control API (Befehle laufen dort zum Hauptfenster, der Generator sitzt in der Bridge).

### NMOS (#240)

`server/st2110/nmos.mjs`, nur mit `--nmos-port <n>` (oder `LZS_NMOS_PORT`), weil der Knoten einen eigenen Port im Netz öffnet:

- IS-04 Node API v1.3: self, devices, sources, flows, senders, receivers. Ein Receiver je Netz-Eingang (Video, Medientypen `video/raw` und `video/SMPTE2022-6`), Generator-Flows als Source/Flow/Sender.
- Registrierung an einer Registry (`--nmos-registry http://…` oder per DNS-SD `_nmos-register._tcp`), Heartbeat 5 s, 404 → neu registrieren, 200 beim ersten Node-POST → alten Eintrag löschen. Bekanntgabe `_nmos-node._tcp`.
- IS-05 v1.1: staged/active/constraints/transporttype für Receiver; `transport_file` aktiviert den Eingang, `transport_params` (Multicast, Quelle, Port) schreiben das SDP um; sofort, absolut und relativ geplant. Für Generator-Sender: transportfile, ein/aus, neue Ziele.

Nicht gebaut: IS-10/BCP-003 (ohne Anmeldung, wie in den meisten Test-Aufbauten), Bulk-Aktivierung, Receiver für Audio/Anc (kommen mit #226/#227). **AMWA nmos-testing (IS-04-01, IS-05-01) ist noch nicht gelaufen**; die Tests in `test/st2110-nmos.test.ts` prüfen gegen eine Schein-Registry.

## Prüfung

- `test/st2110.test.ts`: SDP schreiben/lesen, Pakete → v210 bitgenau (8/10 bit, zwei SRD-Köpfe, Verlust), 2022-6-Rahmen, 2110-21-Formeln (1080p50 TPN: CMAX 5, VRXFULL 8; TPW: 16/720), Timing mit erzeugten Ankunftszeiten (normgerecht, Bündel, zu spät), ATC über `src/vanc.ts`, 2022-7, Loopback Generator → Empfänger über 127.0.0.1.
- `test/st2110-nmos.test.ts`: Node API, IS-05-Aktivierungen, Fehlerfälle, Registrierungsreihenfolge, HTTP-API.
- Ein Durchlauf Bridge → `st2110:net1` → `/stream` mit v210-Durchreichung lief lokal (25.11.2026, kleines Testbild).

**Nicht geprüft:** jede echte 2110-Quelle und jedes echte Empfangsgerät, Multicast über einen Switch (IGMP), 2022-7 mit zwei Netzen, 1080p im Software-Empfänger, NMOS gegen eine echte Registry oder nmos-testing, der Helfer in der gepackten App (Electron als Node aus dem asar-Archiv).
