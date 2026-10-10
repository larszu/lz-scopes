# Messwerkzeuge für den Kameraabgleich

Stand 10.10.2026. Herleitung der Werkzeuge aus [scope-wuensche.md](scope-wuensche.md) (Wünsche 3–7, Idee 2), soweit umgesetzt. Was eine Norm vorgibt, steht mit Quelle da; was eine eigene Festlegung von lz-scopes ist, ist als solche markiert. Geprüft ist alles nur mit synthetischen Bildern in vitest und mit Testbildern im e2e-Test, nicht mit echten Kameras.

## Blendenskala (STOP) – Wunsch 3

Umgesetzt als Skala *STOP* (Einstellungen → Scopes → Skala bzw. Kopfleiste), `src/stops.ts`, Tests `test/stops.test.ts`.

- **Vorbild**: Telestream PRISM „STOP“ ([Blog](https://blog.telestream.com/master-hdr-video-production-with-stop-monitoring/), gelesen): „+1 stop means the light is twice as bright“; Zweck: „compare cameras with different gamma settings on the same scale“. Der PRISM-Datenblatt-Text spricht von einer „normalized ‚linear to light‘ logarithm vertical scale“. Wie PRISM den Nullpunkt je Kurve legt, steht in den gelesenen Quellen nicht; das Handbuch war nicht frei abrufbar.
- **Festlegung lz-scopes**: Blende 0 = Graukarte, +1 = doppeltes lineares Licht. Lineares Licht und Graukarte je Kurve:

| Kurve | lineares Licht | Graukarte (Blende 0) | Quelle |
|---|---|---|---|
| Kamera-Log (S-Log3, LogC3 …) | Szene-linear aus der Herstellerkurve | 0,18 | Herstellerkurven in `src/camera.ts`; S-Log3 0,18 → Code 420/1023 |
| HLG | Szenelicht E über die inverse OETF (BT.2100) | Signal 38 % | BT.2408 Tab. 1 (18-%-Graukarte bei 38 % HLG) |
| PQ | Displaylicht in cd/m² (ST 2084) | Signal 38 % ≈ 26 cd/m² | BT.2408 Tab. 1 |
| SDR BT.1886 | Szenelicht über die inverse BT.709-OETF (Kamerabelichtung) | 0,18 → 40,9 % | BT.709 OETF |
| γ 2,2 / 2,6 / 2,8, sRGB, linear | Displaylicht der Kurve | 0,18 linear | eigene Festlegung |

- Für SDR ist die inverse OETF eine Annahme: Knie, Black Gamma und Kameramatrix verbiegen die echte Kurve, die Skala gilt dann nur im linearen Teil. Bei PQ sind es Display-Blenden (die Szenebelichtung ist nach der OOTF nicht mehr eindeutig).
- Skala: ganze Blenden, beim Zoomen Drittelblenden; der Messpunkt zeigt zusätzlich „≈ … Blenden zur Graukarte“.
