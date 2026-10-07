// Source sidebar: "DaVinci Resolve läuft: Projekt / Timeline – Verbinden". Polls the
// bridge's /api/resolve (server/resolve.mjs) while the page is visible.

import { t } from './i18n';

export interface ResolveStatus {
  running: boolean; scripting?: boolean; busy?: boolean; reason?: 'off' | 'python' | 'module'; error?: string;
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
    const detail = st.reason === 'python' ? t('source.resolve.noPython')
      : st.reason === 'module' ? t('source.resolve.noModule', { error: st.error ?? '' })
        : t('source.resolve.scriptingOff');
    return { title: t('source.resolve.resolveRunning'), detail, canConnect: false };
  }
  // #88: during playback the probe gets no answer – last known project, and why
  if (st.busy) return { title: t('source.resolve.running', { name }), detail: `${st.project ? `${st.project}${st.timeline ? ` / ${st.timeline}` : ''} – ` : ''}${t('source.resolve.busy')}`, canConnect: true };
  const where = st.project ? `${st.project}${st.timeline ? ` / ${st.timeline}` : ` – ${t('source.resolve.noTimeline')}`}` : t('source.resolve.noProject');
  return { title: t('source.resolve.running', { name }), detail: where, canConnect: true };
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
    btn.textContent = o.connected() ? t('source.resolve.connected') : t('source.resolve.connect');
    btn.disabled = !l.canConnect || o.connected();
    btn.title = t('source.resolve.connectTitle');
    btn.onclick = () => { o.connect(); last = ''; poll(); };
    const title = document.createElement('div'); title.className = 'rl-title'; title.textContent = l.title;
    const detail = document.createElement('div'); detail.className = 'rl-detail'; detail.textContent = l.detail;
    const text = document.createElement('div'); text.className = 'rl-text'; text.append(title, detail);
    // nothing to click while scripting is off: the text says what to do
    host.replaceChildren(...(l.canConnect ? [text, btn] : [text]));
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
