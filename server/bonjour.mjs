// Announce the bridge in the local network via Bonjour/mDNS (DNS-SD), service type
// `_lz-scopes._tcp`, so the iPhone/iPad app finds it (ios/App/App/LzNative.swift, docs/ios.md).
// Library: bonjour-service (MIT, licenses/bonjour-service-LICENSE.txt).
//
// Only when the bridge listens beyond loopback (--host 0.0.0.0 / LZS_HOST=0.0.0.0): a bridge on
// 127.0.0.1 cannot be reached from another device, so announcing it would only mislead.
// LZS_BONJOUR=0 switches the announcement off.

import os from 'node:os';

export const SERVICE_TYPE = 'lz-scopes';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1']);

/** Announce for this listen address? */
export function shouldAnnounce(host, env = process.env) {
  if (env.LZS_BONJOUR === '0') return false;
  const h = String(host ?? '').trim().toLowerCase();
  if (!h) return true; // Node's default: all interfaces
  return !LOOPBACK.has(h) && !h.startsWith('127.');
}

const shortHost = (hostname) => hostname.replace(/\.local\.?$/i, '').split('.')[0] || 'Bridge';

/** Instance name shown in the app: "LZ Scopes (Studio-Mac)". */
export function instanceName(hostname = os.hostname()) {
  return `LZ Scopes (${shortHost(hostname).slice(0, 40)})`;
}

/** SRV target: always "<name>.local" (os.hostname() on macOS often lacks the .local). */
export function srvHost(hostname = os.hostname()) {
  return `${shortHost(hostname)}.local`;
}

/**
 * Publish `_lz-scopes._tcp` on `port`. Resolves to { stop } or null (not announced / no mDNS).
 * Never throws: discovery is a convenience, the bridge works without it.
 */
export async function announce({ port, host }) {
  if (!shouldAnnounce(host)) return null;
  try {
    const { Bonjour } = await import('bonjour-service');
    // a network without multicast route (some VMs, CI) fails on every send: warn once
    let warned = false;
    const warn = (err) => { if (!warned) console.warn(`Bonjour: ${err?.message ?? err} (Ankündigung im Netz nicht möglich)`); warned = true; };
    const bonjour = new Bonjour({}, warn);
    const service = bonjour.publish({ name: instanceName(), host: srvHost(), type: SERVICE_TYPE, protocol: 'tcp', port, txt: { v: '1', path: '/' } });
    service.on?.('error', warn);
    return {
      name: service.name,
      stop: () => new Promise((ok) => bonjour.unpublishAll(() => bonjour.destroy(() => ok()))),
    };
  } catch (err) {
    console.warn(`Bonjour nicht verfügbar: ${err?.message ?? err}`);
    return null;
  }
}
