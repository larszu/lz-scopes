# Stichprobe aus den HDR-Produktions-LUTs der BBC

Quelle: [bbc/bbc_hdr_television_production_luts](https://github.com/bbc/bbc_hdr_television_production_luts),
Commit `dd2744578d64f1a0d0b9f2eb58276ffa10cc4895`, Version 1.8 (09/2026).
© British Broadcasting Corporation (BBC), Apache License 2.0 (Text: [LICENSE](LICENSE)).

| Datei | aus | Inhalt |
|---|---|---|
| `1a.json` | `Primary_Conversions_Post-Production_Type_I_Nominal_Range/1a_PQ1000_HLG_Type1_Transcode_nocomp-v1-8-cicp.cube` | PQ 1000 cd/m² → HLG |
| `7a.json` | `Primary_Conversions_Post-Production_Type_I_Nominal_Range/7a_HLG_PQ1000_Type1_Transcode_nocomp-v1-8-cicp.cube` | HLG → PQ 1000 cd/m² |

Geändert: nur jeder vierte Gitterpunkt (9³ von 33³ Knoten) übernommen, als JSON
`[r-, g-, b-Index, R′, G′, B′]`; die Ausgangswerte sind unverändert aus der Datei. Erzeugt mit
`node scripts/bbc-luts-fetch.mjs --fixture`. Gelesen nur von `test/bbcLuts.test.ts`, nicht mit
der App ausgeliefert.
