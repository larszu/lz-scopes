// Control API commands (Bitfocus Companion, curl, …): validation and normalisation.
// Shared by the bridge (server/index.mjs) and the main window (src/main.ts), which
// executes them. Plain JS so the bridge can run without a build step.
//
// A command is a JSON object { cmd: '<name>', …arguments }. validateCommand() returns
// { ok: true, command } with defaults filled in, or { ok: false, error }.
// Panels, sources and layout presets are 1-based numbers or names/ids, as a user
// sees them; the main window resolves them.

export const OVERLAY_SCOPES = ['wf-luma', 'wf-color', 'wf-skin', 'wf-rgb', 'parade', 'yrgb', 'ycbcr', 'vector', 'cie', 'hist'];
export const AUDIO_SCOPES = ['audio-meter', 'audio-loudness', 'audio-spectrum', 'audio-phase'];
export const PANEL_SCOPES = ['picture', ...OVERLAY_SCOPES, 'stats', ...AUDIO_SCOPES];
export const OUTPUT_VIEWS = ['grid', 'panel', 'clean', 'overlay'];
export const TRANSPORT_OPS = ['play', 'pause', 'toggle', 'stop', 'next', 'prev', 'forward', 'rewind', 'start', 'end'];
const MODES = ['toggle', 'on', 'off'];

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
  'output.open': 'Ausgabe öffnen: name, view grid|panel|clean|overlay, panel, source, scene, bg picture|black, display, fullscreen, stream, target',
  'output.close': 'Ausgabe schließen: name (ohne = alle)',
  'scene.select': 'Overlay-Szene wählen: scene (Name oder id), output (optional; ohne = alle Overlay-Ausgaben und Vorgabe)',
  'stream.start': 'Stream einer Ausgabe starten: output (optional), stream (Name), target (optional Push-Ziel)',
  'stream.stop': 'Stream stoppen: output oder stream (ohne = alle)',
  'transport': 'Videodatei: op play|pause|toggle|stop|next|prev|forward|rewind|start|end, source (optional)',
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
    if (!isStr(c.target) || !/^(rtmps?|srt|rtsp|udp):\/\//i.test(c.target) || c.target.length > 2048) return 'target: rtmp(s)://, srt://, rtsp:// oder udp://';
    out.target = c.target;
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
      check(optName('stream')); check(optTarget());
      if (out.target && !out.stream) errors.push('target braucht stream');
      break;
    }
    case 'output.close': check(optName('name')); break;
    case 'scene.select': check(reqRef('scene')); check(optName('output')); break;
    case 'stream.start':
      check(optName('output'));
      if (!name(c.stream)) errors.push('stream: Name aus Buchstaben, Ziffern, _ und - (max. 40)'); else out.stream = c.stream;
      check(optTarget());
      break;
    case 'stream.stop': check(optName('output')); check(optName('stream')); break;
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
