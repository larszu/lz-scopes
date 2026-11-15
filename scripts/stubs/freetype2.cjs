// Stand-in for @julusian/freetype2 in the bundled camera bridge (scripts/build-camera-bridge.mjs).
// atem-connection requires it at load time only to draw ATEM multiviewer labels; its native
// binding cannot be found from inside one bundled file, so the whole bridge failed to start
// ("Failed to find binding for freetype2"). Without it every ATEM function works except label
// drawing, which then says so instead of taking the bridge down.
const missing = () => { throw new Error('ATEM multiviewer labels are not available in the LZ Scopes built-in bridge'); };
module.exports = new Proxy({}, { get: (_t, k) => (k === '__esModule' || typeof k === 'symbol' ? undefined : missing) });
