// Device discovery for the source list (#221, UX analysis 11/2026): the bridge is asked every few
// seconds which DeckLink, AJA and NDI® inputs it sees, and which ST 2110 network inputs carry an SDP. They show as suggestions above the source
// list – nothing is added by itself, because every analysed input costs CPU and GPU.

export interface Found { url: string; name: string; kind: 'decklink' | 'aja' | 'ndi' | 'st2110' }
interface DevList { available?: boolean; devices?: { index: number; name: string }[] }
interface NdiList { available?: boolean; sources?: { name: string }[] }
/** GET /api/st2110 (server/st2110/service.mjs): network inputs; connected ones have an SDP */
interface NetList { inputs?: { url: string; connected: boolean; summary?: { name?: string; format?: string } | null }[] }

/** Suggestions from the bridge's answers, without inputs that already are sources. */
export function foundDevices(dl: DevList | null, aja: DevList | null, ndi: NdiList | null, existing: readonly string[], net: NetList | null = null): Found[] {
  const have = new Set(existing);
  const out: Found[] = [];
  if (dl?.available) for (const d of dl.devices ?? []) out.push({ url: `decklink:${d.index}`, name: d.name, kind: 'decklink' });
  if (aja?.available) for (const d of aja.devices ?? []) out.push({ url: `aja:${d.index}`, name: d.name, kind: 'aja' });
  if (ndi?.available) for (const s of ndi.sources ?? []) out.push({ url: `ndi:${s.name}`, name: s.name.replace(/^.*\((.*)\)$/, '$1').slice(0, 40), kind: 'ndi' });
  for (const i of net?.inputs ?? []) if (i.connected) out.push({ url: i.url, name: (i.summary?.name || i.summary?.format || i.url).slice(0, 40), kind: 'st2110' });
  return out.filter((f) => !have.has(f.url));
}

const get = async <T>(url: string): Promise<T | null> => {
  try { const r = await fetch(url); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
};

/** Polls the bridge; `onChange` gets the full list whenever it changed. NDI discovery is asked less often. */
export function watchDevices(http: () => string, existing: () => readonly string[], onChange: (f: Found[]) => void, everyMs = 5000): () => void {
  let last = '', n = 0, ndi: NdiList | null = null, stopped = false, timer: ReturnType<typeof setTimeout> | null = null;
  const tick = async () => {
    if (stopped) return;
    const base = http();
    const [dl, aja, net] = await Promise.all([get<DevList>(`${base}/api/decklink`), get<DevList>(`${base}/api/aja`), get<NetList>(`${base}/api/st2110`)]);
    if (n++ % 3 === 0) ndi = await get<NdiList>(`${base}/api/ndi`);
    const list = foundDevices(dl, aja, ndi, existing(), net);
    const sig = JSON.stringify(list);
    if (sig !== last) { last = sig; onChange(list); }
    if (!stopped) timer = setTimeout(tick, everyMs);
  };
  void tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
