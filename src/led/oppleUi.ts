// Light-meter section of the LED-wall dialog (#10/#11): measure cabinets with the Opple Light
// Master through the patch sequencer, map the results, white-point Δ and gain hints, flicker.

import type { XY } from '../color';
import { PatchSequencer, sendPatch } from '../patchSequencer';
import { oppleMeter, pickerBox } from '../opple/ui';
import { lightStore } from '../opple/store';
import type { FlickerResult } from '../opple/protocol';
import { drawCabinetMap, stackCanvases } from './map';
import {
  COLOUR_LABELS, WHITE_TARGETS, buildPlan, evaluatePoints, meterCsv, summarize, whiteCorrection,
  type MeterResults, type PlanStep, type PointStat, type WhiteCorrection, type XYZ,
} from './oppleCheck';
import { PROCESSOR_LABELS, type WallConfig } from './wall';
import { cabinetMatch, cabinetMatchHint, whitePointHints } from './processorHints';
import { num, t } from '../i18n';

export interface MeterCheckHost {
  wall: () => WallConfig;
  /** open an output window (patches are drawn by every open pattern output window) */
  openOutput: () => void;
  cameraCsv: () => string | null;
  cameraHeat: () => HTMLCanvasElement | null;
  /** new light-meter statistics (for the camera heatmap's meter modes) */
  onStats: (s: PointStat[]) => void;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: (Node | string)[]) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, String(v));
  }
  el.append(...kids);
  return el;
};
const sel = (value: string, opts: [string, string][], onchange: (v: string) => void, title = '') =>
  h('select', { title, onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value) }, ...opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
