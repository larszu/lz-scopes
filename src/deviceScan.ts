// Device discovery for the source list (#221, UX analysis 11/2026): the bridge is asked every few
// seconds which DeckLink, AJA and NDI® inputs it sees. They show as suggestions above the source
// list – nothing is added by itself, because every analysed input costs CPU and GPU.

export interface Found { url: string; name: string; kind: 'decklink' | 'aja' | 'ndi' }
interface DevList { available?: boolean; devices?: { index: number; name: string }[] }
interface NdiList { available?: boolean; sources?: { name: string }[] }

/** Suggestions from the bridge's answers, without inputs that already are sources. */
export function foundDevices(dl: DevList | null, aja: DevList | null, ndi: NdiList | null, existing: readonly string[]): Found[] {
  const have = new Set(existing);
  const out: Found[] = [];
  if (dl?.available) for (const d of dl.devices ?? []) out.push({ url: `decklink:${d.index}`, name: d.name, kind: 'decklink' });
  if (aja?.available) for (const d of aja.devices ?? []) out.push({ url: `aja:${d.index}`, name: d.name, kind: 'aja' });
  if (ndi?.available) for (const s of ndi.sources ?? []) out.push({ url: `ndi:${s.name}`, name: s.name.replace(/^.*\((.*)\)$/, '$1').slice(0, 40), kind: 'ndi' });
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
    const [dl, aja] = await Promise.all([get<DevList>(`${base}/api/decklink`), get<DevList>(`${base}/api/aja`)]);
    if (n++ % 3 === 0) ndi = await get<NdiList>(`${base}/api/ndi`);
    const list = foundDevices(dl, aja, ndi, existing());
    const sig = JSON.stringify(list);
    if (sig !== last) { last = sig; onChange(list); }
    if (!stopped) timer = setTimeout(tick, everyMs);
  };
  void tick();
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
