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
| `layout.preset` | `preset`: 1–6, id (`lc`) or label (`2x2`, `Colorist`) |
| `layout.load` | `name` of a saved layout configuration |
| `panel.scope` | `panel`, `scope` (`picture`, `wf-luma`, `wf-color`, `wf-skin`, `wf-rgb`, `parade`, `yrgb`, `ycbcr`, `vector`, `cie`, `diamond`, `cube`, `satlum`, `chplot`, `minmax`, `timeline`, `qclog`, `hist`, `stats`, `audio-meter`, `audio-loudness`, `audio-spectrum`, `audio-phase`, `clock`) |
| `panel.maximize` | `panel`, `mode` `toggle`\|`on`\|`off`; `off` without `panel` = restore |
| `freeze` | `mode` `toggle`\|`on`\|`off` |
| `qc.clear` | – (clear the QC log; state `qc`: `active`, `total`, `last`) |
| `roi.clear` | `source` optional (without = all): delete measuring frame and measuring point |
| `pattern.select` | `pattern` (id or name), `source` optional (otherwise the first test pattern source) |
| `pattern.next`, `pattern.prev` | `source` optional |
| `output.open` | `name`, `view` (`overlay` default, `grid`, `panel`, `clean`), `panel`, `source`, `scene`, `bg` `picture`\|`black`, `display` (screen id), `fullscreen` (default `true`), `stream`, `target`, `codec` (10-bit stream: `hevc10`, `hevc422`, `v210`, `prores`; needs `target`) |
| `output.close` | `name` optional (without = all) |
| `scene.select` | `scene`; `output` optional (without = default and all open overlay outputs) |
| `stream.start` | `stream` (name → `/out/<stream>.mjpeg`), `output` optional (otherwise the first open output; if none is open, an overlay window opens), `target` optional (`rtmp://`, `srt://`, `rtsp://`, `udp://`, `tcp://`, `rtp://`), `codec` optional (10 bit, as for `output.open`; without it MJPEG; a 10-bit codec cannot go over RTMP) |
| `stream.stop` | `output` or `stream` optional (without = all) |
| `transport` | `op` `play`\|`pause`\|`toggle`\|`stop`\|`next`\|`prev`\|`forward`\|`rewind`\|`start`\|`end`, `source` optional (otherwise the video file on screen) |
| `audio.reset` | `source` optional (otherwise all sources with audio): reset I, LRA, max M/S, max TP, counter and log (EBU Tech 3341) |
| `audio.pause` | `mode` `toggle`\|`on`\|`off`, `source` optional: pause/resume I and LRA (Tech 3341) |
| `generator` | `mode` `toggle`\|`on`\|`off`, `signal` optional (`sine`, `ebu-ident`, `glits`, `blits`, `ebu-multi`, `ident-lr`, `pink`, `pink-band`, `white`, `sweep`, `steps`, `polarity`, `avsync`, …), `freq` 10–20000 Hz, `level` −90–0 dBFS; above −6 dBFS only with `"force": true` |

Answer: `{ ok, result?, error?, state }`. `error` is a short text naming the command and the problem (for invalid fields, the field and its allowed values). Status `400` = invalid command, `422` = cannot be executed (e.g. unknown scene), `503` = no main window, `401`/`403` = access denied. Scripts should rely on `ok` and the status code, not on the wording of `error`.

## State (feedbacks)

```json
{
  "source": { "index": 1, "id": "s1", "name": "Camera 1", "status": "live" },
  "frozen": false,
  "clip": 0.4, "clipHigh": 0.4, "clipLow": 0,
  "yMin": 3.1, "yMax": 98.7,
  "layoutName": "Grading", "preset": "lc",
  "maximized": null,
  "scene": { "id": "…", "name": "Waveform bottom" },
  "outputs": [{ "name": "key", "view": "overlay", "scene": "Waveform bottom", "stream": "scopes" }],
  "pattern": { "id": "smpte75", "name": "SMPTE 75% bars + PLUGE" },
  "playing": null,
  "audio": { "source": "Camera 1", "momentary": -22.8, "shortTerm": -23.1, "integrated": -23.0, "lra": 4.2, "maxTP": -2.1,
             "paused": false, "seconds": 312, "avOffsetMs": 12.5, "ident": "EBU stereo ident (R 49)", "identProblems": [] },
  "generator": { "running": false, "signal": "sine", "level": -18, "freq": 1000, "channels": 2 },
  "sources": [], "layouts": [], "presets": [], "panels": [], "scenes": [], "patterns": []
}
```

Names (sources, scenes, patterns, ident) appear as they are shown in the app; user-defined names stay as entered.

`clip`, `yMin`, `yMax` are percentages (to 0.1) of the active source – the source shown by most visible panels. Without statistics they are `null`. `audio` refers to the active source with audio (otherwise the first one with audio); values in LUFS/LU/dBTP rounded to 0.1, `avOffsetMs` according to ITU-R BT.1359-1 (+ = audio ahead of picture), `null` without a reading. `layoutName` is the last loaded layout configuration or the label of the preset.

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
# with a token from another computer
curl -s -H "$J" -H 'Authorization: Bearer secret' -d '{"cmd":"freeze"}' http://studio.local:4192/api/control
```

In the browser, `output.open` opens a window only if pop-ups are allowed for the page; the desktop app always opens it.

## Companion module

`companion/` contains the module `companion-module-lz-scopes` (API `@companion-module/base` ~1.14.1, like the module in lz-camera-bridge) with actions for all commands above, feedbacks (connected, frozen, source active, clipping/Y′ above threshold, layout, scene, output open, stream running, panel maximised, video file playing, tone generator running, I/LRA paused, max true peak above threshold, ident result), variables (including loudness M/S/I/LRA, true peak, A/V offset, ident) and presets.

```bash
cd companion
npm ci
npm test            # commands, state, feedbacks; checks the commands against server/control.mjs
npm run build       # → dist/
COMPANION_DEV_MODULES=~/companion-dev npm run sync   # copy into Companion's folder for developer modules
```

In Companion, enter the folder (`~/companion-dev`) under *Settings → Developer modules path*, then add the connection “LZ Scopes”.

**Separate repo?** Not for your own use: Companion loads the module from the developer folder. For Bitfocus's official module list it needs its own repo in the Bitfocus organisation (`companion-module-<manufacturer>-<product>`, free licence, package via `@companion-module/tools`). The `companion/` folder is structured so it can be split out for that unchanged.
