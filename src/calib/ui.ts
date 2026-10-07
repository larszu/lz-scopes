// Display calibration / verification dialog (#9). Patches go to the pattern output window through
// the shared sequencer (src/patchSequencer.ts); readings come from ArgyllCMS spotread via the
// bridge, from manual input, or untethered from an external generator.

import { GAMUTS, type GamutId } from '../color';
import { PatchSequencer, sendPatch, type PatchFrame } from '../patchSequencer';
import { TARGET_LABELS, xyYToXyz, type SdrTarget, type XYZ } from './colorimetry';
import { buildCube } from './lut3d';
import { Meter, meterInfo, type MeterInfo } from './meter';
import { uniformityCsv, uniformityHtml, verifyCsv, verifyHtml } from './report';
import { HDR_PEAKS, TEST_SETS, UNIFORMITY_GRIDS, UNIFORMITY_LEVELS, testSet, uniformityCells, type TestSet } from './testsets';
import { evaluateUniformity, type UniformityReport } from './uniformity';
import { UntetheredDetector } from './untethered';
import { defaultTarget, verify, type VerifyReport } from './verify';
import { gradeLabel } from './report';
import { num, t } from '../i18n';
import { button, checkbox, download, field, filePicker, h, hint, kicker, modal, numberInput, row, select as sel, table, textInput, type Kid } from '../ui';

