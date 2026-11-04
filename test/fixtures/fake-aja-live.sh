#!/bin/sh
# Executable wrapper for the bridge's LZS_AJA_HELPER (e2e/aja.spec.ts)
exec node "$(dirname "$0")/fake-aja-live.mjs" "$@"
