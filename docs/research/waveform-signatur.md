# Signatur in der Waveform („SMPTE 75 % (LZ)“)

Stand: 01.10.2026.

## Recherche (geöffnet)

- Websuche „hidden text waveform monitor test pattern“: keine dokumentierte Video-Waveform-Signatur gefunden. Bekannt ist das Prinzip aus dem Audio (Bild/Text im **Spektrogramm**, z. B. img2sound.com) und die Waveform als Grafik (Apple Voice-Memos-Icon = Waveform des Wortes „Apple“ – laut Suchergebnis, nicht weiter geprüft).
- Grundlage der Umsetzung ist die Definition der Luma-Waveform selbst: x = Bildspalte, y = Pegel (Nobe OmniScope Doku „Waveform“, docs.timeinpixels.com/nobe-omniscope/scopes/waveform; Frame.io Workflow Guide „Video Scopes“).

## Umsetzung

Ein Buchstabe entsteht, wenn in einer Bildspalte genau die Pegel vorkommen, die den gesetzten Pixeln einer Glyphenspalte entsprechen. Im Schwarzfeld der unteren Reihe (zwischen +Q und PLUGE, 18 % der Bildbreite) bekommen die Zeilen einer Spalte reihum die Pegel der aktiven Glyphenzeilen. Drei Zeilen „Lars Zumpe / Medien- / produktion“, eigene 5×7-Schrift, je Glyphenzeile ein 10-bit-Code (0,11 %), Bereich 71…97 = 0,8…3,8 % – unter der +4-%-Stufe der PLUGE.

- Am Monitor praktisch schwarz: 3,8 % ergibt mit BT.1886 (γ 2,4) 0,04 % der Spitzenleuchtdichte.
- Lesbar mit der Schwarz-Lupe (−5…15 %); in der normalen Waveform als Fleck knapp über 0 %.
- Balken (75 % = 10-bit 721), Mittelreihe, −I/Weiß/+Q und PLUGE (48/64/80/64/99/64) unverändert; die Scopes bekommen den 16-bit-Frame (exakte Codes), das Ausgabefenster die 8-bit-Fassung (Signatur dort auf 8-bit-Stufen gerundet).
- Das normgerechte Original „SMPTE 75 % Balken + PLUGE“ bleibt wählbar; „(LZ)“ ist das Start-Testbild.
