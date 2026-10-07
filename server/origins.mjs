// Web origins the user has explicitly allowed to use the bridge's clock endpoint (/clock),
// e.g. the GitHub Pages copy of the UI talking to a local bridge.
//
// Why a consent page and not a setting in the UI: the page asking for access must not be able
// to grant itself access. The consent page is served by the bridge on its own origin
// (http://127.0.0.1:<port>/allow), cannot be framed, and only accepts the form when the
// browser reports the bridge's own origin plus a one-time nonce from that page.
// Matching is exact on the normalised origin (scheme://host[:port]) – no wildcards, https
// only (http only for loopback hosts).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isLoopback } from './control.mjs';

const LOOPBACK_HOSTS = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i;

/** Normalised origin or null when it may not be allowed (no wildcards, paths, credentials, opaque origins). */
export function normalizeOrigin(o) {
  if (typeof o !== 'string' || o.length > 300 || /[*\s]/.test(o)) return null;
  let u;
  try { u = new URL(o); } catch { return null; }
  if (u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return null;
  if (u.protocol === 'https:') return u.origin;
  if (u.protocol === 'http:' && LOOPBACK_HOSTS.test(u.hostname)) return u.origin;
  return null;
}

/** Default file: $LZS_CONFIG_DIR or ~/.config/lz-scopes (the desktop app passes its userData folder). */
export const defaultOriginsFile = (env = process.env) => join(env.LZS_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'lz-scopes'), 'allowed-origins.json');

export class OriginStore {
  constructor(file = null) {
    this.file = file; this.set = new Set(); this.extra = new Set();
    if (file) {
      try {
        const list = JSON.parse(readFileSync(file, 'utf8'));
        for (const o of Array.isArray(list) ? list : []) { const n = normalizeOrigin(o); if (n) this.set.add(n); }
      } catch { /* none yet */ }
    }
  }
  /** Allowed for this run only (CLI --allow-origin), not saved. */
  allowTemporarily(o) { const n = normalizeOrigin(o); if (n) this.extra.add(n); return n; }
  has(o) { const n = normalizeOrigin(o); return !!n && (this.set.has(n) || this.extra.has(n)); }
  list() { return [...new Set([...this.set, ...this.extra])].sort(); }
  add(o) { const n = normalizeOrigin(o); if (!n) return null; this.set.add(n); this.save(); return n; }
  remove(o) { const n = normalizeOrigin(o) ?? o; this.set.delete(n); this.extra.delete(n); this.save(); }
  save() {
    if (!this.file) return;
    try { mkdirSync(dirname(this.file), { recursive: true }); writeFileSync(this.file, JSON.stringify([...this.set], null, 2)); } catch { /* read-only: keep in memory */ }
  }
}

/**
 * Access to /clock: loopback clients only; a browser page either from the bridge's own origin
 * or from an origin the user allowed. Clients without Origin header (curl, tests) are local tools.
 */
export function clockAccess({ remote, origin, host, store }) {
  if (!isLoopback(remote)) return { status: 403, error: 'Uhr nur von 127.0.0.1' };
  if (!origin) return null;
  let o = '';
  try { o = new URL(origin).host; } catch { /* malformed */ }
  if (o === host) return null;
  return store?.has(origin) ? null : { status: 403, error: 'Web-Herkunft nicht freigegeben (Bridge: /allow)' };
}

// ---- consent page

const nonces = new Map(); // nonce → expiry (ms)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function newNonce(now = Date.now()) {
  for (const [k, t] of nonces) if (t < now) nonces.delete(k);
  const n = randomBytes(16).toString('hex');
  nonces.set(n, now + 5 * 60 * 1000);
  return n;
}
export function takeNonce(n, now = Date.now()) {
  const t = nonces.get(n);
  nonces.delete(n);
  return !!t && t >= now;
}

/** HTML of GET /allow?origin=… */
export function consentPage(requested, store, nonce) {
  const n = normalizeOrigin(requested ?? '');
  const rows = store.list().map((o) => `<li><code>${esc(o)}</code> <form method="post"><input type="hidden" name="nonce" value="${nonce}"><input type="hidden" name="origin" value="${esc(o)}"><button name="action" value="remove">Entfernen</button></form></li>`).join('');
  const ask = requested
    ? n
      ? store.has(n)
        ? `<p><code>${esc(n)}</code> ist bereits freigegeben.</p>`
        : `<p>Die Web-Oberfläche <code>${esc(n)}</code> möchte die Uhr dieser Bridge nutzen: PTP-Status mit Grandmaster und IP-Adressen der Netzwerk-Schnittstellen, ST-2110-RTP-Prüfung (Multicast-Gruppe empfangen). Streams und Steuerung bleiben davon unberührt.</p>
           <p>Nur zulassen, wenn Sie diese Adresse kennen und ihr vertrauen.</p>
           <form method="post"><input type="hidden" name="nonce" value="${nonce}"><input type="hidden" name="origin" value="${esc(n)}"><button name="action" value="add">Diese Web-Oberfläche zulassen</button></form>`
      : `<p>Ungültige Herkunft <code>${esc(requested)}</code> – nur https:// (oder http:// auf diesem Rechner), ohne Pfad und ohne Platzhalter.</p>`
    : '';
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>LZ Scopes Bridge – Freigaben</title>
<style>body{font:15px system-ui;background:#111;color:#ddd;max-width:640px;margin:40px auto;padding:0 16px}code{color:#ffb840}button{font:inherit;padding:6px 12px;margin:4px 0}li form{display:inline}</style></head>
<body><h1>LZ Scopes Bridge – Freigaben</h1>${ask}<h2>Freigegebene Web-Oberflächen</h2>${rows ? `<ul>${rows}</ul>` : '<p>keine</p>'}</body></html>`;
}

/** Headers for the consent page: no framing, no foreign scripts. */
export const CONSENT_HEADERS = {
  'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY', 'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
};
