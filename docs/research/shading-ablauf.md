# Shading-Assistent: geführter Ablauf, Black/Flare, Kameradaten (#151)

Stand 20.10.2026. Umsetzung von [scope-wuensche.md](scope-wuensche.md) Wunsch 6 (Kameradaten im Scope), Wunsch 8 (geführter Shading-Ablauf) und Idee 4 (Black-/Flare-Assistent). Code: `src/shading/guide.ts` (rein, `test/shadingGuide.test.ts`), `src/shading/guidePanel.ts` (Panel *Shading-Assistent*), `src/shading/bridge.ts` (Kameradaten), `src/shading/live.ts`.

**Nicht an einer echten Kamera geprüft.** Geprüft ist die Rechnung gegen synthetische Bilder (vitest) und das Panel mit Testbildern (e2e). Die Toleranzen sind gewählt, nicht genormt.

## Reihenfolge

Die Reihenfolge Schwarz → Black Balance → Graukeil → Weiß → Knie → Matrix folgt dem Kamera-Setup in der Tektronix-Application-Note *Camera Setup, Matching and Alignment* ([25W-27159](https://www.telestream.net/pdfs/app-notes/Camera-Setup-Matching-and-Alignment-Application-Note-25W271590.pdf)): Blende zu, Pedestal/Black setzen und Schwarzbalance, dann Graukeil und Weißabgleich bei offener Blende, Spitzlichter über Knie/White Clip. Dieselbe Reihenfolge nennen Praktiker in [r/VIDEOENGINEERING 13ik5e1](https://www.reddit.com/r/VIDEOENGINEERING/comments/13ik5e1/video_shading/); die Matrix zuletzt, nach Farbtafel ([16hdoql](https://www.reddit.com/r/VIDEOENGINEERING/comments/16hdoql/can_someone_explain_to_me_color_matrix_in_the/)). Der Flare-Schritt sitzt nach der Black Balance, weil er deren Messung bei geschlossener Blende als Bezug braucht.

## Messung

- Messrahmen (ohne Rahmen: mittleres Drittel, wie Rauschmessung und Fokus): Mittel von R′, G′, B′ und Y′ (BT.709-Gewichte bzw. die des Farbraums der Quelle).
- Knie: ganzes Bild, jeder n-te Pixel (höchstens ~250 000 Werte), höchster Kanalwert und Anteil der Werte mit einem Kanal ≥ 100 %.
- Flare: Differenz offen − zu des Messrahmens auf einem schwarzen Objekt, als ΔY′ und Verschiebung in Cb/Cr nach ITU-R BT.709-6 Punkt 3.3; Winkel wie am Vectorscope (0° = +Cb). Der Gedanke „Schwarz-Schwerpunkt bei zu und offen vergleichen“ stammt aus [1qtm2oq](https://www.reddit.com/r/VIDEOENGINEERING/comments/1qtm2oq/black_shading_question/); eine Primärquelle mit Zahlen gibt es dafür nicht.

## Gewählte Toleranzen

| Schritt | gilt als erledigt bei | Rat |
|---|---|---|
| Schwarz, Blende zu | 0,5 % ≤ Y′ ≤ 3,5 % | Master Black ↑/↓ |
| Black Balance | \|R′−G′\|, \|B′−G′\| ≤ 0,5 % | Black R/B gegen G |
| Flare | \|ΔY′\| und Farbverschiebung ≤ 0,3 % | Master Black ↓ bei Anhebung |
| Graukeil | \|R′−G′\|, \|B′−G′\| ≤ 1 % | keiner – der Bus hat kein Gamma je Kanal |
| Weiß | Y′ 90 % ± 3 %, Kanäle ± 1 % | erst Blende, dann White R/B |
| Knie | ≤ 0,2 % geclippt, Spitze ≤ 105 % | Kniepunkt/White Clip an der Kamera |
| Matrix | von Hand | – |

Die Ratschläge benutzen das Vokabular von lz-camera-bridge (`paintNudge.ts`); der Assistent sendet nichts, gedreht wird mit Touch Shading oder dem RCP.

## Kameradaten

Vorbild: Leader LV5600-SER27 (ID, Iris und Tally im Waveform-Monitor, [Produktseite](https://www.testequipmentdepot.com/leader-lv5600-ser27-internal-option-id-iris-and-tally-display-software-option-for-lv5600-units.html)). Quelle der Werte ist die `state`-Nachricht von lz-camera-bridge (`CameraState` in `packages/bridge/src/protocol/CcuClient.ts`: `iris`, `masterGain`, `ndFilter`, `shutterSpeed`) und `cameraTally` (`BridgeServer.ts`: `program`/`preview`/`off` je Kamera, aus dem Mischer abgeleitet). Iris ist der Buswert 0–255, Gain, ND und Shutter sind Indizes der Kamera – die Bridge liefert keine Einheit, also zeigt lz-scopes keine erfundene (keine Blendenzahl, keine dB). Farbtemperatur in Kelvin nur, wenn ein Backend sie meldet (`colorTemp` oder `colorTemperature`, z. B. Sony MNC); der CCU-Bus kennt sie nicht. Unbekannte Werte erscheinen als „–“.

Angezeigt im Panel *Shading-Assistent* (für das Touch-Shading-Ziel) und in der Touch-Shading-Leiste neben den Paint-Werten.

## Offen

- An einer echten Kamera prüfen (Tally aus einem echten Mischer, Iris-Rückmeldung, Flare mit Samt und Objektivdeckel) – #116.
- Kameradaten je Quelle in der Kachelansicht braucht eine Zuordnung Quelle ↔ Kamera, die es noch nicht gibt.
