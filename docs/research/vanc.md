# SDI-Zusatzdaten (VANC) – Quellen und Stand (#160)

Umsetzung: `helpers/decklink/lz-decklink.cpp` (`sendVanc`), `server/helper-input.mjs` (`VANC` → `{type:'vanc'}`), `src/vanc.ts` (Parser), `src/sdiPanel.ts` (Panel *SDI-Signalinfo*), Tests `test/vanc.test.ts`, `test/devices.test.ts`, `e2e/sdi.spec.ts`.

**Stand: mit keiner Karte gelaufen.** Die Fixtures sind aus den Bit-Tabellen gebaut, nicht mitgeschnitten. Hardwaretest: #116.

## Weg der Daten

- DeckLink SDK 12.0 (`DeckLinkAPI.h`): `IDeckLinkVideoFrameAncillaryPackets::GetPacketIterator`, `IDeckLinkAncillaryPacket::GetDID/GetSDID/GetLineNumber/GetDataStreamIndex`, `GetBytes(bmdAncillaryPacketFormatUInt8)` liefert die Nutzdatenwörter (UDW) als untere 8 Bit. Prüfsumme, Paritätsbits und ADF kommen nicht an; CRC/EDH/TRS bleiben außen vor (siehe Issue, „Out of scope“).
- Der Helfer schickt die Pakete als JSON, wenn sich die Menge (DID/SDID/Zeile) ändert, sonst höchstens alle 250 ms.
- Blackmagic-Forum: Bei als HDR gekennzeichneten Ausgabebildern erzeugt der Treiber selbst ein ST-2108-1-Paket ([forum.blackmagicdesign.com](https://forum.blackmagicdesign.com/viewtopic.php?p=1027643)) – beim Eingang offen, ob der Treiber ST 352/2108 durchreicht oder schon auswertet.

## SMPTE ST 352 (Payload-ID), DID 41h / SDID 01h

- Aufbau Byte 2–4, Tabelle 2 (Bildrate), Tabelle 3 (Abtastung), Bittiefe Byte 4 b1–b0, Kanal b7–b5: SMPTE ST 352:2013, §5.3–5.5 ([drastic.tv-Kopie](https://www.drastic.tv/images/documentation/st0352-2013.pdf)).
- Byte-1-Codes: Liste in ST 352:2013 §5 (84h–8Ah) und Register der SMPTE RA ([smpte-ra.org](https://smpte-ra.org/video-payload-id-codes-serial-digital-interfaces)); die weiteren Codes (81h–83h, 8Bh–98h, C0h–D2h) aus dem AJA-SDK (`ntv2enums.h`, `VPIDStandard`, [libajantv2](https://github.com/aja-video/libajantv2)). Unbekannte Codes zeigt das Panel als Hex, ohne Namen.
- Übertragungskennlinie Byte 2 b5–b4 (00 SDR, 01 HLG, 10 PQ, 11 nicht angegeben), Farbraum Byte 3 b5–b4 (00 Rec.709, 01 reserviert, 10 UHDTV/Rec.2020, 11 unbekannt), ICtCp Byte 4 b4: nach ST 425-1:2017 / ST 2081-10 / ST 2082-10, übernommen aus den Masken in AJAs `ntv2publicinterface.h` (`kRegMaskVPIDXferChars`, `kRegMaskVPIDColorimetry`, `kRegmaskVPIDLuminance`). Für 1,5-G-basierte Payloads (85h, 87h, 8Ah, 96h, 98h) liegt der Farbraum verteilt in Byte 3 b7 + b4 und das Seitenverhältnis in b5 (`CNTV2VPID::GetColorimetry`). Die Normtexte selbst lagen nicht vor – deshalb **ungeprüft gegen den Normtext**.
- Bittiefe 3h: AJA führt sie als „12 bit full“ (6G/12G) bzw. „10 bit full ST 292“; das Panel zeigt dann 12 bzw. 10 bit.

## SMPTE ST 2108-1 (HDR/WCG), DID 41h / SDID 0Ch

- DID/SDID und Rahmenaufbau (Typ, Länge j, Daten) nach ST 2108-1:2018 ([drastic.tv](https://drastic.tv/images/documentation/st2108-1-2018.pdf)) und VideoLAN bitstream `smpte/2108.h` ([Commit-Mail Juli 2026](https://mailman.videolan.org/pipermail/bitstream-devel/2026-July/000189.html)).
- Typ 00h statisch 1: SEI 137 (Mastering Display Colour Volume, H.265 D.2.28), Länge 26; Primärvalenzen in der Reihenfolge G, B, R, Einheit 0,00002; Leuchtdichte in 0,0001 cd/m².
- Typ 01h statisch 2: SEI 144 (Content Light Level), Länge 6: MaxCLL, MaxFALL in cd/m².
- Typ 02h–06h dynamisch 1–5 (ST 2094-10 … SL-HDR): nur als vorhanden gemeldet, nicht ausgewertet.

## SMPTE ST 12-2 (ATC), DID 60h / SDID 60h

- 16 UDW, je Wort b7–b4 ein Halbbyte der 64 Timecode-Bits aus ST 12-1 (UDW1 = Bits 0–3 …), b3 die verteilten Binärbits DBB1 (UDW1–8, Payload-Typ: 00h LTC, 01h VITC1, 02h VITC2) und DBB2 (UDW9–16). Drop-Frame Bit 10, Colour-Frame Bit 11 (wie LTC). Quelle: Aufbau von ST 12-2 (Bitlage wie ST 12-1/LTC, vgl. `src/clock/timecode.ts`); der Normtext lag nicht vor – ungeprüft gegen den Normtext.

## Weitere Kennungen (ST 291-Register)

- ST 2016-3 AFD/Bar Data: DID 41h / SDID 05h; UDW1 b6–b3 AFD-Code, b2 Seitenverhältnis des Rahmens.
- ST 334-1: 61h/01h CEA-708 (CDP), 61h/02h CEA-608.
- ST 299-1: HD-Audio Daten E7h–E4h (Gruppe 1–4), Steuerung E3h–E0h; ST 299-2 (3G): A7h–A4h (Gruppe 5–8), A3h–A0h.
- Register: [smpte-ra.org ST 291](https://smpte-ra.org/smpte-ancillary-data-smpte-st-291).

## Weitere Pakete (#235), `src/anc.ts`, `src/teletext.ts`

- **SCTE 104 (ST 2010)**, DID 41h / SDID 07h: Payload-Descriptor-Byte (Version, continued/following/duplicate), dann single oder multiple operation message (Kennung FFFFh). Ausgewertet: splice_request (Typ, Ereignis-ID, Programm, Vorlauf ms, Pausendauer 1/10 s, automatische Rückkehr), time_signal (Vorlauf), insert_segmentation_descriptor (Ereignis, Dauer, segmentation_type_id, Segment n/m); Zeitstempel UTC/VITC/GPI. Aufbau nach libklvanc `src/core-packet-scte_104.c` (gelesen 25.11.2026); der SCTE-104-Text selbst lag nicht vor. Nachrichten über mehrere Pakete (continued_pkt) werden nur als „geht weiter“ gemeldet, nicht zusammengesetzt.
- **CEA-708 CDP (ST 334-2)**, 61h/01h: Kennung 9669h, Bildrate, Flags, Folgezähler, Zeitcode-Abschnitt 71h, cc_data 72h (Tripel je cc_type), Prüfsumme (Summe ≡ 0 mod 256). Aufbau nach libklvanc `core-packet-eia_708b.c`. Untertiteltext (608/708) wird **nicht** dekodiert: der Helfer schickt höchstens alle 250 ms einen Schnappschuss, nicht jedes Bild – ein 608-Decoder bekäme Lücken.
- **Halbbilder vertauscht** (Hinweis, keine Messung): 608-Steuercodes beginnen in Halbbild 1 mit 14h/1Ch (CC1/CC2), in Halbbild 2 mit 15h/1Dh (CC3/CC4). Codes des jeweils anderen Halbbilds → Warnung. Eigene Ableitung aus CEA-608 (Kanalzuordnung der Steuercodes).
- **OP-47 / RDD 8**, 43h/02h: Kennung 51h 15h, Länge, Formatcode, fünf Strukturdeskriptoren (b7 Halbbild, b4–b0 Zeile), je belegtem Deskriptor 45 Byte (Einlauf 55h 55h 27h + 42 Videotext-Byte), Fußkennung 74h, Folgezähler, Prüfsumme. Nach libklvanc `core-packet-sdp.c` und ffmpeg `libavdevice/decklink_dec.cpp`.
- **ST 2031**, 41h/08h: SMPTE ST 2031:2015 §5–6 ([drastic.tv](https://www.drastic.tv/images/documentation/st2031-2015.pdf)): UDW = data_identifier, data_unit_id, data_unit_length, data_field() nach EN 301 775, je Paket ein data_field; Tabelle 2 der data_unit_id. txt_data_field: field_parity, line_offset, framing_code E4h, 42 Byte bitgespiegelt (EN 300 472).
- **Videotext** (EN 300 706): Hamming 8/4 mit Einzelfehlerkorrektur, Seitenkopf (Seite, C4 Löschen, C6 Untertitel, Länderzeichensatz C12–C14), 40 Zeichen mit ungerader Parität. Die Zeilen werden über mehrere Schnappschüsse gesammelt; angezeigt wird die neueste Untertitelseite mit Paritäts- und Hamming-Fehlerzählern.
- **EDH (RP 165)**, DID F4h: CRC-Wörter (aktives Bild, ganzes Halbbild, je Gültigkeitsbit) und die drei Fehlerbit-Wörter (EDH, EDA, IDH, IDA, UES). Lage aus Sekundärquellen, RP 165 lag nicht vor. Die CRC selbst nachrechnen geht nicht – dafür fehlen die Bildabtastwerte. Nur SD; ob der DeckLink-Treiber das Paket überhaupt durchreicht, ist offen.

Nicht umgesetzt: Untertitel ins Bild legen, 608/708-Decoder mit Decoder-Log, Teletext OP-42 in SD-VBI-Zeilen (braucht die rohen VBI-Zeilen, die der Helfer nicht liefert), Ancillary-Sync (Versatz von Untertiteln/Zeitcode zu Bild und Ton), Quelle 2110-40 (#227).

## Offen

- Hardwaretest (#116): Liefert `GetBytes(UInt8)` beim Eingang auch für ST 352 und Audio-Pakete Daten, oder behält der Treiber sie? Stimmen die Zeilennummern?
- ST 352 von 2081/2082 mit Normtext abgleichen, sobald verfügbar.
