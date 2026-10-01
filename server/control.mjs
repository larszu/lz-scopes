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

export const OVERLAY_SCOPES = ['wf-luma', 'wf-color', 'wf-skin', 'wf-rgb', 'parade', 'yrgb', 'ycbcr', 'vector', 'cie', 'hist'];
export const AUDIO_SCOPES = ['audio-meter', 'audio-loudness', 'audio-spectrum', 'audio-phase', 'audio-check'];
/** Opple Light Master views (src/opple/scopes.ts) */
export const LIGHT_SCOPES = ['light-cie', 'light-vector', 'light-bands', 'light-trend', 'light-map'];
export const PANEL_SCOPES = ['picture', ...OVERLAY_SCOPES, 'diamond', 'cube', 'stats', ...AUDIO_SCOPES, 'clock', ...LIGHT_SCOPES];
export const OUTPUT_VIEWS = ['grid', 'panel', 'clean', 'overlay'];
export const TRANSPORT_OPS = ['play', 'pause', 'toggle', 'stop', 'next', 'prev', 'forward', 'rewind', 'start', 'end'];
const MODES = ['toggle', 'on', 'off'];
/** Generator signals (src/audio/dsp/signals.ts) */
export const GEN_SIGNALS = ['sine', 'square', 'triangle', 'saw', 'white', 'pink', 'pink-band', 'sweep', 'steps', 'ebu-ident', 'glits', 'ident-lr', 'polarity', 'avsync', 'blits', 'ebu-multi'];