const numIn = (value: number, min: number, max: number, step: number, on: (v: number) => void, title = '') =>
  numberInput(value, on, { min, max, step, title, size: 'l' });

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
  const status = h('div', { class: 'hint', role: 'status' });
  const log = h('pre', { class: 'calib-log' });
  const work = h('div', { class: 'calib-work' });
  const results = h('div', { class: 'calib-results' });
  const setStatus = (msg: string, kind: 'info' | 'ok' | 'error' = 'info') => { status.textContent = msg; status.className = `hint ${kind === 'ok' ? 'ok' : kind === 'error' ? 'bad' : ''}`; };
  const wsBase = host.bridgeWs(), httpBase = host.bridgeHttp();

  const meterBox = h('div');
  const renderMeter = () => {
    const bridge = !!httpBase;
    const kids: Kid[] = [kicker(t('calib.meter.title')),
      hint(t('calib.meter.argyllHint'))];
    if (info === undefined) kids.push(hint(t('calib.meter.searching')));
    else if (!bridge || info === null) kids.push(hint(t('calib.meter.noBridge')));
    else if (!info.found) kids.push(h('p', { class: 'hint bad' }, t('calib.meter.notFound')));
    else {
      const ports: [string, string][] = info.instruments.length ? info.instruments.map((i) => [String(i.port), `${i.port}: ${i.name}`]) : [['1', t('calib.meter.portDefault')]];
      const file = filePicker('.ccmx,.ccss', async ([f]) => { S.correction = { name: f.name, text: await f.text() }; renderMeter(); });
      kids.push(
        hint(`spotread: ${info.path}${info.version ? ` (${t('calib.meter.version', { v: info.version })})` : ''} · ${t('calib.meter.untested')}`),
        field(t('calib.meter.port'), sel(String(S.port), ports, (v) => (S.port = Number(v)))),
        field(t('calib.meter.displayType'), textInput(S.displayType, (v) => (S.displayType = v.trim()), { placeholder: t('calib.meter.displayTypePh') })),
        field(t('calib.meter.correction'), button(S.correction ? S.correction.name : t('calib.meter.chooseCorrection'), () => file.pick(), { small: true }),
          S.correction && button('✕', () => { S.correction = null; renderMeter(); }, { small: true, title: t('common.close') }), file.input),
        field('', checkbox(S.skipCal, t('calib.meter.skipCal'), (v) => (S.skipCal = v))),
        field('',
          button(meter?.connected ? t('calib.meter.reconnect') : t('calib.meter.connect'), connect, { variant: 'primary' }),
          meter?.connected && button(t('calib.meter.disconnect'), () => { meter?.close(); renderMeter(); }),
          meter?.connected && button(t('calib.meter.testRead'), testRead),
          meter?.connected && button(t('calib.meter.key'), () => meter?.key(' '), { title: t('calib.meter.keyTitle') })),
      );
    }
    meterBox.replaceChildren(...(kids.filter(Boolean) as Node[]));
  };
  const connect = async () => {
    meter ??= new Meter(wsBase);
    meter.onLog = (text) => { log.textContent = (log.textContent + text).slice(-6000); log.scrollTop = log.scrollHeight; };
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
    const ins = [0, 1, 2].map(() => h('input', { type: 'number', step: 'any', class: 'num num-l', inputmode: 'decimal' }));
    const names = S.entry === 'XYZ' ? ['X', 'Y', 'Z'] : ['x', 'y', 'Y cd/m²'];
    const take = () => {
      const v = ins.map((i) => Number(i.value.replace(',', '.')));
      if (!v.every(Number.isFinite) || (S.entry === 'XYZ' ? v[1] < 0 : v[2] < 0)) { setStatus(t('calib.manual.three'), 'error'); return; }
      work.replaceChildren(hint(t('calib.manual.taken')));
      ok(S.entry === 'XYZ' ? (v as XYZ) : xyYToXyz(v[0], v[1], v[2]));
    };
    signal.addEventListener('abort', () => fail(new DOMException('aborted', 'AbortError')), { once: true });
    work.replaceChildren(kicker(t('calib.manual.readingFor', { label })),
      field(t('calib.manual.entry'), sel(S.entry, [['XYZ', 'XYZ (cd/m²)'], ['xyY', 'x, y, Y']], (v) => { S.entry = v as 'XYZ' | 'xyY'; }, t('calib.manual.entryTitle'))),
      row(...ins.flatMap((i, k) => [h('span', { class: 'lbl' }, names[k]), i])),
      row(button(t('calib.manual.take'), take, { variant: 'primary' }), button(t('calib.manual.skip'), () => { work.replaceChildren(); ok(null); })));
    ins.forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') take(); }));
    ins[0].focus();
  });
  const confirm = (text: string, signal: AbortSignal) => new Promise<void>((ok, fail) => {
    signal.addEventListener('abort', () => fail(new DOMException('aborted', 'AbortError')), { once: true });
    work.replaceChildren(h('p', {}, text), button(t('calib.continue'), () => ok(), { variant: 'primary' }));
  });
  const measureOne = (label: string, signal: AbortSignal) => (S.mode === 'meter' && meter?.connected ? meter.read(signal) : askManual(label, signal));

  // ---------------------------------------------------------------- setup
  const setupBox = h('div');
  const renderSetup = () => {
    const set = testSet(S.setId === 'hdr' ? `hdr-pq-${S.peak}` : S.setId);
    setupBox.replaceChildren(
      kicker(t('calib.setup.output')),
      field('', button(t('calib.setup.openWindow'), () => host.openPatchWindow()), button(t('calib.setup.showWhite'), () => sendPatch({ rgb: [1, 1, 1], window: S.window / 100, background: S.background / 100 })), button(t('calib.setup.patternBack'), () => sendPatch(null))),
      field(t('calib.setup.window'), numIn(S.window, 1, 100, 1, (v) => (S.window = v)), t('calib.setup.windowUnit')),
      field(t('calib.setup.background'), numIn(S.background, 0, 50, 1, (v) => (S.background = v)), t('calib.setup.backgroundUnit')),
      field(t('calib.setup.settle'), numIn(S.settleMs, 20, 60000, 100, (v) => (S.settleMs = v)), t('calib.setup.settleUnit')),
      field(t('calib.setup.insertion'), checkbox(S.insertion, t('calib.setup.insOn'), (v) => (S.insertion = v)),
        t('calib.setup.insEvery'), numIn(S.insEvery, 1, 600, 1, (v) => (S.insEvery = v)), t('calib.setup.insFor'), numIn(S.insDur, 1, 60, 1, (v) => (S.insDur = v)), t('calib.setup.insLevel'), numIn(S.insLevel, 0, 100, 1, (v) => (S.insLevel = v)), '%'),
      hint(t('calib.setup.canvasHint')),
      kicker(t('calib.setup.measurement')),
      field(t('calib.setup.mode'), sel(S.mode, [['meter', t('calib.mode.meter')], ['manual', t('calib.mode.manual')], ['untethered', t('calib.mode.untethered')]], (v) => { S.mode = v as Mode; }),
      ),
      field(t('calib.setup.testSet'), sel(set.hdr ? 'hdr' : S.setId, [...TEST_SETS.filter((ts) => !ts.hdr).map((ts): [string, string] => [ts.id, `${ts.name} (${ts.patches.length})`]), ['hdr', 'HDR PQ']], (v) => { S.setId = v; renderSetup(); }),
        set.hdr && sel(String(S.peak), HDR_PEAKS.map((p) => [String(p), t('calib.setup.peak', { p })]), (v) => { S.peak = Number(v); renderSetup(); })),
      set.hdr ? hint(t('calib.setup.hdrHint', { n: set.patches.length }))
        : field(t('calib.setup.target'), sel(S.transfer, (['bt1886', 'g24', 'g22', 'srgb'] as SdrTarget[]).map((tr) => [tr, TARGET_LABELS[tr]]), (v) => (S.transfer = v as SdrTarget)),
          sel(S.gamut, (['709', 'p3', '2020'] as GamutId[]).map((g) => [g, GAMUTS[g].name]), (v) => (S.gamut = v as GamutId))),
      field('', button(t('calib.setup.startVerify', { n: set.patches.length }), () => runVerify(set), { variant: 'primary' }),
        h('span', {}, t('calib.uniformity')), sel(String(S.grid), UNIFORMITY_GRIDS.map((n) => [String(n), `${n}×${n}`]), (v) => (S.grid = Number(v))),
        button(t('calib.setup.startUniformity'), runUniformity),
        button(t('calib.stop'), () => running?.stop())),
    );
  };

  const frameOf = (rgb: [number, number, number], label: string): PatchFrame => ({ rgb, window: S.window / 100, background: S.background / 100, label });
  const seqOpts = () => ({ settleMs: S.settleMs, insertion: S.insertion ? { everyS: S.insEvery, durationS: S.insDur, level: S.insLevel / 100 } : null });

  // ---------------------------------------------------------------- verification
  async function runVerify(set: TestSet) {
    running?.stop();
    const target = set.hdr ? defaultTarget(true) : defaultTarget(false, S.gamut, S.transfer);
    const readings: (XYZ | null)[] = new Array(set.patches.length).fill(null);
    const progress = (i: number) => setStatus(t('calib.progress', { i: i + 1, n: set.patches.length, label: set.patches[i].label }));
    if (S.mode === 'untethered') { await runUntethered(set, readings, target); return; }
    if (S.mode === 'meter' && !meter?.connected) { setStatus(t('calib.err.meterNotConnectedManual'), 'error'); return; }
    const seq = new PatchSequencer<XYZ>(set.patches.map((p) => frameOf(p.rgb, p.label)), (_f, i, signal) => { progress(i); return measureOne(set.patches[i].label, signal); }, seqOpts());
    running = seq;
    await seq.run(({ index, result }) => { readings[index] = result; showVerify(set, readings, target, true); });
    work.replaceChildren();
    running = null;
    setStatus(seq.stopped ? t('calib.aborted') : t('calib.verifyDone'), 'ok');
    showVerify(set, readings, target, false);
  }

  async function runUntethered(set: TestSet, readings: (XYZ | null)[], target: ReturnType<typeof defaultTarget>) {
    if (!meter?.connected) { setStatus(t('calib.err.untetheredNeedsMeter'), 'error'); return; }
    const det = new UntetheredDetector();
    const ctl = new AbortController();
    running = { stop: () => ctl.abort() };
    let i = 0, last: XYZ | null = null;
    const take = (x: XYZ) => { readings[i] = x; i++; showVerify(set, readings, target, true); };
    try {
      while (i < set.patches.length && !ctl.signal.aborted) {
        work.replaceChildren(h('p', {}, t('calib.untethered.set', { i: i + 1, n: set.patches.length, label: set.patches[i].label, codes: set.patches[i].rgb.map((v) => Math.round(v * 255)).join('/') })),
          button(t('calib.untethered.takeLast'), () => { if (last) take(det.accept(last)); }, { title: t('calib.untethered.takeLastTitle') }));
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
    const r = verify(set, readings, target, S.mode === 'manual' ? t('calib.manualShort') : `spotread${S.correction ? ` + ${S.correction.name}` : ''}${S.mode === 'untethered' ? ' (untethered)' : ''}`);
    lastVerify = { report: r, set, readings: [...readings] };
    renderResults(partial);
  }

  // ---------------------------------------------------------------- uniformity
  async function runUniformity() {
    running?.stop();
    const n = S.grid;
    if (S.mode === 'untethered') { setStatus(t('calib.err.uniformityMode'), 'error'); return; }
    if (S.mode === 'meter' && !meter?.connected) { setStatus(t('calib.err.meterNotConnected'), 'error'); return; }
    const cells = uniformityCells(n);
    const frames = cells.flatMap((c) => UNIFORMITY_LEVELS.map((l) => ({ rgb: [l, l, l] as [number, number, number], rect: c.rect, background: 0, label: t('calib.uniformity.cell', { row: c.row + 1, col: c.col + 1, level: l * 100 }) })));
    const readings: XYZ[][] = cells.map(() => []);
    const seq = new PatchSequencer<XYZ>(frames, async (f, i, signal) => {
      const c = cells[Math.floor(i / UNIFORMITY_LEVELS.length)];
      if (i % UNIFORMITY_LEVELS.length === 0 && S.mode === 'meter') await confirm(t('calib.uniformity.place', { row: c.row + 1, col: c.col + 1 }), signal);
      setStatus(f.label!);
      return measureOne(f.label!, signal);
    }, seqOpts());
    running = seq;
    const out = await seq.run();
    running = null; work.replaceChildren();
    out.forEach((x, i) => { if (x) readings[Math.floor(i / UNIFORMITY_LEVELS.length)][i % UNIFORMITY_LEVELS.length] = x; });
    if (readings.some((c) => c.length < UNIFORMITY_LEVELS.length || c.some((x) => !x))) { setStatus(t('calib.err.uniformityIncomplete'), 'error'); return; }
    try { lastUniformity = evaluateUniformity(n, readings); renderResults(false); } catch (e) { setStatus((e as Error).message, 'error'); }
  }

  // ---------------------------------------------------------------- results
  function renderResults(partial: boolean) {
    const kids: Kid[] = [];
    const f = (v: number, d = 2) => (Number.isFinite(v) ? num(v, d) : '–');
    if (lastVerify) {
      const r = lastVerify.report;
      const lut = (size: 33 | 65) => {
        const c = buildCube(lastVerify!.set, lastVerify!.readings, r.target, size);
        if (typeof c === 'string') { setStatus(c, 'error'); return; }
        download(`lz-scopes-display-${size}.cube`, c.text);
        setStatus(t('calib.lutExported', { size, mean: num(c.error.mean, 2), n: c.clipped }), 'ok');
      };
      kids.push(kicker(`${t('calib.verify.title', { set: r.set })}${partial ? ` ${t('calib.running')}` : ''}`),
        h('div', { class: 'table-wrap' }, table([
          [`ΔE00 (${r.dE00.n})`, ...[r.dE00.mean, r.dE00.median, r.dE00.p95, r.dE00.max].map((v) => f(v))],
          ['ΔITP', ...[r.dITP.mean, r.dITP.median, r.dITP.p95, r.dITP.max].map((v) => f(v))],
        ], { head: ['', t('calib.stat.mean'), 'Median', '95 %', 'Max'], cls: 'calib-table' })),
        !r.whiteMeasured && !r.hdr && h('p', { class: 'hint bad' }, t('calib.verify.noWhite')),
        hint(`${t('calib.verify.grades', { mean: gradeLabel(r.grades.mean), max: gradeLabel(r.grades.max) })}${r.hdr ? '' : ` · ${t('calib.verify.levels', { lw: f(r.lw, 1), lb: f(r.lb, 4), c: Number.isFinite(r.contrast) ? Math.round(r.contrast) : '∞' })}`}${r.white ? ` · ${t('calib.verify.white', { cct: Math.round(r.white.cct), duv: f(r.white.duv, 4), de: f(r.white.dE00) })}` : ''}`),
        row(
          button('CSV', () => download(`${t('calib.file.verify')}.csv`, verifyCsv(r), 'text/csv')),
          button('HTML', () => download(`${t('calib.file.verify')}.html`, verifyHtml(r), 'text/html')),
          button(t('calib.report'), () => openReport(verifyHtml(r)), { title: t('calib.reportTitle') }),
          !r.hdr && button('.cube 33', () => lut(33), { title: t('calib.lutTitle') }),
          !r.hdr && button('.cube 65', () => lut(65))));
    }
    if (lastUniformity) {
      const u = lastUniformity;
      kids.push(kicker(t('calib.uniformity.title', { n: u.n })),
        h('div', { class: 'table-wrap' }, h('table', { class: 'calib-grid' }, ...Array.from({ length: u.n }, (_, rr) => h('tr', {}, ...u.cells.filter((c) => c.row === rr).map((c) =>
          h('td', { class: `g-${c.grade}`, title: t('calib.uniformity.lumTitle', { dev: c.lumDev.map((d) => num(d, 1)).join(' / ') }) }, f(Math.max(...c.dE00)))))))),
        hint(`${t('calib.uniformity.summary', { de: f(u.maxDE00), grade: gradeLabel(u.grade), tmax: f(u.maxT, 3) })}${u.warnings.length ? ` · ${u.warnings.join(' ')}` : ''}`),
        row(
          button('CSV', () => download(`${t('calib.file.uniformity')}.csv`, uniformityCsv(u), 'text/csv')),
          button('HTML', () => download(`${t('calib.file.uniformity')}.html`, uniformityHtml(u), 'text/html')),
          button(t('calib.report'), () => openReport(uniformityHtml(u)))));
    }
    results.replaceChildren(...(kids.filter(Boolean) as Node[]));
  }
  // Print through a hidden frame: works in the browser and in the desktop app (no pop-up needed).
  const openReport = (html: string) => {
    const fr = h('iframe', { style: 'position:fixed;width:0;height:0;border:0;right:0;bottom:0' });
    fr.srcdoc = html;
    fr.onload = () => { fr.contentWindow?.print(); setTimeout(() => fr.remove(), 60_000); };
    document.body.append(fr);
  };

  const minutes = Math.floor(performance.now() / 60000);
  // a running measurement must not end by a stray click next to the dialog: no backdrop close
  const m = modal({
    title: t('calib.dialogTitle'), cls: 'calib', size: 'lg', sticky: true, removeOnClose: true,
    body: [hint(t('calib.warmup', { minutes })), meterBox, setupBox, status, work, results, h('details', { class: 'disclosure' }, h('summary', {}, t('calib.log')), log)],
    actions: [button(t('calib.close'), () => m.close())],
    onClose: () => { running?.stop(); sendPatch(null); meter?.close(); },
  });
  renderMeter(); renderSetup(); renderResults(false);
  m.open();
  if (httpBase) meterInfo(httpBase).then((i) => { info = i; renderMeter(); });
  else { info = null; renderMeter(); }
}
