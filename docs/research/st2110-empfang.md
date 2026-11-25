# ST 2110 aus dem Netz: Ton, Zusatzdaten, ST 2022-7, pcap (#226, #227, #230, #232)

Teil von Epic #225. Umsetzung: `server/sdp.mjs` (SDP, `st2110:`-URL), `server/st2110.mjs` (Nutzlast-Dekoder, ST-2022-7-Auswertung, Empfänger), `server/st2110stream.mjs` (Service am Frame-Socket), `server/pcap.mjs` (Mitschnitt), `src/st2110.ts` (Dialog, Karte, Messwerte-Zeilen). Tests: `test/st2110.test.ts` (Einheit + Loopback durch echte UDP-Sockets und die Bridge), `e2e/st2110.spec.ts` (App: Dialog → Bridge → Lautheit → pcap).

**Stand: an keiner echten 2110-Anlage gelaufen.** Alle Pakete in Tests und e2e sind selbst erzeugt, über 127.0.0.1. Als fremde Sender liefen GStreamer `rtpL24pay` und ffmpeg `-f rtp` (pcm_s24be → L24), beide ohne Lücke und mit richtigem Pegel (Tests überspringen sich ohne die Werkzeuge). Für ANC gibt es in GStreamer hier nur den Depayloader `rtpsmpte291depay`, keinen Sender: 2110-40 ist nur mit eigenen RFC-8331-Paketen geprüft. Kein AES67-Gerät, kein PTP-Grandmaster, kein 2022-7-Netz mit zwei Wegen. Multicast-Beitritt auf einer echten Netzwerkkarte, IGMPv3/SSM am Switch und Raten über 48 kHz × 8 Kanäle sind ungeprüft.

## Quelle

`st2110:?…` als Quell-URL:

- `sdp=<SDP>` (wiederholbar, ein SDP-Objekt je Flow wie in ST 2110-10), oder
- `audio=<Gruppe:Port>[,<Gruppe:Port>]&fmt=L24|L16|AM824&rate=48000&ch=2&order=SMPTE2110.(ST)`
- `anc=<Gruppe:Port>[,<Gruppe:Port>]`
- `iface=` / `iface2=`: lokale IPv4-Adresse je Weg.

Die zweite Adresse eines Paars ist der Redundanzweg nach ST 2022-7. `@Sender` hinter der Adresse ergibt quellspezifischen Multicast (`addSourceSpecificMembership`, RFC 4570 `a=source-filter`). In der UI: Quellkarte *RTSP / Netz* → **ST 2110…**.

## Normen und Stellen

Öffentlich und gelesen: RFC 3550 (RTP-Kopf §5.1, Jitter §6.4.1/A.8), RFC 3190/3551 (L16/L24 big endian, Kanäle verschachtelt), RFC 4566/8866 (SDP), RFC 4570 (source-filter), RFC 5888 + RFC 7104 (`a=group:DUP`, so signalisiert ST 2110-10 die 2022-7-Kopien), RFC 8331 (ANC über RTP: Kopf, Paketfelder, 10-Bit-Wörter, Parität, Prüfsumme, 32-Bit-Ausrichtung, F = 0b01 ungültig).

SMPTE (kostenpflichtig, Angaben nach Abschnitt im Code-Kommentar): ST 2110-30 (Raten, `channel-order` und Symbole Tabelle 1), ST 2110-31 (AM824-Unterrahmen, `<nchan>` gerade, Symbol AES3), ST 2110-40 (fmtp `DID_SDID`, `VPID_Code`, `exactframerate`), ST 2110-41 (Data Item: Typ 22 Bit, K 1 Bit, Länge 9 Bit in 32-Bit-Wörtern), ST 2022-7:2019 (PD, MD, Klassen A 10 ms, B 50 ms, C 450 ms SBR / 150 ms HBR, D 150 µs). Gegen den Normtext erneut prüfen, sobald er vorliegt:

- AM824-Parität: angenommen ist die gerade Parität von AES3 über Zeitschlitz 4–31 (AES3-3 lag nicht vor).
- 22.2-Kanalnamen (ST 2036-2): nur als Nummern geführt.

## Was gemessen wird

- **Ton** (2110-30/-31): L16/L24 bzw. AM824 → float32 ohne Umtastung, als Protokoll-2-Tonpakete in die vorhandene DSP-Kette (Lautheit, True Peak, Goniometer, Ident-Erkennung). Der Probenindex kommt aus dem RTP-Zeitstempel; eine Lücke auf allen Wegen wird zum Sprung im Index (Frame-Protokoll). Kanalfolge aus `channel-order`; ist sie eine einzige bekannte Gruppe (M, ST, 51, 71), bekommt die Tonmessung das passende Layout. AM824: V-Bit, Blockanfang (B) und Paritätsfehler werden gezählt; Kanalstatus und User-Bits werden noch nicht ausgewertet.
- **Zusatzdaten** (2110-40): RFC-8331-Pakete → `{type:'vanc'}` wie beim DeckLink-Helfer, also derselbe Decoder (`src/vanc.ts`: ST 352, 2108-1, ST 12, AFD, CEA-608/708). Prüfsumme und Parität werden geprüft und gezählt. Zeitbezug: RTP-Zeitstempel gegen die PTP-Zeit der Bridge (`rtpCheck`, ST 2110-10), sofern das SDP `exactframerate` nennt. Ohne PTP-Empfang ist das die Systemuhr.
- **Fast Metadata** (2110-41): Data Items werden gezählt (Typ, Anzahl); der Inhalt bleibt uneingesehen.
- **ST 2022-7**: Kopien über die Sequenznummer zugeordnet (Annex A), RTP-Zeitstempel zusätzlich verglichen. Angezeigt: Wegversatz B − A (aktuell, min/max, letzte 10 s), PD max, Jitter je Weg (RFC 3550), Pakete nur auf A / nur auf B, auf beiden verloren, verspätete Kopien. Daraus: nötiger Empfängerpuffer (≥ PD max) in ms und Paketen und die Klasse nach Tabelle 1. Ein Paket gilt als „nur auf einem Weg“, wenn die Kopie 1 s nach der ersten nicht da ist.
- **pcap**: Schnappschuss aller Flows eines Service (Ton, Anc, beide Wege) mit Zeit- und Größengrenze, Ringpuffer als Segmentdateien auf der Platte, Sichern auf Knopfdruck. Format: klassisches pcap mit Nanosekunden (Magic 0xa1b23c4d), Linktyp 228 (rohes IPv4). Download über die Quellkarte und `/api/st2110/*` (docs/control-api.md).

## Grenzen

- **Zeiten sind Software-Empfangszeiten** der Bridge (Node-Ereignisschleife), keine Zeitstempel der Netzwerkkarte. Wegversatz und Jitter taugen damit für etwa 0,1–1 ms. Klasse D (150 µs) lässt sich so nicht nachweisen; unter 0,15 ms zeigt die Anzeige deshalb A. Belastbar erst mit Hardware-Zeitstempeln (#231).
- **pcap ohne Rohsocket**: Die Bridge sieht nur die UDP-Nutzlast, den Absender und ihre eigene Gruppe/Port. IPv4- und UDP-Kopf werden nachgebaut (TTL, DSCP, IP-ID und Ethernet stimmen nicht mit der Leitung überein), pcapng mit Hardware-Zeitstempeln fehlt (#231). Für Paket-Timing-Analysen (ST 2110-21) ist so ein Mitschnitt ungeeignet.
- Mitschnitte landen im Temp-Ordner (`LZS_PCAP_DIR` oder Systemtemp `/lz-scopes-pcap`), höchstens 20 gesicherte Dateien. Sie enthalten Anlagen-Adressen: nie ins Repo, nie als Fixture.
- Video (2110-20) und NMOS IS-05 fehlen noch (#228, Bridge #293–#295). Alarm-gesteuertes Sichern des Ringpuffers hängt an #239.