/** Every command with a short description (GET /api/control/commands, docs). */
export const COMMANDS = {
  'state': 'Zustand abfragen',
  'source.select': 'Quelle wählen: source (Nummer, Name oder id), panel (optional; ohne = alle Panels)',
  'layout.preset': 'Layout-Vorlage: preset (1–6, Kennung wie lc oder Beschriftung wie 2×2)',
  'layout.load': 'Gespeicherte Layout-Konfiguration laden: name',
  'panel.scope': 'Messwerkzeug eines Panels: panel, scope',
  'panel.maximize': 'Panel groß: panel, mode toggle|on|off (off ohne panel = zurück)',
  'freeze': 'Einfrieren: mode toggle|on|off',
  'roi.clear': 'Messrahmen und Messpunkt löschen: source (optional; ohne = alle)',
  'pattern.select': 'Testbild wählen: pattern (id oder Name), source (optional)',
  'pattern.next': 'Nächstes Testbild: source (optional)',
  'pattern.prev': 'Vorheriges Testbild: source (optional)',
  'output.open': 'Ausgabe öffnen: name, view grid|panel|clean|overlay, panel, source, scene, bg picture|black, display, fullscreen, stream, target, codec (10 bit: hevc10|hevc422|v210|prores)',
  'output.close': 'Ausgabe schließen: name (ohne = alle)',
  'scene.select': 'Overlay-Szene wählen: scene (Name oder id), output (optional; ohne = alle Overlay-Ausgaben und Vorgabe)',
  'stream.start': 'Stream einer Ausgabe starten: output (optional), stream (Name), target (optional Push-Ziel), codec (optional, 10 bit)',
  'stream.stop': 'Stream stoppen: output oder stream (ohne = alle)',
  'transport': 'Videodatei: op play|pause|toggle|stop|next|prev|forward|rewind|start|end, source (optional)',
  'audio.reset': 'Lautheit zurücksetzen (I, LRA, Max M/S, Max TP, Zähler, Protokoll; Tech 3341): source (optional; ohne = alle Quellen mit Ton)',
  'audio.pause': 'I und LRA anhalten/fortsetzen (Tech 3341): mode toggle|on|off, source (optional; ohne = alle Quellen mit Ton)',
  'generator': 'Tongenerator: mode toggle|on|off, signal (optional), freq (Hz, optional), level (dBFS, optional; über −6 nur mit force: true)',
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
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('Befehl muss ein JSON-Objekt sein');
  const c = /** @type {Record<string, unknown>} */ (raw);
  const cmd = c.cmd;
  if (!isStr(cmd) || !(cmd in COMMANDS)) return fail(`Unbekannter Befehl ${JSON.stringify(cmd)}; bekannt: ${Object.keys(COMMANDS).join(', ')}`);
  /** @type {Record<string, unknown> & { cmd: string }} */
  const out = { cmd };
  /** optional reference (panel/source/…) → number or trimmed string */
  const optRef = (key) => {
    if (c[key] === undefined || c[key] === null || c[key] === '') return null;
    if (!ref(c[key])) return `${key}: Nummer ab 1 oder Name erwartet`;
    out[key] = normRef(c[key]);
    return null;
  };
  const reqRef = (key) => (c[key] === undefined || c[key] === null || c[key] === '' ? `${key} fehlt` : optRef(key));
  const optMode = () => {
    const m = c.mode ?? 'toggle';
    if (!MODES.includes(/** @type {string} */ (m))) return 'mode: toggle, on oder off';
    out.mode = m;
    return null;
  };
  const optName = (key) => {
    if (c[key] === undefined || c[key] === '') return null;
    if (!name(c[key])) return `${key}: nur Buchstaben, Ziffern, _ und - (max. 40)`;
    out[key] = c[key];
    return null;
  };
  const optTarget = () => {
    if (c.target === undefined || c.target === '') return null;
    if (!isStr(c.target) || !/^(rtmps?|srt|rtsp|udp|tcp|rtp):\/\//i.test(c.target) || c.target.length > 2048) return 'target: rtmp(s)://, srt://, rtsp://, udp://, tcp:// oder rtp://';
    out.target = c.target;
    return null;
  };
  // 10-bit stream codec (server/out10.mjs): needs a push target
  const optCodec = () => {
    if (c.codec === undefined || c.codec === '') return null;
    if (!CODECS10.includes(/** @type {string} */ (c.codec))) return `codec: ${CODECS10.join(', ')}`;
    if (!out.target) return 'codec braucht target';
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
      if (out.panel === undefined && out.mode !== 'off') errors.push('panel fehlt');
      break;
    case 'freeze': check(optMode()); break;
    case 'roi.clear': check(optRef('source')); break;
    case 'pattern.select': check(reqRef('pattern')); check(optRef('source')); break;
    case 'pattern.next': case 'pattern.prev': check(optRef('source')); break;
    case 'output.open': {
      const view = c.view ?? 'overlay';
      if (!OUTPUT_VIEWS.includes(/** @type {string} */ (view))) errors.push(`view: ${OUTPUT_VIEWS.join(', ')}`);
      out.view = view;
      check(optName('name')); check(optRef('panel')); check(optRef('source')); check(optRef('scene'));
      const bg = c.bg ?? 'picture';
      if (bg !== 'picture' && bg !== 'black') errors.push('bg: picture oder black'); else out.bg = bg;
      if (c.display !== undefined && c.display !== '') {
        if (!(isStr(c.display) || typeof c.display === 'number') || !/^\d{1,12}$/.test(String(c.display))) errors.push('display: Bildschirm-id'); else out.display = String(c.display);
      }
      if (c.fullscreen !== undefined && typeof c.fullscreen !== 'boolean') errors.push('fullscreen: true/false'); else out.fullscreen = c.fullscreen ?? true;
      check(optName('stream')); check(optTarget()); check(optCodec());
      if (out.target && !out.stream) errors.push('target braucht stream');
      break;
    }
    case 'output.close': check(optName('name')); break;
    case 'scene.select': check(reqRef('scene')); check(optName('output')); break;
    case 'stream.start':
      check(optName('output'));
      if (!name(c.stream)) errors.push('stream: Name aus Buchstaben, Ziffern, _ und - (max. 40)'); else out.stream = c.stream;
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
        else if (l > -6 && c.force !== true) errors.push('level über −6 dBFS nur mit force: true (laut)');
        else out.level = l;
      }
      break;
    }
    case 'transport':
      if (!TRANSPORT_OPS.includes(/** @type {string} */ (c.op))) errors.push(`op: ${TRANSPORT_OPS.join(', ')}`); else out.op = c.op;
      check(optRef('source'));
      break;
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
    if (o !== host) return { status: 403, error: 'Fremde Web-Herkunft' };
  }
  if (token) return presented === token ? null : { status: 401, error: 'Token fehlt oder falsch' };
  return isLoopback(remote) ? null : { status: 403, error: 'Steuerung nur von 127.0.0.1 (oder mit Token, siehe docs/control-api.md)' };
}