const numIn = (value: number, title: string, onchange: (n: number) => void, step = '1', width = 56) => {
  const i = h('input', { type: 'number', value: String(value), step, title, style: `width:${width}px` }) as HTMLInputElement;
  i.onchange = () => { const n = Number(i.value); if (Number.isFinite(n)) onchange(n); };
  return i;
};
const lab = (text: string, ...kids: (Node | string)[]) => h('label', { class: 'inline' }, text, ...kids);
const de = (v: number, d: number) => (Number.isFinite(v) ? num(v, d) : '–');
const sg = (v: number, d: number) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${de(v, d)}` : '–');
function download(name: string, blob: Blob) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name }) as HTMLAnchorElement;
  document.body.append(a); a.click(); a.remove();
}

export function mountMeterCheck(box: HTMLElement, host: MeterCheckHost) {
  const picker = pickerBox();
  const results: MeterResults = new Map();
  let points: 'all' | 'full' | 'list' = 'all', list = '', white = 100, gray = 0, primaries = true;
  let auto = false, settle = 1500, avgN = 3, distance = t('led.m.distanceDefault');
  let ref = '', mapMode: 'dy' | 'duv' | 'cct' = 'dy', range = 5;
  let targetId = 'd65', customXy: XY = [0.3127, 0.329], primSource: 'measured' | 'xy' = 'measured', primXy = ['', '', '', '', '', ''];
  let whitePoint = '';
  let seq: PatchSequencer<XYZ> | null = null, running = false, progress = '', confirm: ((ok: boolean) => void) | null = null;
  let flicker: FlickerResult | null = null, flickerMsg = '';
  const map = h('canvas', { class: 'heat', width: 960, height: 300 }) as HTMLCanvasElement;
  let stats: PointStat[] = [];

  const status = () => oppleMeter.state === 'connected' ? t('led.m.connected', { model: oppleMeter.model === 'lm4' ? 'Light Master 4' : 'Light Master 3' }) : oppleMeter.message || t('led.m.notConnected');
  oppleMeter.addEventListener('status', () => render());
  document.addEventListener('keydown', (e) => {
    if (!confirm || !box.isConnected || (e.target as Element | null)?.closest?.('input, select, textarea')) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); confirm(true); }
  });

  async function run() {
    if (oppleMeter.state !== 'connected') { progress = t('led.m.connectFirst'); render(); return; }
    const plan: PlanStep[] = buildPlan(host.wall(), {
      points: points === 'list' ? list.split(/[\s,;]+/).filter(Boolean) : points, white: white / 100, gray: gray / 100, primaries,
    });
    if (!plan.length) { progress = t('led.m.noPoints'); render(); return; }
    running = true; render();
    seq = new PatchSequencer<XYZ>(plan.map((s) => s.frame), async (_f, i, signal) => {
      const st = plan[i];
      if (!auto) {
        progress = t('led.m.stepPlace', { i: i + 1, n: plan.length, point: st.point, colour: COLOUR_LABELS[st.colour] });
        render();
        const ok = await new Promise<boolean>((res) => { confirm = res; signal.addEventListener('abort', () => res(false), { once: true }); });
        confirm = null;
        if (!ok) return null;
      }
      progress = t('led.m.stepMeasuring', { i: i + 1, n: plan.length, point: st.point, colour: COLOUR_LABELS[st.colour] }); render();
      const r = await oppleMeter.measureAveraged(avgN);
      const xyz: XYZ = [r.X, r.Y, r.Z];
      const cur = results.get(st.point) ?? {};
      cur[st.colour] = xyz; results.set(st.point, cur);
      if (!ref) ref = st.point;
      evaluate();
      return xyz;
    }, { settleMs: auto ? settle : 300 });
    try { await seq.run(); progress = seq.stopped ? t('led.m.aborted') : t('led.m.done'); }
    catch (e) { progress = t('led.m.error', { msg: (e as Error).message }); }
    running = false; seq = null; confirm = null; render();
  }

  function evaluate() {
    stats = ref ? evaluatePoints(results, ref) : [];
    host.onStats(stats);
  }

  function correction(): WhiteCorrection | null {
    const pt = results.get(whitePoint || ref);
    if (!pt?.W) return null;
    const target = targetId === 'custom' ? customXy : WHITE_TARGETS.find((x) => x.id === targetId)!.xy();
    if (primSource === 'measured') return whiteCorrection(pt.W, target, pt.R && pt.G && pt.B ? { measured: [pt.R, pt.G, pt.B] } : {});
    const n = primXy.map(Number);
    const ok = primXy.every((v) => v.trim() !== '') && n.every((v) => v > 0 && v < 1);
    return whiteCorrection(pt.W, target, ok ? { xy: [[n[0], n[1]], [n[2], n[3]], [n[4], n[5]]] } : {});
  }

  /** Entered primary chromaticities, if complete. */
  function enteredXy(): [XY, XY, XY] | undefined {
    const n = primXy.map(Number);
    return primSource === 'xy' && primXy.every((v) => v.trim() !== '') && n.every((v) => v > 0 && v < 1) ? [[n[0], n[1]], [n[2], n[3]], [n[4], n[5]]] : undefined;
  }
  let currentK = 6504;

  function drawMap() {
    const vals = new Map<string, number>();
    for (const s of stats) vals.set(s.point, mapMode === 'dy' ? s.dY : mapMode === 'duv' ? s.duv * 1000 : s.cct);
    const cctRef = stats.find((s) => s.point === ref)?.cct ?? NaN;
    if (mapMode === 'cct') for (const [k, v] of vals) vals.set(k, v - cctRef);
    const what = { dy: t('led.m.mapDy'), duv: t('led.m.mapDuv'), cct: t('led.m.mapCct') }[mapMode];
    drawCabinetMap(map, host.wall(), vals, mapMode === 'cct' ? range * 20 : range, t('led.m.mapCaption', { name: host.wall().name, what, range: mapMode === 'cct' ? range * 20 : range, ref }),
      (v) => (mapMode === 'duv' ? de(v, 1) : mapMode === 'cct' ? sg(v, 0) : sg(v, 1)), { oneSided: mapMode === 'duv', mark: ref });
  }

  function render() {
    const measured = [...results.keys()];
    const sum = stats.length > 1 ? summarize(stats) : null;
    const corr = correction();
    const whiteOpts: [string, string][] = measured.filter((p) => results.get(p)?.W).map((p) => [p, p]);
    box.replaceChildren(
      h('p', { class: 'note' }, t('led.m.disclaimer')),
      h('div', { class: 'row' },
        h('b', {}, status()),
        oppleMeter.state === 'connected'
          ? h('button', { onclick: () => { oppleMeter.disconnect(); render(); } }, t('led.m.disconnect'))
          : h('button', { class: 'primary', onclick: () => { lightStore().connectNew().catch(() => {}).finally(render); } }, t('led.m.search')),
        h('button', { title: t('led.m.outputTitle'), onclick: host.openOutput }, t('led.m.openOutput'))),
      picker,
      h('div', { class: 'row' },
        lab(t('led.m.points'), sel(points, [['all', t('led.m.allCabinets')], ['list', t('led.m.selection')], ['full', t('led.m.fullOne')]], (v) => { points = v as typeof points; render(); })),
        points === 'list' ? (() => { const i = h('input', { value: list, placeholder: 'C1-R1, C5-R3 …', style: 'width:160px' }) as HTMLInputElement; i.onchange = () => { list = i.value; }; return i; })() : '',
        lab(t('led.m.whitePct'), numIn(white, t('led.m.whiteTitle'), (n) => { white = Math.min(100, Math.max(1, n)); })),
        lab(t('led.m.greyPct'), numIn(gray, t('led.m.greyTitle'), (n) => { gray = Math.min(100, Math.max(0, n)); })),
        lab('R G B', (() => { const c = h('input', { type: 'checkbox', checked: primaries, title: t('led.m.primCheckTitle') }) as HTMLInputElement; c.onchange = () => { primaries = c.checked; }; return c; })())),
      h('div', { class: 'row' },
        lab(t('led.m.sequence'), sel(auto ? 'auto' : 'manual', [['manual', t('led.m.manualConfirm')], ['auto', t('led.m.autoFixed')]], (v) => { auto = v === 'auto'; })),
        lab(t('led.m.settle'), numIn(settle, t('led.m.settleTitle'), (n) => { settle = Math.max(100, n); }, '100', 70)),
        lab(t('led.cam.average'), numIn(avgN, t('led.m.avgTitle'), (n) => { avgN = Math.max(1, Math.min(20, Math.round(n))); }, '1', 44)),
        lab(t('led.m.distance'), (() => { const i = h('input', { value: distance, style: 'width:200px', title: t('led.m.distanceTitle') }) as HTMLInputElement; i.onchange = () => { distance = i.value; }; return i; })())),
      h('div', { class: 'row' },
        running
          ? h('button', { onclick: () => seq?.stop() }, t('led.m.abort'))
          : h('button', { class: 'primary', onclick: run }, t('led.m.start')),
        running && confirm ? h('button', { class: 'primary', onclick: () => confirm?.(true) }, t('led.m.measureSpace')) : '',
        running && confirm ? h('button', { onclick: () => confirm?.(false) }, t('led.m.skip')) : '',
        results.size ? h('button', { onclick: () => { results.clear(); stats = []; ref = ''; host.onStats([]); render(); } }, t('led.m.clear')) : '',
        h('span', { class: 'hint' }, progress)),
      h('p', { class: 'hint' }, t('led.m.howto')),
      stats.length ? h('div', {},
        h('div', { class: 'row' },
          lab(t('led.m.reference'), sel(ref, measured.map((p) => [p, p]), (v) => { ref = v; evaluate(); render(); })),
          lab(t('led.res.map'), sel(mapMode, [['dy', t('led.m.brightnessPct')], ['duv', 'Δu′v′'], ['cct', 'CCT']], (v) => { mapMode = v as typeof mapMode; drawMap(); })),
          lab(t('led.res.scale'), sel(String(range), ['1', '2', '5', '10', '20'].map((v) => [v, v] as [string, string]), (v) => { range = Number(v); drawMap(); })),
          sum ? h('b', {}, t('led.m.summary', { u: de(sum.uniformity, 1), lo: sg(sum.minDY, 1), hi: sg(sum.maxDY, 1), duv: de(sum.maxDuv, 4) })) : ''),
        map,
        h('table', {}, h('tr', {}, ...[t('led.m.point'), 'E lx', 'ΔY %', 'x', 'y', 'Δu′v′', 'CCT K', 'Duv'].map((c) => h('th', {}, c))),
          ...stats.map((s) => h('tr', {}, h('td', {}, s.point), h('td', {}, de(s.Y, 1)), h('td', {}, sg(s.dY, 2)), h('td', {}, de(s.xy[0], 4)), h('td', {}, de(s.xy[1], 4)),
            h('td', {}, de(s.duv, 4)), h('td', {}, de(s.cct, 0)), h('td', {}, sg(s.duvPlanck, 4)))))) : '',
      h('div', { class: 'row' }, h('b', {}, t('led.m.whiteBalance')),
        whiteOpts.length ? lab(t('led.m.measPoint'), sel(whitePoint || ref, whiteOpts, (v) => { whitePoint = v; render(); })) : h('span', { class: 'hint' }, t('led.m.measureFirst')),
        lab(t('led.m.targetLabel'), sel(targetId, [...WHITE_TARGETS.map((x) => [x.id, x.name] as [string, string]), ['custom', t('led.m.customXy')]], (v) => { targetId = v; render(); })),
        targetId === 'custom' ? h('span', {}, numIn(customXy[0], t('led.m.targetX'), (n) => { customXy = [n, customXy[1]]; render(); }, '0.0001', 72), numIn(customXy[1], t('led.m.targetY'), (n) => { customXy = [customXy[0], n]; render(); }, '0.0001', 72)) : '',
        lab(t('led.m.primaries'), sel(primSource, [['measured', t('led.m.primMeasured')], ['xy', t('led.m.primEnter')]], (v) => { primSource = v as typeof primSource; render(); }))),
      primSource === 'xy' ? h('div', { class: 'row' }, ...['Rx', 'Ry', 'Gx', 'Gy', 'Bx', 'By'].map((c, i) => {
        const inp = h('input', { value: primXy[i], placeholder: c, style: 'width:62px', title: t('led.m.primTitle', { c }) }) as HTMLInputElement;
        inp.onchange = () => { primXy[i] = inp.value.replace(',', '.'); render(); };
        return inp;
      })) : '',
      corr ? whiteBox(corr) : '',
      h('div', { class: 'row' }, h('b', {}, t('led.m.flicker')),
        h('button', { disabled: oppleMeter.state !== 'connected' || running, title: t('led.m.flickerTitle'), onclick: async () => {
          flickerMsg = t('led.m.measuring'); render();
          try { flicker = await oppleMeter.flicker(); flickerMsg = ''; } catch (e) { flickerMsg = (e as Error).message; }
          render();
        } }, t('led.m.flickerMeasure')),
        h('span', { class: 'hint' }, flicker ? t('led.m.flickerResult', { p: de(flicker.percent, 1), i: de(flicker.index, 3), f: de(flicker.frequency, 0), sr: de(flicker.sampleRate / 1000, 1) }) : flickerMsg)),
      h('p', { class: 'hint' }, t('led.m.flickerHint')),
      h('div', { class: 'row' },
        h('button', { disabled: !results.size && !host.cameraCsv(), title: t('led.m.reportTitle'), onclick: () => {
          const parts = [host.cameraCsv(), results.size ? meterCsv(host.wall(), results, ref, stats, corr, flicker ? `Percent ${flicker.percent.toFixed(1)} %, Index ${flicker.index.toFixed(3)}, ${flicker.frequency.toFixed(0)} Hz` : '', distance) : null].filter(Boolean);
          download(`${t('led.file.prefix')}-${host.wall().name}-${t('led.file.report')}.csv`, new Blob([parts.join('\n')], { type: 'text/csv' }));
        } }, t('led.m.reportCsv')),
        h('button', { disabled: !results.size && !host.cameraHeat(), onclick: async () => {
          const list = [host.cameraHeat(), stats.length ? map : null].filter((c): c is HTMLCanvasElement => !!c);
          const b = await stackCanvases(list);
          if (b) download(`${t('led.file.prefix')}-${host.wall().name}-${t('led.file.report')}.png`, b);
        } }, t('led.m.reportPng'))),
    );
    if (stats.length) drawMap();
  }

  function whiteBox(c: WhiteCorrection) {
    return h('div', {},
      h('table', {}, h('tr', {}, ...['', 'x', 'y', 'CCT K', 'Duv'].map((c) => h('th', {}, c))),
        h('tr', {}, h('td', {}, t('led.m.actual')), h('td', {}, de(c.ist.xy[0], 4)), h('td', {}, de(c.ist.xy[1], 4)), h('td', {}, de(c.ist.cct, 0)), h('td', {}, sg(c.ist.duv, 4))),
        h('tr', {}, h('td', {}, t('led.m.target')), h('td', {}, de(c.soll.xy[0], 4)), h('td', {}, de(c.soll.xy[1], 4)), h('td', {}, de(c.soll.cct, 0)), h('td', {}, sg(c.soll.duv, 4))),
        h('tr', {}, h('td', {}, 'Δ'), h('td', {}, sg(c.ist.xy[0] - c.soll.xy[0], 4)), h('td', {}, sg(c.ist.xy[1] - c.soll.xy[1], 4)), h('td', {}, sg(c.ist.cct - c.soll.cct, 0)), h('td', {}, `Δu′v′ ${de(c.duv, 4)}`))),
      c.gains ? h('p', {}, h('b', {}, t('led.m.corrHint', { r: de(c.gains[0], 1), g: de(c.gains[1], 1), b: de(c.gains[2], 1) })),
        ` ${t('led.m.corrDetail', { after: de(c.luminanceAfter ?? NaN, 0), src: c.primariesSource ? t(`led.m.src.${c.primariesSource}`) : '–', add: c.additivity != null ? t('led.m.additivity', { v: de(c.additivity, 1) }) : '' })}`)
        : h('p', { class: 'hint' }, t('led.m.noGains')),
      host.wall().processor === 'brompton' ? h('div', { class: 'row' }, lab(t('led.m.tesseraAt'), numIn(currentK, t('led.m.tesseraTitle'), (n) => { currentK = Math.min(11000, Math.max(2000, n)); render(); }, '1', 70), 'K')) : '',
      ...whitePointHints(host.wall().processor, c, currentK).map((hint) => h('div', {}, h('b', {}, `${PROCESSOR_LABELS[host.wall().processor]} – ${hint.title}`), h('ul', {}, ...hint.lines.map((l) => h('li', {}, l))))),
      matchBox(),
      ...c.warnings.map((w) => h('p', { class: 'note' }, w)));
  }

  /** Per-cabinet gains to match the reference cabinet. */
  function matchBox() {
    if (stats.length < 2) return '';
    const m = cabinetMatch(results, ref, enteredXy());
    const ok = m.rows.filter((r) => r.gains);
    if (!ok.length) return h('p', { class: 'hint' }, t('led.m.matchNone'));
    return h('div', {},
      h('b', {}, t('led.m.matchTitle', { ref })),
      h('p', { class: 'hint' }, `${cabinetMatchHint(host.wall().processor)} ${t('led.m.matchDetail', { f: de(m.scale * 100, 1) })}`),
      h('table', {}, h('tr', {}, ...['Cabinet', 'R %', 'G %', 'B %', t('led.chk.csvNote')].map((c) => h('th', {}, c))),
        ...m.rows.map((r) => h('tr', {}, h('td', {}, r.point), ...(r.gains ? r.gains.map((g) => h('td', {}, de(g, 1))) : [h('td', {}, '–'), h('td', {}, '–'), h('td', {}, '–')]), h('td', { class: 'hint' }, r.warnings.join(' '))))));
  }

  render();
  return { stop: () => { seq?.stop(); sendPatch(null); } };
}
