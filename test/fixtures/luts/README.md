# LUT-Dateien aus fremden Werkzeugen

Diese Dateien prüfen den LUT-Weg gegen das, was andere Programme tatsächlich schreiben – nicht
gegen unsere eigenen Annahmen. Sie werden nur in den Tests gelesen und nicht mit der App
ausgeliefert.

| Datei | Herkunft | Lizenz | Wofür |
|---|---|---|---|
| `aces2065_to_acescg_17.3dl` | [djieff/prism](https://github.com/djieff/prism) `samples/LUTs/3D` | MIT | `.3dl`, 17³, mit OCIO erzeugt |
| `linp3_to_lin2020_17.cube` | djieff/prism | MIT | `.cube` 3D, 17³ |
| `srgb.spi1d` | djieff/prism `samples/LUTs/1D/transfer` | MIT | `.spi1d`, 4101 Stützstellen, sRGB-EOTF |
| `warm_2.cube` | [lifeart/openrv-web](https://github.com/lifeart/openrv-web) `sample` | MIT | kleinster Fall: 2³ |
| `custom_domain_1d.cube` | lifeart/openrv-web `test-assets` | MIT | eigener `DOMAIN_MIN`/`DOMAIN_MAX` |
| `gamma_17.cube` | lifeart/openrv-web `test-assets` (dort `gamma_2.2.cube`) | MIT | 1D-`.cube`, 17 Stützstellen |
| `no_size.cube` | lifeart/openrv-web `sample` (dort `invalid_lut.cube`) | MIT | kaputt: ohne `LUT_*_SIZE`, muss abgelehnt werden |

Die großen Dateien derselben Sammlung (33³ und 65³ `.cube`, `.csp`, `.spi3d`, Kamerakurven) sind
je rund 1–7 MB und bleiben draußen; `node scripts/luts-fetch.mjs` holt sie bei Bedarf nach
`vendor/luts/`, der Test nimmt sie dann zusätzlich mit.

Umbenannt wurden nur `gamma_2.2.cube` → `gamma_17.cube` (der Name versprach eine reine
2,2-Kurve, die Werte sind keine) und `invalid_lut.cube` → `no_size.cube` (sagt, was fehlt).
Inhalte unverändert.
