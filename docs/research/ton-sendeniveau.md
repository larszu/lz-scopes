# Ton auf Sendeniveau: 64 Kanäle, Dolby, S-ADM, Abhören (#234)

Stand 25.11.2026.

## Umgesetzt

- **Nicht-PCM-Daten in Kanalpaaren** (`src/audio/dsp/s337.ts`): ST-337-Präambeln Pa/Pb in 16/20/24 Bit, Pc (Datentyp nach ST 338, Datenstrom, Fehlerbit), Pd (Länge), Abstand der Bursts. Für AC-3 und E-AC-3 im 16-Bit-Modus zusätzlich der Rahmenkopf nach ATSC A/52:2018 (§5.3 bzw. Anhang E): Abtastrate, Bitrate, Kanalbelegung (acmod + LFE), dialnorm, bsmod. Anzeige im Panel *Audio-Prüfung* links, Werte in `state.audio.nonPcm` der Control API.
  - Lage von Pc/Pd in 20/24 Bit: Pc linksbündig (obere 16 Bit), Pd rechtsbündig – so wie ffmpeg `libavformat/s337m.c` sie liest. Die Normtexte ST 337/338 lagen nicht vor.
  - Bedingung: der Weg ist bitgenau. DeckLink liefert s32 (24 Bit oben), ffmpeg wandelt s16/s24 → f32 verlustfrei. Jede Pegeländerung, Abtastratenwandlung oder Dither zerstört die Präambeln.
- **Abhören** (`src/audio/dsp/downmix.ts`): beim 🎧 eines Bridge-Stroms neben den Kanalpaaren „Stereo-Abmischung Lo/Ro“ (ITU-R BS.775-3, Tabelle 2), „Lt/Rt“ (A/52:2018 §7.8.2) und „Nur <Kanal>“ (Solo). Kanäle über 5.1 hinaus (Lb/Rb, Höhen, 22.2-Boden) gehen mit −3 dB in den nächsten der fünf Busse – eigene Festlegung, BS.775 deckt nur 3/2 ab. Keine Normalisierung, die Abmischung kann übersteuern; gemessen werden die Rohkanäle.
- **Viele Kanäle**: Die Pegelanzeige wird ab 17 Kanälen schmaler (1 px Abstand, Beschriftung jedes k-ten Kanals) und passt so bis 64 Kanäle. Messung, Lautheit und Ident waren schon kanalzahlunabhängig. Bis 16 Kanäle sieht das Panel aus wie vorher.

## Nicht umgesetzt – mit Grund

- **Dolby-E-Inhalt**: ffmpeg hat einen freien Decoder (`dolby_e`, LGPL) und den Demuxer `s337m`; beide sind in unserem Build. Die Bridge leitet aber Kanalpaare nicht durch ihn – dafür müsste sie ein Paar als `s337m`-Rohstrom an ein zweites ffmpeg geben und die dekodierten 6–8 Kanäle als eigene Tonquelle zurückschicken. Die Dolby-E-Metadaten (Programmkonfiguration, Bildrate, dialnorm je Programm) liegen verschlüsselt (Key-XOR) im Rahmen und werden hier nicht gelesen. Anzeige heute: „Dolby E“, Strom, Bittiefe, Burst-Abstand (40 ms = 25 B/s).
- **Dolby Atmos (E-AC-3 JOC)**: erkennbar nur über EMDF-Nutzdaten hinter den Audioblöcken; nicht ausgewertet. ffmpegs `eac3` dekodiert den 5.1/7.1-Kern, nicht die Objekte. Ein Atmos-Renderer ist nicht frei verfügbar.
- **ED2**: keine öffentliche Spezifikation.
- **Serial ADM** (ST 2116 über 2110-31, ST 2127 über 2110-41): braucht AES3-Transparenz bzw. den 2110-41-Empfang; beides fehlt (Epic #225, #227). Der ADM-Parser (BS.2076) wäre danach eigene Arbeit.
- **Raum-Meter mit Lautsprecherbelegung** (7.1.4, 9.1.6, 22.2): Die Richtungen je Kanal stehen schon in `layouts.ts` (BS.2051); ein eigenes Panel ist offen.
- **Mehrere Flows je Service**: hängt an der 2110-30-Mehrfachannahme.
- **64 Kanäle über DeckLink**: der Helfer nimmt 2/8/16/32 Kanäle an (`server/helper-input.mjs`); ob eine Karte mehr liefert, ist ungeprüft. 64 Kanäle kommen nur über ffmpeg-Quellen (SDP/2110-30, MADI-Gerät).

## Ungeprüft

Alles mit synthetischen Bursts getestet (`test/s337.test.ts`), nichts mit echtem Dolby-E- oder AC-3-Material über SDI oder 2110-30.
