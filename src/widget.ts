// Embeddable single view (#238): `?widget=wf-luma,vector&src=decklink:0` shows up to four scopes
// of one source, full page, without the app around it – for an <iframe> in Companion, the
// camera bridge or an own page. Needs no main window: it connects to the bridge itself
// (the server that serves the page, or &bridge=ws://…), or reads a frame-protocol endpoint
// (&frames=ws://…/scope/3), or generates a test pattern (src=pattern:<id>).
//
// Every widget is its own reader of the bridge stream: several people can look at the same
// camera without changing each other's view.

import { ScopeView } from './embed';
import { Source } from './sources';
import { PATTERNS } from './patterns';
import { t } from './i18n';
import { parseWidget } from './workspace';

export function runWidget() {
  const p = parseWidget(new URLSearchParams(location.search));
  document.title = `LZ Scopes · ${p.scopes.join(' + ')}`;
  document.body.style.cssText = 'margin:0;height:100vh;background:#0b0c0e;overflow:hidden';
  const view = new ScopeView(document.body, {
    scopes: p.scopes, selectors: p.selectors, ...(p.lang ? { lang: p.lang } : {}), ...(p.unit ? { unit: p.unit } : {}),
    emptyText: p.src || p.frames ? t('output.noSignal') : t('widget.noSource'),
  });
  const bridge = p.bridge || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  let src: Source | null = null;
  if (p.src.startsWith('pattern:')) {
    const id = p.src.slice(8);
    src = new Source('pattern', id);
    if (PATTERNS.some((x) => x.id === id)) src.pattern.id = id;
    void src.startPattern();
  } else if (p.frames) {
    src = new Source('stream', 'widget');
    src.connectFrames(p.frames);
  } else if (p.src) {
    src = new Source('stream', 'widget');
    src.connectStream(p.src, bridge);
  }
  view.setSource(src);
  document.body.dataset.widget = p.scopes.join(',');
  // test and host hook: the source status (connecting / live / error)
  (window as unknown as { lzsWidget?: unknown }).lzsWidget = { scopes: p.scopes, status: () => src?.status ?? 'idle' };
  addEventListener('pagehide', () => { src?.stop(); view.destroy(); });
}
