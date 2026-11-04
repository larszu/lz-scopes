#!/usr/bin/env node
// Stand-in for lz-aja (e2e, no hardware): --list reports one KONA with two SDI inputs and HDMI, one
// with a signal; --capture streams like the DeckLink stand-in (1080p25 v210, sound, timecode, VANC –
// lz-aja sends the same records), so it hands over to fake-decklink-live.mjs.
const args = process.argv.slice(2);
if (args[0] === '--list') {
  process.stdout.write(`${JSON.stringify({ ok: true, sdk: '18.0.0', devices: [{ index: 0, name: 'Fake KONA 5', serial: 'FAKE0001', capture: true, ready: true, busy: false, anc: true, audioChannels: 16, inputs: ['sdi1', 'sdi2', 'hdmi1'], signals: { sdi1: '1080p25' } }] })}\n`);
  process.exit(0);
}
await import('./fake-decklink-live.mjs');
