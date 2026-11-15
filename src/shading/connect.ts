// Which camera bridge, which way (#224): a choice from a list instead of a typed address.
//   bridge "local"  – the bridge on this machine (built into the desktop app, or the LZ Camera
//                     Bridge app), port 9700
//   bridge "<host>:<port>" – one the scopes server found via DNS-SD (_lz-camera-bridge._tcp)
//   bridge "manual" – an address typed under "Advanced" (old behaviour, kept for odd networks)
//   route "bridge"  – the bridge's own WebSocket;  route "nmos" – NMOS IS-12 on the bridge's node
// The address the link uses is derived from that; nobody types a port.

export interface FoundBridge { name: string; host: string; port: number; nmosPort: number | null; version: string }
export type Route = 'bridge' | 'nmos';
export interface Choice { bridge: string; route: Route; manualUrl: string }

export const LOCAL = 'local';
export const MANUAL = 'manual';
export const DEFAULT_CHOICE: Choice = { bridge: LOCAL, route: 'bridge', manualUrl: 'ws://localhost:9700' };

export const keyOf = (b: FoundBridge) => `${b.host}:${b.port}`;

/**
 * Address for the link. `localNmos`: the NMOS port the local bridge reported (bridgeInfo);
 * `localPort`: where the built-in bridge listens. NMOS without a known port falls back to the
 * bridge route – a guess would only fail.
 */
export function urlFor(c: Choice, found: FoundBridge[], local: { port: number; nmosPort: number | null }): string {
  if (c.bridge === MANUAL) return c.manualUrl.trim();
  const f = c.bridge === LOCAL ? { host: 'localhost', port: local.port, nmosPort: local.nmosPort } : found.find((b) => keyOf(b) === c.bridge);
  if (!f) return '';
  if (c.route === 'nmos' && f.nmosPort) return `http://${f.host}:${f.nmosPort}`;
  return `ws://${f.host}:${f.port}`;
}

/** Can the chosen bridge do NMOS? */
export function nmosAvailable(c: Choice, found: FoundBridge[], localNmos: number | null): boolean {
  if (c.bridge === MANUAL) return false;
  if (c.bridge === LOCAL) return !!localNmos;
  return !!found.find((b) => keyOf(b) === c.bridge)?.nmosPort;
}

/** Bridges in the network, from the scopes server; [] when it cannot answer. */
export async function fetchFound(base: string): Promise<FoundBridge[]> {
  try {
    const r = await fetch(`${base}/api/camera-bridges`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return [];
    const list = (await r.json()) as FoundBridge[];
    return Array.isArray(list) ? list.filter((b) => b && typeof b.host === 'string' && Number.isInteger(b.port)) : [];
  } catch {
    return [];
  }
}

/** Old setting (a typed address) → choice, so nobody loses a working setup. */
export function choiceFromUrl(url: string | undefined): Choice {
  if (!url || /^ws:\/\/(localhost|127\.0\.0\.1):9700\/?$/.test(url.trim())) return { ...DEFAULT_CHOICE };
  return { bridge: MANUAL, route: 'bridge', manualUrl: url };
}
