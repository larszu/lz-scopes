// Operation dialogs (#239): the bridge's event log (server/eventlog.mjs, GET /api/events) and
// the explanation cards per measured value (src/valueCards.ts). Both refresh while they are open.

import { button, download, h, hint, openModal, row, select, table } from './ui';
import { hasKey, t, type Key } from './i18n';
import { valueCards, type ValueInput } from './valueCards';

interface EventEntry { id: number; t: number; kind: string; source: string; item: string; from: string | null; to: string }

const KINDS = ['flow', 'format', 'audio', 'ptp', 'lock', 'rtp'] as const;
const label = (prefix: string, v: string) => (hasKey(`${prefix}.${v}`) ? t(`${prefix}.${v}` as Key) : v);
const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

/** Sources → Event log …: everything the bridge noticed, newest first, export as CSV or JSON. */
export function openEventLog(http: () => string) {
  let events: EventEntry[] = [];
  let kind = '';
  let problem = '';
  const status = hint('');
  const list = h('div', { class: 'table-wrap ops-events' });
  const render = () => {
    const shown = events.filter((e) => !kind || e.kind === kind).slice().reverse();
    status.textContent = problem || t('ops.ev.count', { n: shown.length, all: events.length });
    list.replaceChildren(shown.length ? table(shown.map((e) => [
      new Date(e.t).toLocaleTimeString(), label('ops.kind', e.kind), e.source, label('ops.item', e.item),
      e.from === null ? t('ops.ev.first', { to: label('ops.val', e.to) }) : t('ops.ev.change', { from: label('ops.val', e.from), to: label('ops.val', e.to) }),
    ]), { head: [t('ops.ev.time'), t('ops.ev.kind'), t('ops.ev.source'), t('ops.ev.item'), t('ops.ev.value')] }) : hint(problem ? '' : t('ops.ev.empty')));
  };
  const load = async () => {
    try {
      const r = await fetch(`${http()}/api/events`);
      if (!r.ok) { problem = t('ops.ev.denied', { status: r.status }); render(); return; }
      events = ((await r.json()) as { events: EventEntry[] }).events;
      problem = '';
    } catch { problem = t('ops.ev.noBridge'); }
    render();
  };
  const kinds = select('', [['', t('ops.ev.all')], ...KINDS.map((k): [string, string] => [k, label('ops.kind', k)])], (v) => { kind = v; render(); }, t('ops.ev.kind'));
  const timer = window.setInterval(() => void load(), 2000);
  openModal({
    title: t('ops.ev.title'), size: 'lg', cls: 'ops',
    body: [hint(t('ops.ev.intro')), row(kinds, status), list],
    actions: [
      button(t('ops.ev.csv'), () => { void fetch(`${http()}/api/events?format=csv`).then((r) => r.text()).then((x) => download(`lz-scopes-events-${stamp()}.csv`, x, 'text/csv;charset=utf-8')).catch(() => {}); }),
      button(t('ops.ev.json'), () => download(`lz-scopes-events-${stamp()}.json`, JSON.stringify(events, null, 2), 'application/json')),
      button(t('ops.ev.clear'), () => { void fetch(`${http()}/api/events`, { method: 'DELETE' }).then(() => load()).catch(() => {}); }),
    ],
    onClose: () => clearInterval(timer),
  });
  void load();
}

/** Help → Measured values explained …: one card per value of the current source. */
export function openValueCards(input: () => { name: string; values: ValueInput } | null) {
  const body = h('div', { class: 'ops-cards' });
  const head = hint('');
  const render = () => {
    const cur = input();
    if (!cur) { head.textContent = t('ops.vc.noSource'); body.replaceChildren(); return; }
    head.textContent = t('ops.vc.for', { name: cur.name });
    const cards = valueCards(cur.values);
    // details that are open stay open across refreshes
    const open = new Set([...body.querySelectorAll<HTMLDetailsElement>('details[open]')].map((d) => d.dataset.id));
    body.replaceChildren(...(cards.length ? cards.map((c) => h('details', { class: 'ops-card', 'data-id': c.id, open: open.has(c.id) },
      h('summary', {}, h('strong', {}, c.name), ' ', h('span', { class: 'ops-value' }, c.value)),
      h('p', {}, c.what),
      h('p', { class: 'ops-formula' }, c.formula),
      h('p', { class: 'hint' }, t('ops.vc.source', { source: c.source })))) : [hint(t('ops.vc.none'))]));
  };
  const timer = window.setInterval(render, 500);
  openModal({ title: t('ops.vc.title'), size: 'md', cls: 'ops', body: [hint(t('ops.vc.intro')), head, body], onClose: () => clearInterval(timer) });
  render();
}
