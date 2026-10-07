# Touch Shading (#54)

Stand 06.10.2026. Kamerasteuerung direkt an den Scopes: in der Parade die Spur eines Kanals greifen und ziehen, am Vectorscope drehen.

## Entscheidung: über lz-camera-bridge, nicht an der Kamera vorbei

LZ Scopes spricht keine Kamera selbst an. Es verbindet sich mit dem WebSocket von `larszu/lz-camera-bridge` (`ws://<host>:9700`, `BridgeServer.ts`), liest dort Kameraliste und Zustand und schickt dieselben Kommandos wie Web-RCP und Companion:

| Geste | Wert (Feld im Bridge-Zustand) | Kommando der Bridge |
|---|---|---|
| Parade, Kanal unten greifen | Black R/G/B | `setBlackBalance {r,g,b}` |
| Parade, Kanal oben greifen | White R/G/B | `setWhiteBalance {r,g,b}` |
| Luma-Waveform, Schatten (< 30 %) | Master Black | `setMasterBlack {value}` |
| Luma-Waveform, Mitten | Master Gamma | `setMasterGamma {value}` |
| Luma-Waveform, Lichter (> 70 %) | White R = G = B | `setWhiteBalance {r,g,b}` |
| Vectorscope, radial | Saturation | `setSaturation {value}` |
| Vectorscope, drehen | Hue | **kein Kommando im Bus** – nur Simulator |

Gründe:
- Hausregel „kein zweites Vokabular“. Die Bridge hat für jeden Wert genau eine Skala (0..255, Mitte 128, `protocol/paintNudge.ts`) und je Backend die Umrechnung. Eine zweite Steuerung in LZ Scopes müsste jede Kamera noch einmal lernen.
- Herkunft der Werte: Die Bridge unterscheidet „vom Gerät gelesen“ und „nur geschickt“ (`protocol/valueOrigin.ts`). LZ Scopes nimmt die Ausgangswerte aus ihrem Zustand. Was die Kamera nie gemeldet hat, wird nicht verstellt (wie `no-current-value` beim Nudge).
- Black- und White-Balance laufen im Bus als Tripel. Wer eine Achse ändert, schickt die beiden anderen mit. Sind nicht alle drei bekannt, wird nichts geschickt.

Welche Werte ein Ziel kann, steht als Auszug der Fähigkeitstabelle der Bridge (`packages/web-rcp/src/capabilities.ts`, Paint-Spalten) in `src/shading/model.ts`. Ändert sich die Bridge, ändert sich zuerst ihre Tabelle.

Die Bridge wurde dafür nicht geändert. Gegen eine echte Bridge mit Demo-Kamera geprüft: `CameraBridgeLink` liest Liste und Zustand, `setWhiteBalance` kommt an, der Zustand meldet den neuen Wert (als `commanded`), das Zurücksetzen stellt ihn wieder her.

## Die Sony SRG-A40 (gemessen 07.10.2026)

- **HTTP-CGI hat Weißabgleich:**
  - Die Kamera (Firmware 4.00) beantwortet `inquiry.cgi?inq=imaging` mit `WhiteBalanceMode`, `WhiteBalanceCrGain` und `WhiteBalanceCbGain` (0..255), dazu Detail, Belichtung, Rauschminderung und Defog.
  - `imaging.cgi` setzt die Werte (Antwort 204).
  - Die zuerst geöffneten Seiten der Befehlsliste hatten diesen Abschnitt nicht, die Kamera hat ihn.
- **Hue, Sättigung, Schwarz, Gamma:** Die Inquiry meldet sie nicht. Über die CGI gibt es sie an dieser Kamera nicht.
- **Zuordnung am Bild gemessen** (Mittelwert des RTSP-Bilds, manueller Weißabgleich ab Cr 203 / Cb 179):

| Änderung | R′ | G′ | B′ |
|---|---|---|---|
| Ausgang | 0,52 | 0,51 | 0,51 |
| CrGain +30 | 0,90 | 0,28 | 0,40 |
| CbGain +30 | 0,46 | 0,47 | 0,75 |

  Also **Cr = R, Cb = B**. Beide wirken wie Farbdifferenz-Verstärkungen: G′ läuft gegenläufig. Ein G-Gain fehlt.
- **Steilheit:** Eine Bus-Einheit bewegt R′ etwa 6,2-mal und B′ etwa 4-mal so weit wie im Simulator-Modell. `MEASURED_SLOPE` in `model.ts` trägt diese Faktoren, damit die Spur dem Finger folgt.
- **In der Bridge:** `HttpCgiClient` (Familie `sony`) kann seit lz-camera-bridge #78 `setWhiteBalance` (R/B) und liest beide Gains zurück. Die Werte kommen als `confirmed` an. LZ Scopes führt diesen Weg als `http-cgi:sony`: White R und White B, kein White G.
- **Folgen für die Gesten an der Sony:**
  - Parade: Rot oben = White R, Blau oben = White B.
  - Grün, Black und alles an der Luma-Waveform werden mit Grund abgelehnt. Lichter bräuchten White G, Schatten Master Black.
