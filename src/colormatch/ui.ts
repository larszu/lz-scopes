// Camera colour match dialog (docs/research/farbabgleich-werkzeug.md): reference on the left
// (any source, or the chart's reference values) with "Get colours", target cameras on the right
// with "Match", progress, cancel, before/after and Multi. The loop is engine.ts.

import type { Source } from '../sources';
import type { CameraBridgeLink } from '../shading/bridge';
import type { Pt } from '../led/analysis';
import { grabFrame } from '../led/ui';
import { openChartCorners } from '../match/chartUi';
import { toPixels } from '../match/chart';
import { convertSignal, type Rgb } from '../match/core';
import { spaceOf } from '../match/panel';
import type { Space } from '../deltae';
import { button, checkbox, chip, h, hint, openModal, segmented, select, textInput } from '../ui';
import { t, type Key } from '../i18n';
import { CHARTS, CHART_SPECS, type ChartDef, type ChartId } from './charts';
import { detectChart } from './detect';
import { toFractions } from '../match/chart';
import { defaultCorners, measureChart, summary, type Patches } from './measure';
import { runMatch, type MatchCamera, type Stage, type Values } from './engine';
import { BmdRestCamera, BridgeCamera, GuideCamera, GUIDE_PARAMS, type GuideChange } from './adapters';
import { SimCamera, sceneOf } from './sim';

export interface ColorMatchHost { sources: () => Source[]; link: CameraBridgeLink }

