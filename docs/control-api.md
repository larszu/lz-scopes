[Deutsch](control-api.de.md) | **English**

# Control API (Bitfocus Companion, curl)

The bridge (`server/index.mjs`, built into the desktop app) accepts commands and passes them on to the **main window**. The main window keeps a WebSocket connection to the bridge (`/control?role=app`), executes the commands and reports its state back. Without an open main window the bridge answers with `503`.

| Path | Address |
|---|---|
| HTTP | `POST /api/control` with `Content-Type: application/json`, one command per request |
| State | `GET /api/control` → `{ ok, connected, state }` |
| Command list | `GET /api/control/commands` |
| WebSocket | `ws://host:port/control` – send commands, receive answers and state |

**Port:** the desktop app takes 4192 if it is free, otherwise a free port (shown in the log: `bridge http://127.0.0.1:<port>`). `npm start` and the bridge of `npm run dev` also listen on 4192 (in development the UI on 4191 forwards `/control`). 4190 is deliberately not used: it is on the “bad ports” list of the Fetch standard, and Chrome refuses it.

## Access

- Without a token, only from `127.0.0.1` / `::1`.
- With a token, anyone who sends it: `Authorization: Bearer <token>` or `?token=<token>`. Set the token with `LZS_CONTROL_TOKEN=<token>` (desktop app and `npm start`) or `--control-token <token>`. For Companion on another computer to reach the bridge at all, it must also listen on the network: `LZS_HOST=0.0.0.0` (app) or `--host 0.0.0.0`.
- Web pages of a foreign origin are rejected (origin check, `application/json` only).

## Commands

Every command is a JSON object with `cmd`. Panels, sources, presets and scenes count from 1 as in the app, or are given by name (or id).

