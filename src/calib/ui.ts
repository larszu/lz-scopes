// Display calibration / verification dialog (#9). Patches go to the pattern output window through
// the shared sequencer (src/patchSequencer.ts); readings come from ArgyllCMS spotread via the
// bridge, from manual input, or untethered from an external generator.

import { GAMUTS, type GamutId } from '../color';
import { PatchSequencer, sendPatch, type PatchFrame } from '../patchSequencer';
import { TARGET_LABELS, xyYToXyz, type SdrTarget, type XYZ } from './colorimetry';
import { buildCube } from './lut3d';
import { Meter, meterInfo, type MeterInfo } from './meter';
import { download, uniformityCsv, uniformityHtml, verifyCsv, verifyHtml } from './report';
import { HDR_PEAKS, TEST_SETS, UNIFORMITY_GRIDS, UNIFORMITY_LEVELS, testSet, uniformityCells, type TestSet } from './testsets';
import { evaluateUniformity, type UniformityReport } from './uniformity';
import { UntetheredDetector } from './untethered';
import { defaultTarget, verify, type VerifyReport } from './verify';

type Kid = Node | string | null | undefined | false;
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: Kid[]) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (typeof v === 'boolean') { if (v) el.setAttribute(k, ''); } else if (v != null) el.setAttribute(k, String(v));
  }
  for (const c of kids) if (c) el.append(c);
  return el;
};
const sel = (value: string, opts: [string, string][], on: (v: string) => void, title = '') =>
  h('select', { title, onchange: (e: Event) => on((e.target as HTMLSelectElement).value) }, ...opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
const num = (value: number, min: number, max: number, step: number, on: (v: number) => void, title = '') =>
  h('input', { type: 'number', class: 'num', min, max, step, value, title, onchange: (e: Event) => on(Number((e.target as HTMLInputElement).value)) });
const row = (label: string, ...kids: Kid[]) => h('div', { class: 'mrow' }, h('span', {}, label), ...kids);

export interface CalibHost {
  /** http(s) base of the bridge, '' when there is none (static web build) */
  bridgeHttp: () => string;
  bridgeWs: () => string;
  /** open a pattern output window (?out=…), on the other screen in the desktop app */
  openPatchWindow: () => void;
}

type Mode = 'meter' | 'manual' | 'untethered';
const S = {
  mode: 'manual' as Mode, setId: 'video47', peak: 1000, transfer: 'bt1886' as SdrTarget, gamut: '709' as GamutId,
  window: 10, background: 0, settleMs: 1000, insertion: false, insEvery: 5, insDur: 5, insLevel: 15,
  grid: 5, port: 1, displayType: '', skipCal: false, correction: null as { name: string; text: string } | null,
  entry: 'XYZ' as 'XYZ' | 'xyY',
};
let meter: Meter | null = null;
let info: MeterInfo | null | undefined;
let lastVerify: { report: VerifyReport; set: TestSet; readings: (XYZ | null)[] } | null = null;
let lastUniformity: UniformityReport | null = null;
let running: { stop: () => void } | null = null;

export function openCalibration(host: CalibHost) {
  const dlg = h('dialog', { class: 'calib' }) as HTMLDialogElement;
  const status = h('div', { class: 'hint' });
  const log = h('pre', { class: 'calib-log' });
  const work = h('div', { class: 'calib-work' });
  const results = h('div', { class: 'calib-results' });
  const setStatus = (t: string, kind: 'info' | 'ok' | 'error' = 'info') => { status.textContent = t; status.className = `hint ${kind === 'ok' ? 'ok' : kind === 'error' ? 'bad' : ''}`; };
  const wsBase = host.bridgeWs(), httpBase = host.bridgeHttp();

  const meterBox = h('div');
  const renderMeter = () => {
    const bridge = !!httpBase;
    const kids: Kid[] = [h('div', { class: 'mtitle' }, 'Messgerät (ArgyllCMS spotread)'),
      h('p', { class: 'hint' }, 'ArgyllCMS (AGPL) separat installieren; LZ Scopes liefert es nicht mit und startet nur ein vorhandenes spotread als eigenes Programm.')];
    if (info === undefined) kids.push(h('p', { class: 'hint' }, 'Suche ArgyllCMS …'));
    else if (!bridge || info === null) kids.push(h('p', { class: 'hint' }, 'Keine Bridge: Messgeräte gehen nur in der Desktop-App oder mit „npm start“. Messwerte manuell eingeben.'));
    else if (!info.found) kids.push(h('p', { class: 'hint bad' }, 'ArgyllCMS nicht gefunden (spotread). Von argyllcms.com installieren und in den PATH legen oder LZS_ARGYLL_BIN setzen – bis dahin Messwerte manuell eingeben.'));
    else {
      const ports: [string, string][] = info.instruments.length ? info.instruments.map((i) => [String(i.port), `${i.port}: ${i.name}`]) : [['1', '1 (Standard)']];
      const file = h('input', { type: 'file', accept: '.ccmx,.ccss', style: 'display:none' }) as HTMLInputElement;
      file.onchange = async () => { const f = file.files?.[0]; S.correction = f ? { name: f.name, text: await f.text() } : null; renderMeter(); };
      kids.push(
        h('p', { class: 'hint' }, `spotread: ${info.path}${info.version ? ` (Version ${info.version})` : ''} · ungeprüft: mit echtem Messgerät noch nicht getestet.`),
        row('Gerät/Port', sel(String(S.port), ports, (v) => (S.port = Number(v)))),
        row('Displaytyp -y', h('input', { value: S.displayType, placeholder: 'leer = Gerätestandard, z. B. l, c, e', size: 6, onchange: (e: Event) => (S.displayType = (e.target as HTMLInputElement).value.trim()) })),
        row('Korrektur', h('button', { class: 'mini', onclick: () => file.click() }, S.correction ? S.correction.name : 'CCMX/CCSS wählen …'), S.correction && h('button', { class: 'mini', onclick: () => { S.correction = null; renderMeter(); } }, '✕'), file),
        row('', h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: S.skipCal, onchange: (e: Event) => (S.skipCal = (e.target as HTMLInputElement).checked) }), 'Anfangskalibrierung überspringen (-N)')),
        row('',
          h('button', { class: 'primary', onclick: connect }, meter?.connected ? 'Neu verbinden' : 'Verbinden'),
          meter?.connected && h('button', { onclick: () => { meter?.close(); renderMeter(); } }, 'Trennen'),
          meter?.connected && h('button', { onclick: testRead }, 'Testmessung'),
          meter?.connected && h('button', { title: 'Leertaste an spotread senden (z. B. nach Kalibrieraufforderung)', onclick: () => meter?.key(' ') }, 'Taste senden')),
      );
    }
    meterBox.replaceChildren(...kids.filter(Boolean) as Node[]);
  };
  const connect = async () => {
    meter ??= new Meter(wsBase);
    meter.onLog = (t) => { log.textContent = (log.textContent + t).slice(-6000); log.scrollTop = log.scrollHeight; };
    meter.onStatus = setStatus;
    try { await meter.open({ port: S.port, displayType: S.displayType || undefined, correction: S.correction ?? undefined, skipCal: S.skipCal }); S.mode = S.mode === 'manual' ? 'meter' : S.mode; }
    catch (e) { setStatus((e as Error).message, 'error'); }
    renderMeter(); renderSetup();
  };
  const testRead = async () => {
    try { const x = await meter!.read(); setStatus(`XYZ ${x.map((v) => v.toFixed(3)).join(' / ')} cd/m²`, 'ok'); } catch (e) { setStatus((e as Error).message, 'error'); }
  };

  // ---------------------------------------------------------------- manual input
  const askManual = (label: string, signal: AbortSignal): Promise<XYZ | null> => new Promise((ok, fail) => {
    const ins = [0, 1, 2].map(() => h('input', { type: 'number', step: 'any', class: 'num' }) as HTMLInputElement);
    const names = S.entry === 'XYZ' ? ['X', 'Y', 'Z'] : ['x', 'y', 'Y cd/m²'];
    const take = () => {
      const v = ins.map((i) => Number(i.value.replace(',', '.')));
      if (!v.every(Number.isFinite) || (S.entry === 'XYZ' ? v[1] < 0 : v[2] < 0)) { setStatus('Drei Zahlen eingeben', 'error'); return; }
      work.replaceChildren(h('p', { class: 'hint' }, 'Übernommen – nächstes Feld …'));
      ok(S.entry === 'XYZ' ? (v as XYZ) : xyYToXyz(v[0], v[1], v[2]));
    };
    signal.addEventListener('abort', () => fail(new DOMException('abgebrochen', 'AbortError')), { once: true });
    work.replaceChildren(h('div', { class: 'mtitle' }, `Messwert für: ${label}`),
      row('Eingabe', sel(S.entry, [['XYZ', 'XYZ (cd/m²)'], ['xyY', 'x, y, Y']], (v) => { S.entry = v as 'XYZ' | 'xyY'; }, 'wirkt ab dem nächsten Feld')),
      h('div', { class: 'mrow' }, ...ins.flatMap((i, k) => [h('span', { class: 'lbl' }, names[k]), i])),
      h('div', { class: 'mrow' }, h('button', { class: 'primary', onclick: take }, 'Übernehmen (Enter)'), h('button', { onclick: () => { work.replaceChildren(); ok(null); } }, 'Überspringen')));
    ins.forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') take(); }));
    ins[0].focus();
  });
  const confirm = (text: string, signal: AbortSignal) => new Promise<void>((ok, fail) => {
    signal.addEventListener('abort', () => fail(new DOMException('abgebrochen', 'AbortError')), { once: true });
    work.replaceChildren(h('p', {}, text), h('button', { class: 'primary', onclick: () => ok() }, 'Weiter'));
  });
  const measureOne = (label: string, signal: AbortSignal) => (S.mode === 'meter' && meter?.connected ? meter.read(signal) : askManual(label, signal));

  // ---------------------------------------------------------------- setup
  const setupBox = h('div');
  const renderSetup = () => {
    const set = testSet(S.setId === 'hdr' ? `hdr-pq-${S.peak}` : S.setId);
    setupBox.replaceChildren(
      h('div', { class: 'mtitle' }, 'Messfeld-Ausgabe'),
      row('', h('button', { onclick: () => host.openPatchWindow() }, 'Messfenster öffnen'), h('button', { onclick: () => sendPatch({ rgb: [1, 1, 1], window: S.window / 100, background: S.background / 100 }) }, 'Weißfeld zeigen'), h('button', { onclick: () => sendPatch(null) }, 'Testbild zurück')),
      row('Feldgröße', num(S.window, 1, 100, 1, (v) => (S.window = v)), '% der Fläche'),
      row('Hintergrund', num(S.background, 0, 50, 1, (v) => (S.background = v)), '% Grau (APL gegen ABL; DisplayCAL: 22)'),
      row('Einschwingzeit', num(S.settleMs, 20, 60000, 100, (v) => (S.settleMs = v)), 'ms je Feld'),
      row('Vollbild-Einschub', h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: S.insertion, onchange: (e: Event) => (S.insertion = (e.target as HTMLInputElement).checked) }), 'an'),
        'alle', num(S.insEvery, 1, 600, 1, (v) => (S.insEvery = v)), 's für', num(S.insDur, 1, 60, 1, (v) => (S.insDur = v)), 's, Pegel', num(S.insLevel, 0, 100, 1, (v) => (S.insLevel = v)), '%'),
      h('p', { class: 'hint' }, 'Die Canvas-Ausgabe ist 8 bit und läuft durch die Farbverwaltung des Systems. Für unveränderte Codewerte das Systemprofil passend setzen oder einen externen Generator (untethered) nutzen.'),
      h('div', { class: 'mtitle' }, 'Messung'),
      row('Modus', sel(S.mode, [['meter', 'Messgerät (spotread)'], ['manual', 'Manuelle Eingabe'], ['untethered', 'Untethered: externer Generator, Feldwechsel automatisch']], (v) => { S.mode = v as Mode; }),
      ),
      row('Testfeldsatz', sel(set.hdr ? 'hdr' : S.setId, [...TEST_SETS.filter((t) => !t.hdr).map((t): [string, string] => [t.id, `${t.name} (${t.patches.length})`]), ['hdr', 'HDR PQ']], (v) => { S.setId = v; renderSetup(); }),
        set.hdr && sel(String(S.peak), HDR_PEAKS.map((p) => [String(p), `Spitze ${p} cd/m²`]), (v) => { S.peak = Number(v); renderSetup(); })),
      set.hdr ? h('p', { class: 'hint' }, `${set.patches.length} Felder, Ziel PQ absolut im Rec.2020-Container. Ungeprüft: braucht einen Signalweg, der die PQ-Codewerte unverändert an ein HDR-Display gibt.`)
        : row('Ziel', sel(S.transfer, (['bt1886', 'g24', 'g22', 'srgb'] as SdrTarget[]).map((t) => [t, TARGET_LABELS[t]]), (v) => (S.transfer = v as SdrTarget)),
          sel(S.gamut, (['709', 'p3', '2020'] as GamutId[]).map((g) => [g, GAMUTS[g].name]), (v) => (S.gamut = v as GamutId))),
      row('', h('button', { class: 'primary', onclick: () => runVerify(set) }, `Verifikation starten (${set.patches.length} Felder)`),
        h('span', {}, 'Uniformität'), sel(String(S.grid), UNIFORMITY_GRIDS.map((n) => [String(n), `${n}×${n}`]), (v) => (S.grid = Number(v))),
        h('button', { onclick: runUniformity }, 'Uniformität starten'),
        h('button', { onclick: () => running?.stop() }, 'Stopp')),
    );
  };

  const frameOf = (rgb: [number, number, number], label: string): PatchFrame => ({ rgb, window: S.window / 100, background: S.background / 100, label });
  const seqOpts = () => ({ settleMs: S.settleMs, insertion: S.insertion ? { everyS: S.insEvery, durationS: S.insDur, level: S.insLevel / 100 } : null });

  // ---------------------------------------------------------------- verification
  async function runVerify(set: TestSet) {
    running?.stop();
    const target = set.hdr ? defaultTarget(true) : defaultTarget(false, S.gamut, S.transfer);
    const readings: (XYZ | null)[] = new Array(set.patches.length).fill(null);
    const progress = (i: number) => setStatus(`Feld ${i + 1}/${set.patches.length}: ${set.patches[i].label}`);
    if (S.mode === 'untethered') { await runUntethered(set, readings, target); return; }
    if (S.mode === 'meter' && !meter?.connected) { setStatus('Messgerät nicht verbunden – Modus „Manuelle Eingabe“ wählen oder verbinden.', 'error'); return; }
    const seq = new PatchSequencer<XYZ>(set.patches.map((p) => frameOf(p.rgb, p.label)), (_f, i, signal) => { progress(i); return measureOne(set.patches[i].label, signal); }, seqOpts());
    running = seq;
    await seq.run(({ index, result }) => { readings[index] = result; showVerify(set, readings, target, true); });
    work.replaceChildren();
    running = null;
    setStatus(seq.stopped ? 'Abgebrochen.' : 'Verifikation fertig.', 'ok');
    showVerify(set, readings, target, false);
  }

  async function runUntethered(set: TestSet, readings: (XYZ | null)[], target: ReturnType<typeof defaultTarget>) {
    if (!meter?.connected) { setStatus('Untethered braucht ein verbundenes Messgerät.', 'error'); return; }
    const det = new UntetheredDetector();
    const ctl = new AbortController();
    running = { stop: () => ctl.abort() };
    let i = 0, last: XYZ | null = null;
    const take = (x: XYZ) => { readings[i] = x; i++; showVerify(set, readings, target, true); };
    try {
      while (i < set.patches.length && !ctl.signal.aborted) {
        work.replaceChildren(h('p', {}, `Am Generator einstellen: Feld ${i + 1}/${set.patches.length} – ${set.patches[i].label} (Codewerte ${set.patches[i].rgb.map((v) => Math.round(v * 255)).join('/')})`),
          h('button', { title: 'Letzte Messung diesem Feld zuordnen (z. B. zwei gleiche Felder hintereinander)', onclick: () => { if (last) take(det.accept(last)); } }, 'Letzten Messwert übernehmen'));
        last = await meter.read(ctl.signal);
        const acc = det.push(last);
        if (acc) take(acc);
        await new Promise((r) => setTimeout(r, 750));
      }
    } catch (e) { if ((e as Error).name !== 'AbortError') setStatus((e as Error).message, 'error'); }
    running = null; work.replaceChildren();
    showVerify(set, readings, target, false);
  }

  function showVerify(set: TestSet, readings: (XYZ | null)[], target: ReturnType<typeof defaultTarget>, partial: boolean) {
    const r = verify(set, readings, target, S.mode === 'manual' ? 'manuell' : `spotread${S.correction ? ` + ${S.correction.name}` : ''}${S.mode === 'untethered' ? ' (untethered)' : ''}`);
    lastVerify = { report: r, set, readings: [...readings] };
    renderResults(partial);
  }

  // ---------------------------------------------------------------- uniformity
  async function runUniformity() {
    running?.stop();
    const n = S.grid;
    if (S.mode === 'untethered') { setStatus('Uniformität geht nur mit Messgerät oder manueller Eingabe.', 'error'); return; }
    if (S.mode === 'meter' && !meter?.connected) { setStatus('Messgerät nicht verbunden.', 'error'); return; }
    const cells = uniformityCells(n);
    const frames = cells.flatMap((c) => UNIFORMITY_LEVELS.map((l) => ({ rgb: [l, l, l] as [number, number, number], rect: c.rect, background: 0, label: `Zeile ${c.row + 1} Spalte ${c.col + 1} · ${l * 100} %` })));
    const readings: XYZ[][] = cells.map(() => []);
    const seq = new PatchSequencer<XYZ>(frames, async (f, i, signal) => {
      const c = cells[Math.floor(i / UNIFORMITY_LEVELS.length)];
      if (i % UNIFORMITY_LEVELS.length === 0 && S.mode === 'meter') await confirm(`Messgerät auf das leuchtende Feld Zeile ${c.row + 1}, Spalte ${c.col + 1} legen, dann Weiter.`, signal);
      setStatus(f.label!);
      return measureOne(f.label!, signal);
    }, seqOpts());
    running = seq;
    const out = await seq.run();
    running = null; work.replaceChildren();
    out.forEach((x, i) => { if (x) readings[Math.floor(i / UNIFORMITY_LEVELS.length)][i % UNIFORMITY_LEVELS.length] = x; });
    if (readings.some((c) => c.length < UNIFORMITY_LEVELS.length || c.some((x) => !x))) { setStatus('Uniformität unvollständig – nicht ausgewertet.', 'error'); return; }
    try { lastUniformity = evaluateUniformity(n, readings); renderResults(false); } catch (e) { setStatus((e as Error).message, 'error'); }
  }

  // ---------------------------------------------------------------- results
  function renderResults(partial: boolean) {
    const kids: Kid[] = [];
    const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '–');
    if (lastVerify) {
      const r = lastVerify.report;
      const lut = (size: 33 | 65) => {
        const c = buildCube(lastVerify!.set, lastVerify!.readings, r.target, size);
        if (typeof c === 'string') { setStatus(c, 'error'); return; }
        download(`lz-scopes-display-${size}.cube`, c.text);
        setStatus(`LUT ${size}³ exportiert (Modellfehler ΔE00 Mittel ${c.error.mean.toFixed(2)}, ${c.clipped} Stützstellen geclippt)`, 'ok');
      };
      kids.push(h('div', { class: 'mtitle' }, `Verifikation: ${r.set}${partial ? ' (läuft)' : ''}`),
        h('table', { class: 'calib-table' },
          h('tr', {}, h('th', {}, ''), h('th', {}, 'Mittel'), h('th', {}, 'Median'), h('th', {}, '95 %'), h('th', {}, 'Max')),
          h('tr', {}, h('td', {}, `ΔE00 (${r.dE00.n})`), ...[r.dE00.mean, r.dE00.median, r.dE00.p95, r.dE00.max].map((v) => h('td', {}, f(v)))),
          h('tr', {}, h('td', {}, 'ΔITP'), ...[r.dITP.mean, r.dITP.median, r.dITP.p95, r.dITP.max].map((v) => h('td', {}, f(v))))),
        !r.whiteMeasured && !r.hdr && h('p', { class: 'hint bad' }, 'Weiß (100 %) und Schwarz noch nicht gemessen – Sollwerte vorläufig mit 100 bzw. 0 cd/m².'),
        h('p', { class: 'hint' }, `Mittel ${r.grades.mean} · Max ${r.grades.max} (DisplayCAL-Grenzen 1,5/1 bzw. 4/3)${r.hdr ? '' : ` · Weiß ${f(r.lw, 1)} cd/m², Schwarz ${f(r.lb, 4)} cd/m², Kontrast ${Number.isFinite(r.contrast) ? Math.round(r.contrast) : '∞'}:1`}${r.white ? ` · ${Math.round(r.white.cct)} K, Duv ${f(r.white.duv, 4)}, Weiß ΔE00 ${f(r.white.dE00)}` : ''}`),
        h('div', { class: 'mrow' },
          h('button', { onclick: () => download('verifikation.csv', verifyCsv(r), 'text/csv') }, 'CSV'),
          h('button', { onclick: () => download('verifikation.html', verifyHtml(r), 'text/html') }, 'HTML'),
          h('button', { title: 'Bericht drucken oder als PDF sichern', onclick: () => openReport(verifyHtml(r)) }, 'Bericht / PDF'),
          !r.hdr && h('button', { title: 'Matrix/Shaper-Modell aus den Messungen; nur wenn das Modell passt', onclick: () => lut(33) }, '.cube 33'),
          !r.hdr && h('button', { onclick: () => lut(65) }, '.cube 65')));
    }
    if (lastUniformity) {
      const u = lastUniformity;
      kids.push(h('div', { class: 'mtitle' }, `Uniformität ${u.n}×${u.n}`),
        h('table', { class: 'calib-grid' }, ...Array.from({ length: u.n }, (_, rr) => h('tr', {}, ...u.cells.filter((c) => c.row === rr).map((c) =>
          h('td', { class: `g-${c.grade}`, title: `Leuchtdichte ${c.lumDev.map((d) => d.toFixed(1)).join(' / ')} %` }, f(Math.max(...c.dE00))))))),
        h('p', { class: 'hint' }, `Max ΔE00 ${f(u.maxDE00)} (${u.grade}; ISO 14861 laut DisplayCAL ≤ 4 muss, ≤ 2 soll) · max T ${f(u.maxT, 3)} (< 0,1)${u.warnings.length ? ` · ${u.warnings.join(' ')}` : ''}`),
        h('div', { class: 'mrow' },
          h('button', { onclick: () => download('uniformitaet.csv', uniformityCsv(u), 'text/csv') }, 'CSV'),
          h('button', { onclick: () => download('uniformitaet.html', uniformityHtml(u), 'text/html') }, 'HTML'),
          h('button', { onclick: () => openReport(uniformityHtml(u)) }, 'Bericht / PDF')));
    }
    results.replaceChildren(...kids.filter(Boolean) as Node[]);
  }
  // Print through a hidden frame: works in the browser and in the desktop app (no pop-up needed).
  const openReport = (html: string) => {
    const fr = h('iframe', { style: 'position:fixed;width:0;height:0;border:0;right:0;bottom:0' }) as HTMLIFrameElement;
    fr.srcdoc = html;
    fr.onload = () => { fr.contentWindow?.print(); setTimeout(() => fr.remove(), 60_000); };
    document.body.append(fr);
  };

  const minutes = Math.floor(performance.now() / 60000);
  dlg.append(
    h('div', { class: 'calib-head' }, h('h3', {}, 'Display-Kalibrierung und Verifikation'), h('button', { onclick: () => dlg.close() }, 'Schließen')),
    h('p', { class: 'hint' }, `Display und Messgerät vorher mindestens 30 Minuten aufwärmen lassen (DisplayCAL-Empfehlung), Kontaktmessgerät schon auflegen. LZ Scopes läuft seit ${minutes} min.`),
    meterBox, setupBox, status, work, results, h('details', {}, h('summary', {}, 'spotread-Protokoll'), log));
  document.body.append(dlg);
  dlg.addEventListener('close', () => { running?.stop(); sendPatch(null); meter?.close(); dlg.remove(); });
  renderMeter(); renderSetup(); renderResults(false);
  dlg.showModal();
  if (httpBase) meterInfo(httpBase).then((i) => { info = i; renderMeter(); });
  else { info = null; renderMeter(); }
}
