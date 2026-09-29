# End-to-end tests (#14)

## Choice

- **Playwright `_electron`** drives the real desktop app (bridge in the main process,
  output windows, file inputs). Playwright calls its Electron support *experimental*;
  supported from Electron 14 (https://playwright.dev/docs/api/class-electron, opened
  30.09.2026). `electron.launch({ args, env, cwd, timeout })` starts the app from the
  checkout; `firstWindow()` returns the main window.
- A browser-only variant against `npm start` was not needed: Electron runs locally on
  macOS with the real GPU. It remains the fallback if Electron ever fails in CI.

## How the tests observe the app

- **Control API** (`/api/control`, docs/control-api.md) sets patterns, layouts, scopes
  and outputs – the same path Companion uses, no test hooks in the app.
- **Pixels**: each panel copies its WebGL region into a 2D `canvas.blit`; the graticule is
  on a separate overlay canvas. The tests read the blit canvas and map rows to signal
  levels with the waveform geometry of `plotRect` (src/graticule.ts) and
  `WAVE_MIN`/`WAVE_MAX` (src/renderer.ts). Reference levels come from the pattern
  definitions (src/patterns.ts) and, for the CST/LUT stages, from `compileChain` (CPU
  reference of the shader chain).
- **Isolation**: `LZS_USER_DATA` gives each run its own profile (localStorage,
  single-instance lock), `LZS_PORT` a free port. localStorage belongs to the origin, port
  included – a restart test has to reuse the port.

## CI (Linux)

- `xvfb-run`, `--no-sandbox` (no SUID sandbox helper on the runner), WebGL through
  SwiftShader (`--use-angle=swiftshader --enable-unsafe-swiftshader`). The flags follow
  Chromium's switch names; whether they suffice is shown by the CI run itself, no source
  was opened for them.
- mediamtx comes as a release binary from github.com/bluenviron/mediamtx (MIT), ffmpeg
  from the distribution. Without them the RTSP test is skipped, not failed.