- **VISCA over IP** (UDP 52381) antwortete aus diesem Netz nicht. Die VISCA-Byte-Zuordnung bleibt deshalb ungeprüft.
- **Live-Messung über Bridge und LZ Scopes** (Parade, Mittelwert des oberen Bilddrittels):
  - Rot von 62 % auf 72 % gezogen → CrGain 203 → 211, R′ 0,617 → 0,715.
  - Blau um 8 % runtergezogen → CbGain 179 → 170, B′ 0,603 → 0,575.
  - „Ausgangswerte“ setzt 203/179 zurück, R′ 0,623.
  - Die Parade in LZ Scopes zeigt die Änderung mit einigen Sekunden Verzug: RTSP über die Bridge, auf 10 fps begrenzt.
- **Danach:** Kamera auf den gesicherten Ausgangszustand zurückgesetzt (WB auto, alle Imaging-Werte identisch) und in Standby versetzt.

## Andere Steuerwege

- **Blackmagic SDI Camera Control Protocol** (offen dokumentiert, Handbuch „Blackmagic 3G-SDI Shield for Arduino“, Studio Camera Control Protocol):
  - Gruppe 8 hat Lift, Gamma, Gain und Offset je R/G/B/Luma, dazu Contrast und Luma Mix.
  - 8.6 *Color Adjust* trägt **Hue −1..1 und Sat 0..2**.
  - 1.2 ist Weißabgleich in Kelvin plus Tint.
  - Ein späteres `setHue` der Bridge hätte hier ein echtes Ziel, `BMDeviceClient.setColor(hue, sat)` existiert schon.
- **RCP-Praxis:** Ein RCP bietet je Kanal Black- und White-Balance, Gamma nur als Master. Daher die Aufteilung oben: In der Parade gibt es keine Mittenzone je Kanal, weil der Bus kein Gamma je Kanal kennt.

## Sicherheit

- „Shading aktiv“ ist nach jedem Start aus und wird nicht gespeichert. Gesten gibt es nur mit gewähltem Ziel.
- Je Bewegung höchstens ±4 Bus-Einheiten (Hue ±3°), je Sitzung höchstens ±48 um den Ausgangswert (Hue ±45°), höchstens 20 Kommandos pro Sekunde.
- **■ Ausgangswerte** (und Esc) setzt jeden in der Sitzung bewegten Wert zurück und schaltet aus. **↶ Rückgängig** nimmt die letzte Geste zurück.
- Solange Shading aktiv ist, steht im Scope ein rotes Schild „SHADING“, und die Leiste hat einen roten Rand.

## Simulator

Bild ohne Kamera: oben ein 11-stufiger Graukeil, unten der ColorChecker (Näherung).
- Die Gesten bewegen dasselbe Feldvokabular. Das Bild entsteht im Modell aus `model.ts`: Gain mit Drehpunkt Schwarz, Lift mit Drehpunkt Weiß, Gamma, dann Hue und Sättigung auf Cb/Cr nach BT.709.
- Die Skalen des Modells sind **gewählt, nicht gemessen**. Wie weit eine Bus-Einheit an einer echten Kamera das Signal bewegt, ist je Kamera anders. Darum zeigt der Scope die gemessene Spur. Die Ziellinie zeigt, wohin der Finger zieht, und ist keine Vorhersage.
- Der E2E-Test `e2e/shading.spec.ts` zieht im Simulator die Rot-Spur der 80-%-Stufe hoch. Gemessen: Rot 0,93, Grün bleibt 0,80. Danach stellt „Ausgangswerte“ Rot auf 0,80 zurück.

## Quellen (geöffnet)

- Sony SRG-A40 selbst: `inquiry.cgi?inq=imaging`, `imaging.cgi`, RTSP-Bild (Messung oben)
- Sony SRG-A40 Technical Manual „VISCA/CGI Command List“, Seiten 14, 15, 33, 35–38 und 40 über manualslib.com, Link zum PDF auf der Sony-UK-Supportseite des SRG-A40
- Blackmagic Design, „Blackmagic 3G-SDI Shield for Arduino – Installation and Operation Manual“, Abschnitt Studio Camera Control Protocol (documents.blackmagicdesign.com)
- lz-camera-bridge (main, 06.10.2026): `BridgeServer.ts`, `protocol/paintNudge.ts`, `protocol/valueOrigin.ts`, `cameras/HttpCgiClient.ts`, `cameras/ViscaClient.ts`, `cameras/BMDeviceClient.ts`, `cameras/DemoCameraClient.ts`, `packages/web-rcp/src/capabilities.ts`
