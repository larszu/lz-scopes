# Uhr, Timecode, LTC und PTP (Issue #28)

Stand 30.09.2026. Nur Quellen, die für diese Arbeit geöffnet wurden.

## Quellen

| Quelle | Wofür | Lizenz/Zugang |
|---|---|---|
| SMPTE ST 2059-1:2021, pub.smpte.org/pub/st2059-1/st2059-1-2021.pdf | Epoche, Alignment, Timecode aus PTP-Zeit, DF/NDF, Daily Jam | frei zugänglich |
| SMPTE ST 2059-2:2021, pub.smpte.org/latest/st2059-2/st2059-2-2021.pdf | PTP-Profil: Domain, Intervalle, SM-TLV, Annex A (timeOfNextJam) | frei zugänglich |
| SMPTE ST 2110-10:2022, pub.smpte.org/latest/st2110-10/st2110-10-2022.pdf | RTP-Zeitstempel, Offset 0 zur Epoche | frei zugänglich |
| SMPTE ST 2110-20:2022, pub.smpte.org/latest/st2110-20/st2110-20-2022.pdf | RTP-Takt 90 kHz | frei zugänglich |
| IERS Bulletin C 72 (datacenter.iers.org/data/latestVersion/bulletinC.txt) und Leap_Second.dat (hpiers.obspm.fr/iers/bul/bulc/Leap_Second.dat) | TAI − UTC | frei |
| IANA multicast-addresses und service-names-port-numbers | 224.0.1.129 „PTP-primary“, Ports 319 „ptp-event“, 320 „ptp-general“ | frei |
| Wireshark `epan/dissectors/packet-ptp.c` (gitlab.com/wireshark) | Byte-Offsets der PTPv2-Nachrichten (IEEE 1588 ist nicht frei) | GPL – nur Fakten übernommen, kein Code |
| RFC 3550 §5.1 | RTP-Kopf, Zeitstempel an Byte 4–7 | frei |
| EBU Tech 3097-E (3. Ausg. 1982), tech.ebu.ch/docs/tech/tech3097.pdf | LTC: Biphase-Mark, 80 Bit, Bitbelegung, Sync-Wort, Phasenkorrekturbit | frei |
| Wikipedia „Linear timecode“ (zitiert ITU-R BR.780-2) | SMPTE-Abweichungen: Bit 10 Drop-Frame, Polaritätsbit 27 bei 24/30 fps | CC BY-SA, nur Fakten |
| DaVinci Resolve Scripting README und `DaVinciResolveScript.pyi` (lokale Installation) | `timelineFrameRate`, `timelineDropFrameTimecode`, `GetCurrentTimecode()` | Blackmagic, nur API-Namen |
| Telestream-Whitepaper „PTP System Commissioning: Grandmaster Changeover“ (telestream.net/pdfs/whitepapers/…PTP-System…pdf) | Was ein PRISM zeigt: Grandmaster-ID, BMCA-Werte (Priority 1, Clock Class, Accuracy, Priority 2), Lock, „Offset from Leader“-Graph | Produktvergleich |

ITU-R BR.780-2 selbst war über die ITU-Adresse nicht abrufbar (HTML statt PDF); IEEE 1588-2008/2019 und SMPTE ST 12-1 sind nicht frei und wurden nicht gelesen.

## Normwerte im Code

- Epoche: 1970-01-01 00:00:00 TAI = PTP-Epoche; 63 072 010 s vor 1972-01-01T00:00:00Z (ST 2059-1 §6.1). Test: `utcToPtp(1972-01-01Z) = 63072010`.
- Alignment: `NextAlignmentTime = (floor(t/AlignmentPeriod) + 1) × AlignmentPeriod`, Beispiel 50 Hz bei ganzer Sekunde → +20 ms (§6.2). LTC-Bit: `floor(t × 80 × Ff) % 80` (§9.2).
- Timecode: §9.3.2 Schritte 1–5 über den vorigen Daily Jam; §9.3.3.4 DF: `1798 × MM + 2 × floor(MM/10) + 107892 × HH`. Rundreise über einen ganzen Tag getestet.
- SM-TLV (ST 2059-2 Tabelle 2): 48 Byte ab Offset 48 der Management-Nachricht, organizationId 68 97 E8, Subtyp 00 00 01; Beispiel `defaultSystemFrameRate` 30000/1001 = `00 00 75 30 00 00 03 e9`; currentLocalOffset-Beispiel EST 2014 = −18035, EDT = −14435 (beides Test).
- Profil-Standardwerte: Domain 127 (0–127), logAnnounceInterval 0, logSyncInterval −3, announceReceiptTimeout 3 (§6.5).
- TAI − UTC = 37 s seit 2017-01-01; Bulletin C 72: keine Schaltsekunde Ende Dezember 2026; Tabelle „expires on 28 June 2027“. Danach zeigt die UI „Tabelle abgelaufen“.
- ST 2110: RTP-Takt 90 kHz (2110-20 §6.1.3), Offset 0 zur Epoche (`a=mediaclk:direct=0`, 2110-10 §7.3/§8.3), Video-Zeitstempel = RTP-Takt am Alignment-Punkt, abgeschnitten (§7.6.1, §7.6.4; 60/1,001: Schritte 1501/1502).