const SIM = 'sim', VALUES = 'values';
const SIM_SPACE: Space = { transfer: 'sdr', gamut: '709', hlgLw: 1000 };
const fmt = (v: number) => (Number.isFinite(v) ? v.toLocaleString('de-DE', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : '–');
const grade = (v: number | null): 'ok' | 'warn' | 'bad' | undefined => (v == null ? undefined : v <= 1 ? 'ok' : v <= 3 ? 'warn' : 'bad');

/** Corners per source id, as fractions of the picture; kept for the session. */
const corners = new Map<string, Pt[]>();

interface Target { source: string; control: string; host: string; result?: { before: Values; after: Values; cam: MatchCamera } }

export function openColorMatch(host: ColorMatchHost) {
  let chartId: ChartId = 'classic24', refId = VALUES, ref: { patches: Patches; space: Space } | null = null;
  let multi = false, running: AbortController | null = null, view: 'before' | 'after' = 'after';
  const targets: Target[] = [{ source: SIM, control: SIM, host: '' }];
  const chart = (): ChartDef => CHARTS[chartId];

  const left = h('section', { class: 'cm-card' });
  const right = h('section', { class: 'cm-card' });
  const status = h('p', { class: 'hint', 'aria-live': 'polite' });
  const bar = h('progress', { max: 1, value: 0, class: 'cm-progress' });
  const guideBox = h('div', { class: 'cm-guide', hidden: true });
  const fields = h('div', { class: 'cm-fields' });
  const kpis = h('div', { class: 'cm-kpis' });

  const srcOptions = (withExtra: [string, string][]) => [...withExtra, ...host.sources().map((s): [string, string] => [s.id, s.name])];
  const srcById = (id: string) => host.sources().find((s) => s.id === id);

  function measureSource(s: Source): { patches: Patches; space: Space } | null {
    const f = grabFrame(s);
    if (!f) return null;
    let c = corners.get(s.id);
    if (!c) { const d = detectChart(f, { aspect: chart().aspect }); if (d) { c = toFractions(d.corners, f.width, f.height); corners.set(s.id, c); } }
    return { patches: measureChart(f, c ? toPixels(c, f.width, f.height) : defaultCorners(f.width, f.height), chart()), space: spaceOf(s) };
  }

  function getColor() {
    const c = chart();
    if (refId === VALUES) {
      if (!c.reference) { status.textContent = t((c.note ?? 'cm.templateNote') as Key); return; }
      ref = { patches: c.reference(SIM_SPACE), space: SIM_SPACE };
    } else {
      const s = srcById(refId);
      const m = s && measureSource(s);
      if (!m) { status.textContent = t('cm.noPicture', { name: s?.name ?? '?' }); return; }
      ref = m;
    }
    status.textContent = t('cm.got', { n: ref.patches.filter(Boolean).length });
    showFields(null);
  }

  function renderLeft() {
    const opts = srcOptions(chart().reference ? [[VALUES, t('cm.chartValues')]] : []);
    if (!opts.some(([v]) => v === refId)) refId = opts[0]?.[0] ?? VALUES;
    const s = srcById(refId);
    left.replaceChildren(
      h('h3', { class: 'kicker' }, t('cm.reference')),
      h('label', { class: 'field' }, t('cm.chart'), select(chartId, CHART_SPECS.map((c) => [c.id, c.name] as const), (v) => { chartId = v; ref = null; corners.clear(); renderLeft(); }, t('cm.chart'))),
      chart().note ? hint(t(chart().note as Key)) : '',
      h('label', { class: 'field' }, t('cm.source'), select(refId, opts, (v) => { refId = v; ref = null; renderLeft(); })),
      h('div', { class: 'cm-actions' },
        s ? button(t('cm.detect'), () => {
          const f = grabFrame(s), d = f && detectChart(f, { aspect: chart().aspect });
          if (f && d) { corners.set(s.id, toFractions(d.corners, f.width, f.height)); status.textContent = t('cm.detected', { name: s.name }); } else status.textContent = t('cm.detectFail', { name: s.name });
        }, { variant: 'ghost' }) : '',
        s ? button(t('cm.corners'), () => openChartCorners(s, corners.get(s.id), (pts) => { if (pts) corners.set(s.id, pts); else corners.delete(s.id); }, chart()), { variant: 'ghost' }) : '',
        button(t('cm.getColor'), getColor, { variant: 'primary' })),
    );
  }

  function controlOptions() {
    const list: [string, string][] = [[SIM, t('cm.ctlSim')], ['guide', t('cm.ctlGuide')], ['bmd', t('cm.ctlBmd')]];
    for (const c of host.link.cameras) list.push([`bridge:${c.cameraNumber}`, t('cm.ctlBridge', { n: c.cameraNumber, label: c.label })]);
    return list;
  }

  function renderRight() {
    const rows = (multi ? targets : targets.slice(0, 1)).map((tg, i) => h('div', { class: 'cm-target' },
      h('label', { class: 'field' }, t('cm.source'), select(tg.source, srcOptions([[SIM, t('cm.ctlSim')]]), (v) => { tg.source = v; if (v === SIM) tg.control = SIM; renderRight(); })),
      tg.source === SIM ? '' : h('label', { class: 'field' }, t('cm.control'), select(tg.control, controlOptions(), (v) => { tg.control = v; renderRight(); })),
      tg.control === 'bmd' && tg.source !== SIM ? textInput(tg.host, (v) => { tg.host = v; }, { placeholder: t('cm.bmdHost'), mono: true }) : '',
      multi && targets.length > 1 ? button(t('cm.removeTarget'), () => { targets.splice(i, 1); renderRight(); }, { variant: 'ghost' }) : '',
    ));
    const done = targets.some((x) => x.result);
    right.replaceChildren(
      h('h3', { class: 'kicker' }, t('cm.target')),
      ...rows,
      h('div', { class: 'cm-actions' },
        checkbox(multi, t('cm.multi'), (v) => { multi = v; renderRight(); }, t('cm.multiTitle')),
        multi ? button(t('cm.addTarget'), () => { targets.push({ source: SIM, control: SIM, host: '' }); renderRight(); }, { variant: 'ghost' }) : '',
        done ? segmented(view, [['before', t('cm.before')], ['after', t('cm.after')]], (v) => { void toggleView(v as 'before' | 'after'); }, `${t('cm.before')} / ${t('cm.after')}`) : ''),
      h('div', { class: 'cm-actions' },
        running ? button(t('cm.cancel'), () => running?.abort(), { variant: 'ghost' }) : '',
        button(t('cm.match'), () => { void match(); }, { variant: 'primary', attrs: running ? { disabled: '' } : {} })),
      bar, status, guideBox,
    );
  }

  async function toggleView(v: 'before' | 'after') {
    view = v;
    for (const tg of targets) if (tg.result) await tg.result.cam.write(v === 'before' ? tg.result.before : tg.result.after).catch(() => {});
    renderRight();
  }

  function guideAsk(changes: GuideChange[]): Promise<void> {
    return new Promise((resolve) => {
      guideBox.hidden = false;
      const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
      guideBox.replaceChildren(
        h('p', null, t('cm.guideAsk')),
        h('ul', null, ...changes.map((c) => h('li', null, t('cm.guideLine', { param: c.param.label, from: sign(c.from), to: sign(c.to) })))),
        button(t('cm.guideDone'), () => { guideBox.hidden = true; resolve(); }, { variant: 'primary' }),
      );
      running?.signal.addEventListener('abort', () => { guideBox.hidden = true; resolve(); }, { once: true });
    });
  }

  function cameraFor(tg: Target, sim: SimCamera | null): MatchCamera {
    if (sim) return sim;
    if (tg.control === 'guide') return new GuideCamera(GUIDE_PARAMS, guideAsk);
    if (tg.control === 'bmd') return new BmdRestCamera(tg.host);
    const n = Number(tg.control.split(':')[1]);
    return new BridgeCamera(host.link, n, host.link.cameras.find((c) => c.cameraNumber === n)?.mode ?? '');
  }

  async function match() {
    if (!ref) { status.textContent = t('cm.noRef'); return; }
    running = new AbortController();
    renderRight();
    try {
      for (const tg of multi ? targets : targets.slice(0, 1)) {
        if (running.signal.aborted) break;
        const src = tg.source === SIM ? null : srcById(tg.source);
        const sim = tg.source === SIM ? new SimCamera(sceneOf(chart()), { blackR: 5, blackB: -4, whiteR: 12, whiteB: -9, gamma: 14, 'matrix.rg': 16, 'axis2.hue': 6 }, { now: () => performance.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }, 150) : null;
        const space = src ? spaceOf(src) : SIM_SPACE;
        const target = ref.patches.map((p) => (p ? convertSignal(p, ref!.space, space) as Rgb : null));
        const measure = async () => {
          if (sim) return sim.patches();
          const m = src && measureSource(src);
          if (!m) throw new Error(t('cm.noPicture', { name: src?.name ?? '?' }));
          return m.patches;
        };
        const cam = cameraFor(tg, sim);
        const r = await runMatch({
          camera: cam, measure, target, space, chart: chart(), signal: running.signal, manual: tg.control === 'guide' && !sim,
          onEvent: (e) => {
            if (e.kind === 'latency') status.textContent = e.ms == null ? t('cm.latencyNone') : t('cm.latency', { ms: Math.round(e.ms) });
            else if (e.kind === 'stage') status.textContent = t('cm.running', { stage: t(`cm.stage.${e.stage}` as Key) });
            else if (e.kind === 'skip') status.textContent = t('cm.skip', { stage: t(`cm.stage.${e.stage as Stage}` as Key) });
            else if (e.kind === 'measure') { bar.value = e.progress; showFields(e.de); }
          },
        });
        tg.result = { before: r.before, after: r.after, cam };
        view = 'after';
        status.textContent = r.aborted ? t('cm.aborted') : t('cm.done', { from: fmt(r.startDe), to: fmt(r.endDe) });
        if (!r.aborted) bar.value = 1;
      }
    } catch (e) {
      status.textContent = t('cm.error', { msg: (e as Error).message });
    } finally {
      running = null;
      guideBox.hidden = true;
      renderRight();
    }
  }

  function showFields(de: (number | null)[] | null) {
    const c = chart();
    if (!ref) { fields.replaceChildren(); kpis.replaceChildren(); return; }
    const s = de ? summary(de) : null;
    kpis.replaceChildren(
      h('div', { class: 'cm-kpi' }, h('span', null, t('cm.mean')), h('b', null, s ? fmt(s.mean) : '–')),
      h('div', { class: 'cm-kpi' }, h('span', null, t('cm.max')), h('b', null, s ? fmt(s.max) : '–')),
    );
    fields.style.setProperty('--cols', String(Math.min(8, Math.ceil(Math.sqrt(c.patches.length * c.aspect)))));
    fields.replaceChildren(...c.patches.map((p, i) => {
      const q = ref!.patches[i], v = de?.[i] ?? null;
      const sw = q ? `rgb(${q.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255)).join(' ')})` : 'transparent';
      return h('div', { class: 'cm-field', title: p.name },
        h('span', { class: 'cm-swatch', style: `background:${sw}` }),
        chip(v == null ? '–' : fmt(v), { tone: grade(v) }));
    }));
  }

  renderLeft(); renderRight();
  openModal({
    title: t('cm.title'), size: 'lg', cls: 'colormatch', sticky: true,
    onClose: () => running?.abort(),
    body: [hint(t('cm.intro')), h('div', { class: 'cm-grid' }, left, right), h('h3', { class: 'kicker' }, t('cm.fields')), kpis, fields],
  });
}
