#!/usr/bin/env bash
# Smoke start of the packaged Linux app (CI: ci.yml job linux-app, release.yml).
#
#   scripts/linux-smoke.sh <command …>     e.g. release/lz-scopes-1.6.0-x86_64.AppImage --appimage-extract-and-run
#
# Starts the app under Xvfb with its own profile (LZS_USER_DATA, which also keeps the AppImage
# updater off) on port 4199 and checks over the bridge's /api/health that it came up with the
# SHIPPED ffmpeg (origin "bundled", no nonfree, SRT) and serves the UI. Fails after 90 s.
set -euo pipefail
[[ $# -gt 0 ]] || { echo "Aufruf: $0 <Befehl …>" >&2; exit 2; }
port="${LZS_SMOKE_PORT:-4199}"
profile="$(mktemp -d)"
log="$profile/app.log"
LZS_USER_DATA="$profile" LZS_PORT="$port" LZS_LANG=en setsid xvfb-run -a "$@" >"$log" 2>&1 &
pid=$!
# setsid: own process group, so Xvfb, Electron and its helpers end together
cleanup() { kill -- -"$pid" 2>/dev/null || true; }
trap cleanup EXIT
health=""
for _ in $(seq 1 90); do
  if ! kill -0 "$pid" 2>/dev/null; then echo "App beendet sich vorzeitig:"; cat "$log"; exit 1; fi
  health="$(curl -fsS "http://127.0.0.1:$port/api/health" 2>/dev/null || true)"
  [[ -n "$health" ]] && break
  sleep 1
done
[[ -n "$health" ]] || { echo "keine Antwort auf /api/health:"; cat "$log"; exit 1; }
echo "$health"
node -e '
  const h = JSON.parse(process.argv[1]);
  const f = h.ffmpeg || {};
  const bad = [];
  if (!h.ok) bad.push("health not ok");
  if (f.origin !== "bundled") bad.push(`ffmpeg origin ${f.origin} (expected bundled)`);
  if (/nonfree/.test(f.license || "")) bad.push("nonfree ffmpeg");
  if (!f.srt) bad.push("ffmpeg without SRT");
  if (bad.length) { console.error(bad.join("; ")); process.exit(1); }
  console.log(`ok: ffmpeg ${f.version || "?"} (${f.origin}, ${f.license})`);
' "$health"
curl -fsS "http://127.0.0.1:$port/" | grep -qi '<html' || { echo "UI nicht ausgeliefert"; exit 1; }
sleep 5
kill -0 "$pid" 2>/dev/null || { echo "App nach dem Start abgestürzt:"; cat "$log"; exit 1; }
echo "Linux-App startet: Bridge, mitgeliefertes ffmpeg und UI ok"
tail -20 "$log"
