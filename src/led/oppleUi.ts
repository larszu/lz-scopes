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
import type { WallConfig } from './wall';

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
const de = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '–');
const sg = (v: number, d: number) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${de(v, d)}` : '–');
function download(name: string, blob: Blob) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name }) as HTMLAnchorElement;
  document.body.append(a); a.click(); a.remove();
}

export function mountMeterCheck(box: HTMLElement, host: MeterCheckHost) {
  const picker = pickerBox();
  const results: MeterResults = new Map();
  let points: 'all' | 'full' | 'list' = 'all', list = '', white = 100, gray = 0, primaries = true;
  let auto = false, settle = 1500, avgN = 3, distance = 'Distanzstück 5 cm, senkrecht';
  let ref = '', mapMode: 'dy' | 'duv' | 'cct' = 'dy', range = 5;
  let targetId = 'd65', customXy: XY = [0.3127, 0.329], primSource: 'measured' | 'xy' = 'measured', primXy = ['', '', '', '', '', ''];
  let whitePoint = '';
  let seq: PatchSequencer<XYZ> | null = null, running = false, progress = '', confirm: ((ok: boolean) => void) | null = null;
  let flicker: FlickerResult | null = null, flickerMsg = '';
  const map = h('canvas', { class: 'heat', width: 960, height: 300 }) as HTMLCanvasElement;
  let stats: PointStat[] = [];

  const status = () => oppleMeter.state === 'connected' ? `${oppleMeter.model === 'lm4' ? 'Light Master 4' : 'Light Master 3'} verbunden` : oppleMeter.message || 'nicht verbunden';
  oppleMeter.addEventListener('status', () => render());
  document.addEventListener('keydown', (e) => {
    if (!confirm || !box.isConnected || (e.target as Element | null)?.closest?.('input, select, textarea')) return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); confirm(true); }
  });

  async function run() {
    if (oppleMeter.state !== 'connected') { progress = 'Erst den Light Master verbinden.'; render(); return; }
    const plan: PlanStep[] = buildPlan(host.wall(), {
      points: points === 'list' ? list.split(/[\s,;]+/).filter(Boolean) : points, white: white / 100, gray: gray / 100, primaries,
    });
    if (!plan.length) { progress = 'Keine Messpunkte.'; render(); return; }
    running = true; render();
    seq = new PatchSequencer<XYZ>(plan.map((s) => s.frame), async (_f, i, signal) => {
      const st = plan[i];
      if (!auto) {
        progress = `Schritt ${i + 1}/${plan.length}: Sensor auf ${st.point} (${COLOUR_LABELS[st.colour]}) – „Messen“ oder Leertaste`;
        render();
        const ok = await new Promise<boolean>((res) => { confirm = res; signal.addEventListener('abort', () => res(false), { once: true }); });
        confirm = null;
        if (!ok) return null;
      }
      progress = `Schritt ${i + 1}/${plan.length}: ${st.point} ${COLOUR_LABELS[st.colour]} – messe …`; render();
      const r = await oppleMeter.measureAveraged(avgN);
      const xyz: XYZ = [r.X, r.Y, r.Z];
      const cur = results.get(st.point) ?? {};
      cur[st.colour] = xyz; results.set(st.point, cur);
      if (!ref) ref = st.point;
      evaluate();
      return xyz;
    }, { settleMs: auto ? settle : 300 });
    try { await seq.run(); progress = seq.stopped ? 'Abgebrochen.' : 'Fertig.'; }
    catch (e) { progress = `Fehler: ${(e as Error).message}`; }
    running = false; seq = null; confirm = null; render();
  }

  function evaluate() {
    stats = ref ? evaluatePoints(results, ref) : [];
    host.onStats(stats);
  }

  function correction(): WhiteCorrection | null {
    const pt = results.get(whitePoint || ref);
    if (!pt?.W) return null;
    const target = targetId === 'custom' ? customXy : WHITE_TARGETS.find((t) => t.id === targetId)!.xy();
    if (primSource === 'measured') return whiteCorrection(pt.W, target, pt.R && pt.G && pt.B ? { measured: [pt.R, pt.G, pt.B] } : {});
    const n = primXy.map(Number);
    const ok = primXy.every((v) => v.trim() !== '') && n.every((v) => v > 0 && v < 1);
    return whiteCorrection(pt.W, target, ok ? { xy: [[n[0], n[1]], [n[2], n[3]], [n[4], n[5]]] } : {});
  }

  function drawMap() {
    const vals = new Map<string, number>();
    for (const s of stats) vals.set(s.point, mapMode === 'dy' ? s.dY : mapMode === 'duv' ? s.duv * 1000 : s.cct);
    const cctRef = stats.find((s) => s.point === ref)?.cct ?? NaN;
    if (mapMode === 'cct') for (const [k, v] of vals) vals.set(k, v - cctRef);
    const what = { dy: 'Helligkeit zum Referenz-Cabinet %', duv: 'Δu′v′ ×1000 zum Referenz-Cabinet', cct: 'CCT − CCT(Referenz) in K' }[mapMode];
    drawCabinetMap(map, host.wall(), vals, mapMode === 'cct' ? range * 20 : range, `${host.wall().name} · Opple Light Master · ${what} · Skala ±${mapMode === 'cct' ? range * 20 : range} · Referenz ${ref} · Trendmessung`,
      (v) => (mapMode === 'duv' ? de(v, 1) : mapMode === 'cct' ? sg(v, 0) : sg(v, 1)), { oneSided: mapMode === 'duv', mark: ref });
  }

  function render() {
    const measured = [...results.keys()];
    const sum = stats.length > 1 ? summarize(stats) : null;
    const corr = correction();
    const whiteOpts: [string, string][] = measured.filter((p) => results.get(p)?.W).map((p) => [p, p]);
    box.replaceChildren(
      h('p', { class: 'note' }, 'Trendmessgerät, kein Kolorimeter: Der Light Master misst Beleuchtungsstärke mit Filterkanälen. Für schmalbandige LED-Primärfarben sind die Farbwerte nur Näherungen, absolute Werte (lx, abgeleitete cd/m²) sind nicht normgerecht. Geeignet für relative Uniformität (Cabinet gegen Cabinet, gleicher Abstand) und die Tendenz des Weißpunkts. Verbindung und Messung sind mit einem Light Master 3 geprüft; der Ablauf an einer LED-Wand ist ungeprüft (nur synthetische Messwerte). Gemessen wird mit dem ersten verbundenen Gerät.'),
      h('div', { class: 'row' },
        h('b', {}, status()),
        oppleMeter.state === 'connected'
          ? h('button', { onclick: () => { oppleMeter.disconnect(); render(); } }, 'Trennen')
          : h('button', { class: 'primary', onclick: () => { lightStore().connectNew().catch(() => {}).finally(render); } }, 'Light Master suchen …'),
        h('button', { title: 'Messfelder erscheinen in jedem offenen Testbild-Ausgabefenster', onclick: host.openOutput }, '⧉ Ausgabefenster öffnen')),
      picker,
      h('div', { class: 'row' },
        lab('Messpunkte', sel(points, [['all', 'alle Cabinets'], ['list', 'Auswahl'], ['full', 'Vollfläche (ein Punkt)']], (v) => { points = v as typeof points; render(); })),
        points === 'list' ? (() => { const i = h('input', { value: list, placeholder: 'C1-R1, C5-R3 …', style: 'width:160px' }) as HTMLInputElement; i.onchange = () => { list = i.value; }; return i; })() : '',
        lab('Weiß %', numIn(white, 'Pegel des Weißfelds und der Primärfarben', (n) => { white = Math.min(100, Math.max(1, n)); })),
        lab('Grau %', numIn(gray, 'zusätzliche Graustufe (0 = aus)', (n) => { gray = Math.min(100, Math.max(0, n)); })),
        lab('R G B', (() => { const c = h('input', { type: 'checkbox', checked: primaries, title: 'Primärfarben mitmessen (für RGB-Gains; bei LEDs nur Näherung)' }) as HTMLInputElement; c.onchange = () => { primaries = c.checked; }; return c; })())),
      h('div', { class: 'row' },
        lab('Ablauf', sel(auto ? 'auto' : 'manual', [['manual', 'manuell bestätigen (Sensor versetzen)'], ['auto', 'automatisch (Sensor liegt fest)']], (v) => { auto = v === 'auto'; })),
        lab('Einschwingzeit ms', numIn(settle, 'Wartezeit nach dem Umschalten (automatisch)', (n) => { settle = Math.max(100, n); }, '100', 70)),
        lab('mitteln', numIn(avgN, 'Messungen je Feld', (n) => { avgN = Math.max(1, Math.min(20, Math.round(n))); }, '1', 44)),
        lab('Abstand', (() => { const i = h('input', { value: distance, style: 'width:200px', title: 'Wie gemessen wurde (steht im Bericht). Empfehlung: fester Abstand, senkrecht, Umfeld schwarz' }) as HTMLInputElement; i.onchange = () => { distance = i.value; }; return i; })())),
      h('div', { class: 'row' },
        running
          ? h('button', { onclick: () => seq?.stop() }, '■ Abbrechen')
          : h('button', { class: 'primary', onclick: run }, '▶ Messablauf starten'),
        running && confirm ? h('button', { class: 'primary', onclick: () => confirm?.(true) }, 'Messen (Leertaste)') : '',
        running && confirm ? h('button', { onclick: () => confirm?.(false) }, 'Überspringen') : '',
        results.size ? h('button', { onclick: () => { results.clear(); stats = []; ref = ''; host.onStats([]); render(); } }, 'Messwerte löschen') : '',
        h('span', { class: 'hint' }, progress)),
      h('p', { class: 'hint' }, 'Nur das gemessene Cabinet leuchtet, alles andere ist schwarz. Aufgelegt sieht der Sensor nur wenige Pixel; mit festem Abstand (Distanzstück) mittelt er über viele. Immer gleich messen – dann sind die Unterschiede zwischen Cabinets gültig.'),
      stats.length ? h('div', {},
        h('div', { class: 'row' },
          lab('Referenz', sel(ref, measured.map((p) => [p, p]), (v) => { ref = v; evaluate(); render(); })),
          lab('Karte', sel(mapMode, [['dy', 'Helligkeit %'], ['duv', 'Δu′v′'], ['cct', 'CCT']], (v) => { mapMode = v as typeof mapMode; drawMap(); })),
          lab('Skala ±', sel(String(range), ['1', '2', '5', '10', '20'].map((v) => [v, v] as [string, string]), (v) => { range = Number(v); drawMap(); })),
          sum ? h('b', {}, `Uniformität (min/max) ${de(sum.uniformity, 1)} % · ΔY ${sg(sum.minDY, 1)} … ${sg(sum.maxDY, 1)} % · max Δu′v′ ${de(sum.maxDuv, 4)}`) : ''),
        map,
        h('table', {}, h('tr', {}, ...['Punkt', 'E lx', 'ΔY %', 'x', 'y', 'Δu′v′', 'CCT K', 'Duv'].map((t) => h('th', {}, t))),
          ...stats.map((s) => h('tr', {}, h('td', {}, s.point), h('td', {}, de(s.Y, 1)), h('td', {}, sg(s.dY, 2)), h('td', {}, de(s.xy[0], 4)), h('td', {}, de(s.xy[1], 4)),
            h('td', {}, de(s.duv, 4)), h('td', {}, de(s.cct, 0)), h('td', {}, sg(s.duvPlanck, 4)))))) : '',
      h('div', { class: 'row' }, h('b', {}, 'Weißpunkt-Abgleich'),
        whiteOpts.length ? lab('Messpunkt', sel(whitePoint || ref, whiteOpts, (v) => { whitePoint = v; render(); })) : h('span', { class: 'hint' }, 'erst messen'),
        lab('Ziel', sel(targetId, [...WHITE_TARGETS.map((t) => [t.id, t.name] as [string, string]), ['custom', 'eigenes xy']], (v) => { targetId = v; render(); })),
        targetId === 'custom' ? h('span', {}, numIn(customXy[0], 'Ziel x', (n) => { customXy = [n, customXy[1]]; render(); }, '0.0001', 72), numIn(customXy[1], 'Ziel y', (n) => { customXy = [customXy[0], n]; render(); }, '0.0001', 72)) : '',
        lab('Primärvalenzen', sel(primSource, [['measured', 'mit dem Opple gemessen (R/G/B)'], ['xy', 'eingeben (Datenblatt/Prozessor)']], (v) => { primSource = v as typeof primSource; render(); }))),
      primSource === 'xy' ? h('div', { class: 'row' }, ...['Rx', 'Ry', 'Gx', 'Gy', 'Bx', 'By'].map((t, i) => {
        const inp = h('input', { value: primXy[i], placeholder: t, style: 'width:62px', title: `${t} der Wand-Primärfarbe (CIE 1931)` }) as HTMLInputElement;
        inp.onchange = () => { primXy[i] = inp.value.replace(',', '.'); render(); };
        return inp;
      })) : '',
      corr ? whiteBox(corr) : '',
      h('div', { class: 'row' }, h('b', {}, 'Flimmern'),
        h('button', { disabled: oppleMeter.state !== 'connected' || running, title: 'Nur Light Master 4 (Format aus opple-bridge)', onclick: async () => {
          flickerMsg = 'messe …'; render();
          try { flicker = await oppleMeter.flicker(); flickerMsg = ''; } catch (e) { flickerMsg = (e as Error).message; }
          render();
        } }, 'Flimmern messen (LM4)'),
        h('span', { class: 'hint' }, flicker ? `Percent Flicker ${de(flicker.percent, 1)} % · Flicker Index ${de(flicker.index, 3)} · stärkste Frequenz ${de(flicker.frequency, 0)} Hz (Abtastung ${de(flicker.sampleRate / 1000, 1)} kHz)` : flickerMsg)),
      h('p', { class: 'hint' }, 'Kennwerte nach ENERGY STAR (Entwurf), dort aber mit ≥ 5 MSa/s und V(λ)-Detektor gemessen – der Light Master tastet mit höchstens ≈ 85 kHz ab: Richtwert zum Vergleich von Einstellungen, keine Freigabe für die Kamera (dafür der Scan-Linien-Index).'),
      h('div', { class: 'row' },
        h('button', { disabled: !results.size && !host.cameraCsv(), title: 'Kamera-Auswertung und Opple-Messung in einer Datei', onclick: () => {
          const parts = [host.cameraCsv(), results.size ? meterCsv(host.wall(), results, ref, stats, corr, flicker ? `Percent ${flicker.percent.toFixed(1)} %, Index ${flicker.index.toFixed(3)}, ${flicker.frequency.toFixed(0)} Hz` : '', distance) : null].filter(Boolean);
          download(`led-wand-${host.wall().name}-bericht.csv`, new Blob([parts.join('\n')], { type: 'text/csv' }));
        } }, '⤓ Bericht CSV'),
        h('button', { disabled: !results.size && !host.cameraHeat(), onclick: async () => {
          const list = [host.cameraHeat(), stats.length ? map : null].filter((c): c is HTMLCanvasElement => !!c);
          const b = await stackCanvases(list);
          if (b) download(`led-wand-${host.wall().name}-bericht.png`, b);
        } }, '⤓ Bericht PNG')),
    );
    if (stats.length) drawMap();
  }

  function whiteBox(c: WhiteCorrection) {
    return h('div', {},
      h('table', {}, h('tr', {}, ...['', 'x', 'y', 'CCT K', 'Duv'].map((t) => h('th', {}, t))),
        h('tr', {}, h('td', {}, 'Ist'), h('td', {}, de(c.ist.xy[0], 4)), h('td', {}, de(c.ist.xy[1], 4)), h('td', {}, de(c.ist.cct, 0)), h('td', {}, sg(c.ist.duv, 4))),
        h('tr', {}, h('td', {}, 'Soll'), h('td', {}, de(c.soll.xy[0], 4)), h('td', {}, de(c.soll.xy[1], 4)), h('td', {}, de(c.soll.cct, 0)), h('td', {}, sg(c.soll.duv, 4))),
        h('tr', {}, h('td', {}, 'Δ'), h('td', {}, sg(c.ist.xy[0] - c.soll.xy[0], 4)), h('td', {}, sg(c.ist.xy[1] - c.soll.xy[1], 4)), h('td', {}, sg(c.ist.cct - c.soll.cct, 0)), h('td', {}, `Δu′v′ ${de(c.duv, 4)}`))),
      c.gains ? h('p', {}, h('b', {}, `Korrekturhinweis: Gain R ${de(c.gains[0], 1)} % · G ${de(c.gains[1], 1)} % · B ${de(c.gains[2], 1)} %`),
        ` (relativ zum jetzigen Stand, größter Kanal = 100 %; Weiß danach ≈ ${de(c.luminanceAfter ?? NaN, 0)} % so hell; Primärvalenzen ${c.primariesSource}${c.additivity != null ? `, Additivität R+G+B↔W ${de(c.additivity, 1)} %` : ''}). ` +
        'Im Prozessor als Kanal-Helligkeit/Gain eintragen (NovaLCT: Advanced Adjustment, Helligkeit je Rot/Grün/Blau; Brompton Tessera bietet dafür den Farbtemperatur-Regler), danach neu messen. Annahme: Kanäle addieren sich, Gains wirken linear auf das Licht.')
        : h('p', { class: 'hint' }, 'Keine Gains: dafür Primärfarben mitmessen oder Primärvalenzen eingeben. Angezeigt wird nur Δ.'),
      ...c.warnings.map((w) => h('p', { class: 'note' }, w)));
  }

  render();
  return { stop: () => { seq?.stop(); sendPatch(null); } };
}
