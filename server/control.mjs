// Control API commands (Bitfocus Companion, curl, …): validation and normalisation.
// Shared by the bridge (server/index.mjs) and the main window (src/main.ts), which
// executes them. Plain JS so the bridge can run without a build step.
//
// A command is a JSON object { cmd: '<name>', …arguments }. validateCommand() returns
// { ok: true, command } with defaults filled in, or { ok: false, error }.
// Panels, sources and layout presets are 1-based numbers or names/ids, as a user
// sees them; the main window resolves them.

/** Codecs of the 10-bit output stream (server/out10.mjs, src/deep.ts). */
export const CODECS10 = ['hevc10', 'hevc422', 'v210', 'prores'];

export const OVERLAY_SCOPES = ['wf-luma', 'wf-color', 'wf-skin', 'wf-rgb', 'parade', 'yrgb', 'ycbcr', 'vector', 'hls', 'cie', 'hist'];
export const AUDIO_SCOPES = ['audio-meter', 'audio-loudness', 'audio-spectrum', 'audio-phase', 'audio-check'];
/** Opple Light Master views (src/opple/scopes.ts) */
export const LIGHT_SCOPES = ['light-cie', 'light-vector', 'light-bands', 'light-trend', 'light-map', 'light-spectrum', 'light-swatch'];
export const PANEL_SCOPES = ['picture', ...OVERLAY_SCOPES, 'wf-green', 'match', 'diamond', 'cube', 'satlum', 'chplot', 'minmax', 'timeline', 'qclog', 'stats', ...AUDIO_SCOPES, 'clock', 'genlock', ...LIGHT_SCOPES];
export const OUTPUT_VIEWS = ['grid', 'panel', 'clean', 'overlay'];
export const TRANSPORT_OPS = ['play', 'pause', 'toggle', 'stop', 'next', 'prev', 'forward', 'rewind', 'start', 'end'];
const MODES = ['toggle', 'on', 'off'];
/** Generator signals (src/audio/dsp/signals.ts) */
/** Global settings the control API can set (src/main.ts SET, described once in src/ui/schema.ts). */
export const SETTING_KEYS = ['theme', 'scheme', 'sidebar', 'display', 'hdrPreview', 'unit', 'tint', 'precision', 'falseColour', 'skinLuma', 'skinHue', 'zebra', 'stage', 'deRef', 'lowLatency'];
export const GEN_SIGNALS = ['sine', 'square', 'triangle', 'saw', 'white', 'pink', 'pink-band', 'sweep', 'steps', 'ebu-ident', 'glits', 'ident-lr', 'polarity', 'avsync', 'blits', 'ebu-multi'];

/** Every command with a short description (GET /api/control/commands, docs). */
export const COMMANDS = {
  'state': 'Query the state',
  'source.select': 'Select a source: source (number, name or id), panel (optional; none = all panels)',
  'layout.preset': 'Layout preset: preset (1–6, id such as lc or label such as 2×2)',
  'layout.load': 'Load a saved layout configuration: name',
  'panel.scope': 'Scope of a panel: panel, scope',
  'panel.maximize': 'Maximise a panel: panel, mode toggle|on|off (off without panel = back)',
  'freeze': 'Freeze: mode toggle|on|off',
  'qc.clear': 'Clear the QC log',
  'roi.clear': 'Clear the measuring frame and measuring point: source (optional; none = all)',
  'pattern.select': 'Select a test pattern: pattern (id or name), source (optional)',
  'pattern.next': 'Next test pattern: source (optional)',
  'pattern.prev': 'Previous test pattern: source (optional)',
  'output.open': 'Open an output: name, view grid|panel|clean|overlay, panel, source, scene, bg picture|black, display, fullscreen, stream, target, codec (10 bit: hevc10|hevc422|v210|prores)',
  'output.close': 'Close an output: name (none = all)',
  'scene.select': 'Select an overlay scene: scene (name or id), output (optional; none = all overlay outputs and the default)',
  'stream.start': 'Start the stream of an output: output (optional), stream (name), target (optional push target), codec (optional, 10 bit)',
  'stream.stop': 'Stop a stream: output or stream (none = all)',
  'transport': 'Video file: op play|pause|toggle|stop|next|prev|forward|rewind|start|end, source (optional)',
  'audio.reset': 'Reset loudness (I, LRA, max M/S, max TP, counters, log; Tech 3341): source (optional; none = all sources with sound)',
  'audio.pause': 'Pause/resume I and LRA (Tech 3341): mode toggle|on|off, source (optional; none = all sources with sound)',
  'generator': 'Tone generator: mode toggle|on|off, signal (optional), freq (Hz, optional), level (dBFS, optional; above −6 only with force: true)',
  'setting': `Set a global setting: key (${SETTING_KEYS.join(', ')}), value (choice, number, true/false, or [lo, hi] for skinLuma); state.settings lists keys, values and choices`,
};