| `cmd` | Fields |
|---|---|
| `state` | – (answer `result` = state) |
| `source.select` | `source`; `panel` optional (without = all panels) |
| `source.split` | `source`, `layout` (`2x2`, `3x3`, `4x4`, `2+8`, `1+5`; `none` removes its tile cameras), `inset` optional (border per side as share of the tile height, 0 … 0.25, default 0.1). Makes one camera per multiviewer tile (#217); answer lists the cameras |
| `panel.split` | `panel` (picture panel), `mode` `toggle`/`on`/`off`, `source` optional (B), `spread` optional (`true` = the other unpinned panels follow). The split is then the source `Split panel N` (#177) |
| `panel.follow` | `panel`, `follow` (picture panel whose source – and split – this panel shows; `0` = its own source again) |
| `layout.preset` | `preset`: 1–6, id (`lc`) or label (`2x2`, `Colorist`) |
| `layout.load` | `name` of a saved layout configuration |
| `panel.scope` | `panel`, `scope` (`picture`, `wf-luma`, `wf-color`, `wf-skin`, `wf-rgb`, `parade`, `yrgb`, `ycbcr`, `vector`, `hls`, `cie`, `diamond`, `cube`, `surface`, `satlum`, `chplot`, `minmax`, `timeline`, `strip`, `qclog`, `hist`, `stats`, `tiles`, `noise`, `wshading`, `skinall`, `chart`, `drift`, `audio-meter`, `audio-loudness`, `audio-spectrum`, `audio-phase`, `audio-check`, `audio-surround`, `audio-field`, `audio-spl`, `audio-rta`, `clock`, `genlock`) |
| `panel.maximize` | `panel`, `mode` `toggle`\|`on`\|`off`; `off` without `panel` = restore |
| `freeze` | `mode` `toggle`\|`on`\|`off`; all sources at the same moment of the scene (measured latency taken out) |
| `qc.clear` | – (clear the QC log; state `qc`: `active`, `total`, `last`) |
| `roi.clear` | `source` optional (without = all): delete measuring frame and measuring point |
| `pattern.select` | `pattern` (id or name), `source` optional (otherwise the first test pattern source) |
| `pattern.next`, `pattern.prev` | `source` optional |
| `output.open` | `name`, `view` (`overlay` default, `grid`, `panel`, `clean`), `panel`, `source`, `scene`, `bg` `picture`\|`black`, `display` (screen id), `fullscreen` (default `true`), `stream`, `target`, `codec` (10-bit stream: `hevc10`, `hevc422`, `v210`, `prores`; needs `target`) |
| `output.close` | `name` optional (without = all) |
| `scene.select` | `scene`; `output` optional (without = default and all open overlay outputs) |
| `stream.start` | `stream` (name → `/out/<stream>.mjpeg`), `output` optional (otherwise the first open output; if none is open, an overlay window opens), `target` optional (`rtmp://`, `srt://`, `rtsp://`, `udp://`, `tcp://`, `rtp://`), `codec` optional (10 bit, as for `output.open`; without it MJPEG; a 10-bit codec cannot go over RTMP) |
| `stream.stop` | `output` or `stream` optional (without = all) |
| `transport` | `op` `play`\|`pause`\|`toggle`\|`stop`\|`next`\|`prev`\|`forward`\|`rewind`\|`start`\|`end`, `source` optional (otherwise the video file on screen; without one the open recordings on their shared clock) |
| `av.reset` | `source` optional (otherwise all sources with audio): clear the A/V offset measurement and its long-run history (#236) |
| `audio.reset` | `source` optional (otherwise all sources with audio): reset I, LRA, max M/S, max TP, counter and log (EBU Tech 3341) |
| `audio.pause` | `mode` `toggle`\|`on`\|`off`, `source` optional: pause/resume I and LRA (Tech 3341) |
| `generator` | `mode` `toggle`\|`on`\|`off`, `signal` optional (`sine`, `ebu-ident`, `glits`, `blits`, `ebu-multi`, `ident-lr`, `pink`, `pink-band`, `white`, `sweep`, `steps`, `polarity`, `avsync`, …), `freq` 10–20000 Hz, `level` −90–0 dBFS; above −6 dBFS only with `"force": true` |
| `record` | `mode` `toggle`\|`on`\|`off`, `source` optional (none = every recordable source into one take, like "Record all"; `toggle` stops all as soon as one runs) |
| `ring` | `mode` `toggle`\|`on`\|`off`, `source` optional (none = all bridge sources): ring buffer of the source |
| `ring.save` | `pre` (s, optional), `post` (s, optional; post-roll): save every ring buffer with the same time mark; without them the values from Settings → Recording |
| `record.mark` | `label` optional (none = M1, M2 …), `source` optional (none = all running recordings): marker in the companion file |
| `record.event` | `kind` (letters, digits, `_ . -`), `data` (any JSON value up to 16 KB), `source` optional: event in the companion file, e.g. paint changes |
| `setting` | `key` (`theme`, `scheme`, `sidebar`, `display`, `hdrPreview`, `unit`, `tint`, `precision`, `falseColour`, `skinLuma`, `skinHue`, `zebra`, `stage`, `deRef`, `lowLatency`, `refSource` (source id or empty = off), `refMode` (`live`/`frozen`), `refOpacity` (5…100 %)), `value`: one of the choices, a number in range, `true`/`false`, or `[lo, hi]` for `skinLuma`. The same description renders the settings window and the panel ⚙ rows (src/ui/schema.ts); `state.settings` lists keys, values, choices and ranges |

Answer: `{ ok, result?, error?, state }`. `error` is an English text naming the command and the problem (e.g. `source.select: source missing`, `Token missing or wrong`). Status `400` = invalid command, `422` = cannot be executed (e.g. unknown scene), `503` = no main window, `401`/`403` = access denied. Scripts should rely on `ok` and the status code, not on the wording.

## State (feedbacks)

```json
{
  "source": { "index": 1, "id": "s1", "name": "Camera 1", "status": "live" },
  "frozen": false,
  "clip": 0.4, "clipHigh": 0.4, "clipLow": 0,
  "yMin": 3.1, "yMax": 98.7,
  "outside": { "gamut": "709", "share": 12.4, "far": 3.1 },
  "layoutName": "Grading", "preset": "lc",
  "maximized": null,
  "scene": { "id": "…", "name": "Waveform bottom" },
  "outputs": [{ "name": "key", "view": "overlay", "scene": "Waveform bottom", "stream": "scopes" }],
  "pattern": { "id": "smpte75", "name": "SMPTE 75% bars + PLUGE" },
  "playing": null,
  "audio": { "source": "Camera 1", "momentary": -22.8, "shortTerm": -23.1, "integrated": -23.0, "lra": 4.2, "maxTP": -2.1,
             "paused": false, "seconds": 312, "avOffsetMs": 12.5, "ident": "EBU stereo ident (R 49)", "identProblems": [] },
  "generator": { "running": false, "signal": "sine", "level": -18, "freq": 1000, "channels": 2 },
  "light": { "target": { "schema": "lz-scopes.light-target/1", "label": "Key", "place": "Stage left", "note": "", "time": "2026-11-24T10:00:00.000Z", "device": "LM3",
             "lux": 1200, "quantity": "lx", "ev100": 8.91, "x": 0.4232, "y": 0.3990, "u": 0.2435, "v": 0.5165, "cct": 3200, "duv": 0 },
             "latest": { "…": "same fields, without label/place/note" }, "delta": { "duv": 0.0042, "cct": 180, "duvDiff": 0.0011, "ev": -0.35 }, "points": 12 },
  "recording": { "active": 1, "sources": [{ "name": "Camera 1", "id": "s1", "seconds": 312, "take": "20261010-213005" }], "ring": [{ "name": "Camera 2", "id": "s2", "pre": 60, "buffered": 60 }] },
  "settings": [{ "key": "unit", "kind": "select", "label": "Scale", "value": "percent", "options": ["percent", "bit8", "bit10", "nits"] }, …],
  "sources": [], "layouts": [], "presets": [], "panels": [], "scenes": [], "patterns": []
}
```

Names (sources, scenes, patterns, ident) appear as they are shown in the app; user-defined names stay as entered.

`outside` is the share of the active source outside the target gamut of an open CIE panel (#181; `null` without such a panel), `far` the part clearly outside – the same rule as the gamut warning in the picture. `clip`, `yMin`, `yMax` are percentages (to 0.1) of the active source – the source shown by most visible panels. Without statistics they are `null`. `audio` refers to the active source with audio (otherwise the first one with audio); values in LUFS/LU/dBTP rounded to 0.1, `avOffsetMs` according to ITU-R BT.1359-1 (+ = audio ahead of picture), `null` without a reading. Long-run history (#236): `avMeanMs`, `avMinMs`, `avMaxMs`, `avDriftMsPerHour` (least-squares slope over the last hour, `null` before 2 min and 10 pairs), `avPairs`, `avBeyondDetect`/`avBeyondAccept` (pairs beyond the BT.1359-1 limits), `avSince` (ms since epoch). `nonPcm` lists SMPTE ST 337 data found in channel pairs (#234): `pair` (1 = channels 1/2), `type` (ST 338 name, e.g. Dolby E), `dataType`, `bits`, `stream`, and for AC-3/E-AC-3 `codec`, `mode`, `dialnorm`. `layoutName` is the last loaded layout configuration or the label of the preset. `light` (#184) is the light measurement: `target` the point remembered as target (★ in the light meter; `null` without one), `latest` the latest reading of the active meter, `delta` the latest reading minus the target (Δu′v′ CIE 1976, ΔCCT K, ΔDuv, brightness in EV). `ev100` is EV at ISO 100 with the incident-light constant C = 250 (flat receptor, ISO 2720). Other tools (light-planner for fixtures, camera-bridge for camera paint) read the target here; the copied/saved target JSON in the app has the same fields plus the spectrum of spectrometer readings.

Over WebSocket you receive `{type:"hello", connected, state, commands}` on connecting, `{type:"state", state}` on every change (at most four times per second), `{type:"connected", connected}` when the main window appears or goes away, and `{type:"result", id, ok, result?, error?}` for every command (the command's `id` is echoed).

## Examples

```bash
B=http://127.0.0.1:4192/api/control   # desktop app and npm start
J='content-type: application/json'
curl -s $B | jq .state.frozen                                              # state
curl -s -H "$J" -d '{"cmd":"freeze","mode":"toggle"}' $B                   # freeze
curl -s -H "$J" -d '{"cmd":"source.select","source":2}' $B                 # source 2 in all panels
curl -s -H "$J" -d '{"cmd":"source.select","source":"Camera 1","panel":3}' $B
curl -s -H "$J" -d '{"cmd":"layout.preset","preset":"2x2"}' $B
curl -s -H "$J" -d '{"cmd":"layout.load","name":"Grading"}' $B
curl -s -H "$J" -d '{"cmd":"panel.scope","panel":2,"scope":"vector"}' $B
curl -s -H "$J" -d '{"cmd":"panel.maximize","panel":1}' $B
curl -s -H "$J" -d '{"cmd":"roi.clear"}' $B
curl -s -H "$J" -d '{"cmd":"pattern.next"}' $B
curl -s -H "$J" -d '{"cmd":"output.open","name":"key","view":"overlay","bg":"black","scene":"Studio","fullscreen":false}' $B
curl -s -H "$J" -d '{"cmd":"scene.select","scene":"Studio","output":"key"}' $B
curl -s -H "$J" -d '{"cmd":"stream.start","stream":"scopes","output":"key","target":"srt://10.0.0.5:9000"}' $B
curl -s -H "$J" -d '{"cmd":"stream.stop"}' $B
curl -s -H "$J" -d '{"cmd":"output.close"}' $B
curl -s -H "$J" -d '{"cmd":"transport","op":"next"}' $B
curl -s -H "$J" -d '{"cmd":"record","mode":"on"}' $B                       # record all sources
curl -s -H "$J" -d '{"cmd":"record.mark","label":"Gamma +2"}' $B
curl -s -H "$J" -d '{"cmd":"record","mode":"off"}' $B
curl -s -H "$J" -d '{"cmd":"ring","mode":"on"}' $B                         # ring buffer for all bridge sources
curl -s -H "$J" -d '{"cmd":"ring.save","post":5}' $B                       # save the last seconds + 5 s post-roll
# with a token from another computer
curl -s -H "$J" -H 'Authorization: Bearer secret' -d '{"cmd":"freeze"}' http://studio.local:4192/api/control
```

In the browser, `output.open` opens a window only if pop-ups are allowed for the page; the desktop app always opens it.

## Event log and Prometheus

The bridge keeps an **event log without thresholds** (`server/eventlog.mjs`, ring buffer of 2000 entries, until the bridge restarts): every change of a stream's flow (start, stop, end, error), its picture format, its sound channels, the PTP state, domain, grandmaster, clock class and UTC offset, the lock state of the grandmaster (ST 2059-2 SM TLV) and of the ST 2110 RTP stream watched in the clock panel. PTP and RTP are only followed while the clock panel keeps their monitors running. In the app: Sources → Event log …

| Path | Answer |
|---|---|
| `GET /api/events` | `{ max, total, events: [{ id, t, kind, source, item, from, to }] }`, `?since=<id>` for the newer ones |
| `GET /api/events?format=csv` | the same as CSV (semicolon, UTC times) |
| `DELETE /api/events` | clears the log |
| `GET /metrics` | Prometheus text format 0.0.4: streams (frames, dropped, bytes, size, fps), PTP (state, offset, jitter, path delay, clock class, locking status), RTP (packets, lag, grid), event count |

Access: from this computer always, from others only with the control token (`Authorization: Bearer <token>`); web pages of a foreign origin never. Sources appear without user name, password and query. Scrape example:

```yaml
scrape_configs:
  - job_name: lz-scopes
    static_configs: [{ targets: ['studio.local:4192'] }]
    authorization: { credentials: secret }   # only when Prometheus runs on another computer
```

## ST 2110 capture (pcap)

For `st2110:` sources (docs/research/st2110-empfang.md) the bridge records the received flows as pcap. Same access rule as above: captures contain facility addresses.

| Path | |
|---|---|
| `GET /api/st2110` | `services: [{ id, flows, capture }]` (running audio/ANC services, only with control access) next to the network inputs and generators (below) |
| `GET /api/st2110/pcap?id=&seconds=5&mb=50` | snapshot of all flows of the service (both 2022-7 paths), download |
| `POST /api/st2110/ring` `{id, mode:"on"\|"off", seconds?, mb?}` | rolling capture on disk (default 60 s / 200 MB) |
| `POST /api/st2110/ring/save` `{id}` | → `{ ok, file, bytes, url }` |
| `GET /api/st2110/file?name=` | a saved capture |

`id` may be left out when only one service runs. The state of the active source (`state.st2110`) carries the flow counters and the ST 2022-7 evaluation. IP/UDP headers in the file are rebuilt, time stamps are software receive times (no hardware time stamps).
## ST 2110 network inputs and test signals (bridge)

These calls go to the bridge itself, not to the main window. Reading is open; changes follow the access rule above. Background: [docs/research/st2110-netz.md](research/st2110-netz.md).

```bash
S=http://127.0.0.1:4192/api/st2110
curl -s $S                                                                  # inputs net1/net2, generators, NMOS state
curl -s -X PUT -H 'Content-Type: application/sdp' --data-binary @cam1.sdp $S/inputs/net1   # source st2110:net1 receives this flow
curl -s -X DELETE $S/inputs/net1                                            # disconnect
curl -s -H "$J" -d '{"kind":"video","format":"1080p25","host":"239.100.0.1","port":5004}' $S/generators
curl -s $S/generators/gen1.sdp                                              # SDP of the generator
curl -s -X PATCH -H "$J" -d '{"running":false}' $S/generators/gen1
```

`kind`: `video` (ST 2110-20; `format`, `depth` 8/10, `matrix` bt709/bt2020), `audio` (ST 2110-30; `channels` 1–64, `freq`, `levelDb`), `anc` (ST 2110-40 time code; `fps`), `sdi` (ST 2022-6; `format` 720p/1080p, `fps`). `host2`/`port2` send the same packets a second time (ST 2022-7). The bridge started with `--nmos-port <n>` also offers the inputs as NMOS receivers (IS-04/IS-05) and the generators as senders; `--nmos-registry <url>` sets the registry, otherwise it is searched via DNS-SD.

## Companion module

`companion/` contains the module `companion-module-lz-scopes` (API `@companion-module/base` ~1.14.1, like the module in lz-camera-bridge) with actions for the commands above (except `record.event`), feedbacks (recording, ring buffer running, connected, frozen, source active, clipping/Y′ above threshold, layout, scene, output open, stream running, panel maximised, video file playing, tone generator running, I/LRA paused, max true peak above threshold, ident result), variables (including loudness M/S/I/LRA, true peak, A/V offset, ident, running recordings and recording time) and presets.

```bash
cd companion
npm ci
npm test            # commands, state, feedbacks; checks the commands against server/control.mjs
npm run build       # → dist/
COMPANION_DEV_MODULES=~/companion-dev npm run sync   # copy into Companion's folder for developer modules
```

In Companion, enter the folder (`~/companion-dev`) under *Settings → Developer modules path*, then add the connection “LZ Scopes”.

**Separate repo?** Not for your own use: Companion loads the module from the developer folder. For Bitfocus's official module list it needs its own repo in the Bitfocus organisation (`companion-module-<manufacturer>-<product>`, free licence, package via `@companion-module/tools`). The `companion/` folder is structured so it can be split out for that unchanged.