## Beobachtungen

1. **ST 2059-2 §6.13.3 Note 1 und ST 2059-1 Schritt 1.5 passen nicht ganz zusammen.** Note 1 sagt, `timeOfPreviousJam = 0` mit `previousJamLocalOffset = currentLocalOffset` ergebe Adressen gleich der Lokalzeit. Schritt 1.5 setzt beim Jam aber `SS = 0`; liegt der Jam bei PTP-Zeit 0, ist die Lokalzeit des Jams gleich dem Offset (z. B. 7163 s = 01:59:23) und die Sekunden gehen verloren – die Adressen laufen dann 23 s nach. Mit einem Jam nach Annex A (Vielfaches von 10 Minuten Lokalzeit) tritt das nicht auf. Test „observation …“ in `test/clock.test.ts`.
2. ST 2059-1 definiert LTC-Codewortraten nur bis 30 Hz. Für 50/60 fps zählt die Uhr 0…49/59 (bei 59,94 DF 4 Nummern pro Minute ausgelassen) – gängige Konvention, in der UI gekennzeichnet.
3. Sync (Port 319) und Follow_Up (Port 320) kommen auf verschiedenen Sockets an; die Reihenfolge ist nicht garantiert. Der Monitor merkt sich deshalb beides.
4. ffprobe liest den MOV-Start-Timecode (tmcd) über HTTP nur, wenn der Server Range-Anfragen kann (Python `http.server` kann es nicht → Tag fehlt).
5. ffmpeg `showinfo=checksum=0` gibt je Bild `n`, `pts_time` und die Seitendaten aus („GOP timecode“ bei MPEG-2, „SMPTE 12-1 timecode“ bei H.264/HEVC-SEI). Mehraufwand gemessen: vernachlässigbar (1080p MPEG-2, 10 s Material: 1,33 s ohne, 1,00 s mit showinfo – Messstreuung, CPU-Zeit gleich). Die SEI-Zeile ist ungeprüft – keine Testdatei mit S12M-SEI erzeugbar (libx264 schreibt keinen).
6. macOS: Ports 319/320 lassen sich ohne root an 0.0.0.0 binden (lokal geprüft), `reuseAddr` gesetzt. Unter Linux brauchen Ports < 1024 root oder `CAP_NET_BIND_SERVICE`; die Fehlermeldung sagt das.
7. Software-Zeitstempel: Offset und Mean Path Delay sind Schätzungen (Jitter im Test über Multicast-Loopback 0,5–2 ms). Die UI schreibt „Schätzung“ und „inkl. Laufzeit“, solange keine Delay_Resp gemessen ist. Delay_Req sendet die Bridge nur auf Wunsch.

## Produkte

Telestream PRISM zeigt im PTP-Bereich Grandmaster-ID, Domain, BMCA-Werte, Lock und den Verlauf „Offset from Leader“ (Whitepaper, Figuren 2, 4–6). Das Uhr-Panel übernimmt diese Gliederung; einen eigenen Regelkreis (Lock der eigenen Uhr) hat es nicht und behauptet ihn nicht.

## Lizenzen

Eigener Code für PTP, LTC und Timecode. Nicht verwendet: node-ptpv2 (laut Issue GPL, kann Domain 127 nicht – nicht erneut geprüft), linuxptp (GPL), libltc (nicht geprüft, nicht verwendet), Wireshark (GPL, nur Offsets als Fakten).