const isStr = (v) => typeof v === 'string';
const ref = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 999) || (isStr(v) && v.trim().length > 0 && v.length <= 120);
const normRef = (v) => (isStr(v) && /^\d+$/.test(v.trim()) ? Number(v.trim()) : isStr(v) ? v.trim() : v);
const name = (v) => isStr(v) && /^[\w-]{1,40}$/.test(v);

/**
 * @param {unknown} raw
 * @returns {{ ok: true, command: Record<string, unknown> & { cmd: string } } | { ok: false, error: string }}
 */
export function validateCommand(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('Command must be a JSON object');
  const c = /** @type {Record<string, unknown>} */ (raw);
  const cmd = c.cmd;
  if (!isStr(cmd) || !(cmd in COMMANDS)) return fail(`Unknown command ${JSON.stringify(cmd)}; known: ${Object.keys(COMMANDS).join(', ')}`);
  /** @type {Record<string, unknown> & { cmd: string }} */
  const out = { cmd };
  /** optional reference (panel/source/…) → number or trimmed string */
  const optRef = (key) => {
    if (c[key] === undefined || c[key] === null || c[key] === '') return null;
    if (!ref(c[key])) return `${key}: number from 1 or name expected`;
    out[key] = normRef(c[key]);
    return null;
  };
  const reqRef = (key) => (c[key] === undefined || c[key] === null || c[key] === '' ? `${key} missing` : optRef(key));
  const optMode = () => {
    const m = c.mode ?? 'toggle';
    if (!MODES.includes(/** @type {string} */ (m))) return 'mode: toggle, on or off';
    out.mode = m;
    return null;
  };
  const optName = (key) => {
    if (c[key] === undefined || c[key] === '') return null;
    if (!name(c[key])) return `${key}: only letters, digits, _ and - (max. 40)`;
    out[key] = c[key];
    return null;
  };
  const optTarget = () => {
    if (c.target === undefined || c.target === '') return null;
    if (!isStr(c.target) || !/^(rtmps?|srt|rtsp|udp|tcp|rtp):\/\//i.test(c.target) || c.target.length > 2048) return 'target: rtmp(s)://, srt://, rtsp://, udp://, tcp:// or rtp://';
    out.target = c.target;
    return null;
  };
  // 10-bit stream codec (server/out10.mjs): needs a push target
  const optCodec = () => {
    if (c.codec === undefined || c.codec === '') return null;
    if (!CODECS10.includes(/** @type {string} */ (c.codec))) return `codec: ${CODECS10.join(', ')}`;
    if (!out.target) return 'codec needs target';
    out.codec = c.codec;
    return null;
  };
  const errors = [];
  const check = (e) => { if (e) errors.push(e); };
  switch (cmd) {
    case 'state': break;
    case 'source.select': check(reqRef('source')); check(optRef('panel')); break;
    case 'layout.preset': check(reqRef('preset')); break;
    case 'layout.load': check(reqRef('name')); break;
    case 'panel.scope':
      check(reqRef('panel'));
      if (!PANEL_SCOPES.includes(/** @type {string} */ (c.scope))) errors.push(`scope: ${PANEL_SCOPES.join(', ')}`);
      else out.scope = c.scope;
      break;
    case 'panel.maximize':
      check(optMode()); check(optRef('panel'));
      if (out.panel === undefined && out.mode !== 'off') errors.push('panel missing');
      break;
    case 'freeze': check(optMode()); break;
    case 'qc.clear': break;
    case 'roi.clear': check(optRef('source')); break;
    case 'pattern.select': check(reqRef('pattern')); check(optRef('source')); break;
    case 'pattern.next': case 'pattern.prev': check(optRef('source')); break;
    case 'output.open': {
      const view = c.view ?? 'overlay';
      if (!OUTPUT_VIEWS.includes(/** @type {string} */ (view))) errors.push(`view: ${OUTPUT_VIEWS.join(', ')}`);
      out.view = view;
      check(optName('name')); check(optRef('panel')); check(optRef('source')); check(optRef('scene'));
      const bg = c.bg ?? 'picture';
      if (bg !== 'picture' && bg !== 'black') errors.push('bg: picture or black'); else out.bg = bg;
      if (c.display !== undefined && c.display !== '') {
        if (!(isStr(c.display) || typeof c.display === 'number') || !/^\d{1,12}$/.test(String(c.display))) errors.push('display: display id'); else out.display = String(c.display);
      }
      if (c.fullscreen !== undefined && typeof c.fullscreen !== 'boolean') errors.push('fullscreen: true/false'); else out.fullscreen = c.fullscreen ?? true;
      check(optName('stream')); check(optTarget()); check(optCodec());
      if (out.target && !out.stream) errors.push('target needs stream');
      break;
    }
    case 'output.close': check(optName('name')); break;
    case 'scene.select': check(reqRef('scene')); check(optName('output')); break;
    case 'stream.start':
      check(optName('output'));
      if (!name(c.stream)) errors.push('stream: name of letters, digits, _ and - (max. 40)'); else out.stream = c.stream;
      check(optTarget()); check(optCodec());
      break;
    case 'stream.stop': check(optName('output')); check(optName('stream')); break;
    case 'audio.reset': check(optRef('source')); break;
    case 'audio.pause': check(optMode()); check(optRef('source')); break;
    case 'generator': {
      check(optMode());
      if (c.signal !== undefined && c.signal !== '') { if (!GEN_SIGNALS.includes(/** @type {string} */ (c.signal))) errors.push(`signal: ${GEN_SIGNALS.join(', ')}`); else out.signal = c.signal; }
      if (c.freq !== undefined && c.freq !== '') { const f = Number(c.freq); if (!Number.isFinite(f) || f < 10 || f > 20000) errors.push('freq: 10 … 20000 Hz'); else out.freq = f; }
      if (c.level !== undefined && c.level !== '') {
        const l = Number(c.level);
        if (!Number.isFinite(l) || l < -90 || l > 0) errors.push('level: −90 … 0 dBFS');
        else if (l > -6 && c.force !== true) errors.push('level above −6 dBFS only with force: true (loud)');
        else out.level = l;
      }
      break;
    }
    case 'transport':
      if (!TRANSPORT_OPS.includes(/** @type {string} */ (c.op))) errors.push(`op: ${TRANSPORT_OPS.join(', ')}`); else out.op = c.op;
      check(optRef('source'));
      break;
    case 'setting': {
      if (!SETTING_KEYS.includes(/** @type {string} */ (c.key))) errors.push(`key: ${SETTING_KEYS.join(', ')}`); else out.key = c.key;
      const v = c.value;
      const okValue = (isStr(v) && v.length <= 120) || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))
        || (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x)));
      if (!okValue) errors.push('value: string, number, true/false or [lo, hi]'); else out.value = v;
      break;
    }
  }
  return errors.length ? fail(`${cmd}: ${errors.join('; ')}`) : { ok: true, command: out };
}

function fail(error) { return { ok: false, error }; }

/** Loopback addresses (IPv4, IPv6, IPv4-mapped). */
export function isLoopback(address) {
  if (!address) return false;
  return address === '::1' || /^127\./.test(address) || /^::ffff:127\./.test(address);
}

/**
 * May this request use the control API? Without a token only loopback clients; with a
 * token every client that presents it (Authorization: Bearer … or ?token=…).
 * A browser page from another origin is refused (Origin header set and foreign).
 * @param {{ remote?: string, token?: string, presented?: string | null, origin?: string, host?: string }} r
 * @returns {null | { status: number, error: string }}
 */
export function controlAccess({ remote, token, presented, origin, host }) {
  if (origin && host) {
    let o = '';
    try { o = new URL(origin).host; } catch { /* malformed */ }
    if (o !== host) return { status: 403, error: 'Foreign web origin' };
  }
  if (token) return presented === token ? null : { status: 401, error: 'Token missing or wrong' };
  return isLoopback(remote) ? null : { status: 403, error: 'Control only from 127.0.0.1 (or with a token, see docs/control-api.md)' };
}
