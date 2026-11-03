#!/bin/sh
# Executable wrapper for the bridge's LZS_DECKLINK_HELPER (e2e/decklink-setup.spec.ts)
exec node "$(dirname "$0")/fake-decklink-live.mjs" "$@"
