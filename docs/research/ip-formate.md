# Komprimierte IP-Formate: JPEG XS, IPMX, ProRes, IP10 (#233)

Stand 25.11.2026. Frage aus dem VB440-Vergleich (#225): Welche komprimierten IP-Formate kann lz-scopes dekodieren?

## Was die Bridge heute meldet

`/api/health` enthält je ffmpeg `formats` (aus `ffmpeg -decoders` und `-demuxers`, `server/ffmpeg.mjs` `BROADCAST_FORMATS`). Die Einstellungen zeigen das unter *Bridge* als „liest … · nicht …“. Geprüft mit dem mitgelieferten Build `ffmpeg-9.0.2-lzs2` (darwin-arm64):

| Format | Decoder im Build | Weg in lz-scopes |
|---|---|---|
| Apple ProRes (422, 4444, RAW) | `prores`, `prores_raw` | Datei, MXF, MOV; MPEG-TS/RTP nur, wenn ffmpeg den Strom erkennt |
| JPEG 2000 (z. B. VSF TR-01 im TS) | `jpeg2000` | Datei, MPEG-TS |
| DNxHD/HR | `dnxhd` | Datei |
| JPEG XS | **nein** | Demuxer `jpegxs_pipe` ist da, der Decoder nicht |
| SMPTE 302M (PCM im TS) | `s302m` | MPEG-TS |
| Dolby E | `dolby_e` + Demuxer `s337m` | siehe `ton-sendeniveau.md` |
| AC-3 / E-AC-3 | `ac3`, `eac3` | dekodiert ffmpeg direkt; Atmos-Objekte (JOC) nicht |
| SDP/RTP | Demuxer `sdp`, `rtp` | ST 2110-30 heute; -20/-22 siehe unten |

## JPEG XS

- Dekoder in ffmpeg nur über `libsvtjpegxs` (SVT-JPEG-XS, BSD-2-Clause-Patent). Unser Build (`scripts/ffmpeg-build/build.sh`) baut es nicht mit. Zum Nachrüsten: SVT-JPEG-XS in `sources.txt` pinnen, `--enable-libsvtjpegxs` setzen, Lizenzprüfung in `ffmpeg-lizenz.md` ergänzen, Build-Workflow laufen lassen. **Nicht gemacht** – ein neuer ffmpeg-Build ohne Prüflauf auf allen fünf Zielen wäre geraten.
- ST 2110-22 (VSF TR-08): RTP-Nutzlast nach RFC 9134. ffmpegs `rtpdec` hat dafür keinen Depacketizer; ohne ihn hilft auch der Decoder nicht. Möglicher Weg: eigener Depacketizer in `server/rtp.mjs` (wie die eigene RTP-Annahme) → Codestream an ffmpeg per Pipe (`-f jpegxs_pipe`).
- JPEG XS im MPEG-TS (VSF TR-07): ob ffmpegs `mpegts`-Demuxer den Stream-Typ 32h zuordnet, ist ungeprüft – kein Testmaterial vorhanden.

## IPMX (VSF TR-10)

IPMX ist kein eigener Codec: ST 2110-20/-22/-30/-40 plus NMOS IS-04/-05 plus Zusätze (asynchrone Quellen, HDCP-Schutz über PEP). Unkomprimiertes Video braucht die 2110-20-Annahme (#226), komprimiertes den JPEG-XS-Weg oben, die Registrierung die Bridge (lz-camera-bridge#291). **PEP/HDCP ist nicht möglich**: HDCP-Schlüssel gibt es nur mit Lizenz der DCP LLC.

## ProRes über IP

Für ProRes gibt es kein genormtes RTP-Nutzlastformat (weder SMPTE noch IETF). Wie der VB440 „ProRes over IP“ kapselt, geht aus den öffentlichen Unterlagen nicht hervor (vermutlich MPEG-TS oder eine eigene Kapselung). ProRes in Dateien und MOV/MXF dekodiert ffmpeg; im TS nur, wenn der Stream-Typ bekannt ist – ungeprüft, kein Testmaterial.

## Blackmagic IP10

Blackmagics eigenes 2110-nahes Format für die IP-Konverter/ATEM-IP-Geräte; eine offene Spezifikation gibt es nicht, ffmpeg kennt es nicht. **Nicht dekodierbar.** Was geht: die Geräte arbeiten auch mit ST 2110-20/-30 – darüber ist es Sache von #226.

## Was in Lars' Anlagen vorkommt

Nicht erhoben – offene Frage an Lars. Bevor JPEG XS gebaut wird, sollte feststehen, ob ein Gerät in den Anlagen ihn überhaupt sendet.
