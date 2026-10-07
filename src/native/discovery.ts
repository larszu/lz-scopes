// Bridge discovery for the iOS/iPadOS app (docs/ios.md): the native plugin (ios/App/App/LzNative.swift)
// browses Bonjour for `_lz-scopes._tcp` (announced by server/bonjour.mjs); these helpers turn what
// it finds into the bridge address the web app expects (ws://host:port, see bridgeUrl in main.ts).
// Pure functions, tested in test/native.test.ts.

export interface FoundBridge {
  /** Bonjour instance name, e.g. "LZ Scopes (Studio-Mac)" */
  name: string;
  /** host name of the resolved service, e.g. "Studio-Mac.local." */
  host: string;
  port: number;
  /** numeric addresses, IPv4 first */
  addresses: string[];
  txt?: Record<string, string>;
}

/** ws:// address for a found bridge: first IPv4, else IPv6 in brackets, else the .local host name. */
export function bridgeAddress(b: FoundBridge): string {
  const v4 = b.addresses.find((a) => /^\d{1,3}(\.\d{1,3}){3}$/.test(a));
  const v6 = b.addresses.find((a) => a.includes(':'));
  const host = v4 ?? (v6 ? `[${v6}]` : b.host.replace(/\.$/, ''));
  return `ws://${host}:${b.port}`;
}

/**
 * Normalise what someone types into the bridge field: "192.168.1.20:4192" or "studio.local"
 * become ws://…; http(s):// and ws(s):// stay; a missing port means 4192 (the bridge default).
 */
export function normaliseBridgeInput(v: string): string {
  const t = v.trim().replace(/\/+$/, '');
  if (!t) return '';
  if (/^(wss?|https?):\/\//i.test(t)) return t;
  const hasPort = /^\[[^\]]+\]:\d+$/.test(t) || /^[^:[\]]+:\d+$/.test(t);
  return `ws://${t}${hasPort ? '' : ':4192'}`;
}

/** Unique by address, sorted by name (several interfaces announce the same bridge). */
export function uniqueBridges(list: FoundBridge[]): FoundBridge[] {
  const seen = new Set<string>();
  return list
    .filter((b) => b.port > 0 && (b.addresses.length > 0 || b.host))
    .filter((b) => { const k = bridgeAddress(b); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.name.localeCompare(b.name));
}
