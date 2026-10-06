// Source sidebar: "DaVinci Resolve läuft: Projekt / Timeline – Verbinden". Polls the
// bridge's /api/resolve (server/resolve.mjs) while the page is visible.

export interface ResolveStatus {
  running: boolean; scripting?: boolean; reason?: 'off' | 'python' | 'module'; error?: string;
  product?: string; version?: string; page?: string; project?: string | null; timeline?: string | null; tc?: string;
}

export interface ResolveLiveOptions {
  /** http(s) base of the bridge */
  http: () => string;
  /** add + connect the Resolve source */
  connect: () => void;
  /** is a Resolve source already connected? */
  connected: () => boolean;
}

/** Text lines for a status (pure, tested). */
export function resolveLines(st: ResolveStatus): { title: string; detail: string; canConnect: boolean } | null {
  if (!st.running) return null;
  const name = `${st.product ?? 'DaVinci Resolve'}${st.version ? ` ${st.version.split('.').slice(0, 3).join('.')}` : ''}`;
  if (!st.scripting) {
    const detail = st.reason === 'python' ? 'Python 3 fehlt auf diesem Rechner (für die Scripting-Anbindung nötig).'
      : st.reason === 'module' ? `Scripting-Modul nicht gefunden: ${st.error ?? ''}`
        : 'Externes Scripting ist aus. In Resolve: Einstellungen → System → Allgemein → „Externes Scripting“ auf „Lokal“ stellen (laut Blackmagic-Doku in Resolve Studio).';
    return { title: 'DaVinci Resolve läuft', detail, canConnect: false };
  }
  const where = st.project ? `${st.project}${st.timeline ? ` / ${st.timeline}` : ' – keine Timeline offen'}` : 'kein Projekt offen';
  return { title: `${name} läuft`, detail: where, canConnect: true };
}

export function mountResolveLive(host: HTMLElement, o: ResolveLiveOptions) {
  let last = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const render = (st: ResolveStatus | null) => {
    const l = st ? resolveLines(st) : null;
    const key = JSON.stringify([l, o.connected()]);
    if (key === last) return;
    last = key;
    if (!l) { host.replaceChildren(); host.hidden = true; return; }
    host.hidden = false;
    const btn = document.createElement('button');
    btn.className = 'primary mini';
    btn.textContent = o.connected() ? 'verbunden' : 'Verbinden';
    btn.disabled = !l.canConnect || o.connected();
    btn.title = 'Aktuelles Bild aus dem Resolve-Viewer (gegradet, 16 bit) über die Scripting-API';
    btn.onclick = () => { o.connect(); last = ''; poll(); };
    const title = document.createElement('div'); title.className = 'rl-title'; title.textContent = l.title;
    const detail = document.createElement('div'); detail.className = 'rl-detail'; detail.textContent = l.detail;
    const text = document.createElement('div'); text.className = 'rl-text'; text.append(title, detail);
    host.replaceChildren(text, btn);
  };
  const poll = async () => {
    if (timer) clearTimeout(timer);
    if (document.visibilityState === 'visible') {
      let st: ResolveStatus | null = null;
      try {
        const r = await fetch(`${o.http()}/api/resolve`);
        if (r.ok) st = await r.json();
      } catch { /* no bridge (web build alone) */ }
      render(st);
    }
    timer = setTimeout(poll, 4000);
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') poll(); });
  poll();
}
