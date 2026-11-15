// LZ Camera Bridges in the local network (lz-scopes #224, lz-camera-bridge #291): the bridge
// announces `_lz-camera-bridge._tcp` with its NMOS port in the TXT record. The page cannot browse
// mDNS itself, so this server does and hands the list out on /api/camera-bridges.
// Library: bonjour-service (MIT, licenses/bonjour-service-LICENSE.txt). Started on the first
// request, never fatal: without multicast the list stays empty and the address field remains.

export const BRIDGE_SERVICE = 'lz-camera-bridge';

let browser = null;
const found = new Map();

/** One service record → list entry (exported for tests). */
export function entryOf(s) {
  const v4 = (s.addresses ?? []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
  const host = v4 ?? s.host ?? s.referer?.address;
  const nmos = Number(s.txt?.nmos);
  return host ? { name: String(s.name ?? host), host, port: Number(s.port), nmosPort: Number.isInteger(nmos) && nmos > 0 ? nmos : null, version: String(s.txt?.v ?? '') } : null;
}

async function start() {
  if (browser) return;
  browser = 'starting';
  try {
    const { Bonjour } = await import('bonjour-service');
    const bonjour = new Bonjour({}, () => {});
    const b = bonjour.find({ type: BRIDGE_SERVICE });
    const key = (s) => s.fqdn ?? `${s.name}:${s.port}`;
    b.on('up', (s) => { const e = entryOf(s); if (e) found.set(key(s), e); });
    b.on('down', (s) => found.delete(key(s)));
    browser = b;
  } catch {
    browser = 'failed';
  }
}

/** Bridges seen so far; the first call starts browsing (results follow within a second or two). */
export async function cameraBridges() {
  await start();
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
