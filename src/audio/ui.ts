// Sidebar and ⚙ controls for audio: tone generator, audio sources, audio panel settings
// and the self-test. Kept out of main.ts; main.ts only mounts these.

import type { PanelState } from '../panel';
import type { Source } from '../sources';
import { kWeightingPowerGain } from './dsp/kweight';
import { DEFAULT_GEN, expectedSine, type GenConfig, type Signal } from './dsp/signals';
import { LoudnessMeter } from './dsp/loudness';
import { LevelMeter } from './dsp/meters';
import { ALL_CASES, type CaseResult } from './dsp/testsignals';
import { toDb } from './dsp/truepeak';
import { generator, listDevices } from './io';
import { AUDIO_DEFAULTS, TARGETS, fmt1, type AudioPanelOptions } from './panels';
import { channelInfo } from './dsp/layouts';
import { avCalibration, calibratedLead, onAvCalibration, setAvCalibration } from './avcal';
import { monitorSink } from '../sources';
import { lang, t } from '../i18n';
import { button, checkbox, download, field, filePicker, h, hint, numberInput, row, select, type Kid } from '../ui';


// ---------------------------------------------------------------- generator

const LEVELS: [number, string][] = [[-18, '−18 (R 68)'], [-20, '−20'], [-23, '−23'], [-9, '−9'], [0, '0']];
/** Generator signals in the picker (kept here: dsp/signals.ts also runs in the audio worklet). */
const SIGNAL_LABELS: Record<Signal, string> = {
  sine: t('audio.sig.sine'), square: t('audio.sig.square'), triangle: t('audio.sig.triangle'), saw: t('audio.sig.saw'),
  white: t('audio.sig.white'), pink: t('audio.sig.pink'), 'pink-band': t('audio.sig.pinkBand'),
  sweep: t('audio.sig.sweep'), steps: t('audio.sig.steps'),
  'ebu-ident': t('audio.sig.ebuIdent'), glits: 'GLITS', 'ident-lr': t('audio.sig.identLr'), polarity: t('audio.sig.polarity'), avsync: t('audio.sig.avsync'),
  blits: t('audio.sig.blits'), 'ebu-multi': t('audio.sig.ebuMulti'),
};
const TONAL: Signal[] = ['sine', 'square', 'triangle', 'saw'];

/** The generator section in the sidebar. `persist` stores the settings (not the running state). */
export function mountGenerator(el: HTMLElement, saved: Partial<GenConfig> | undefined, sink: string, persist: (cfg: GenConfig, sink: string) => void, addLoopbackSource: () => void,
  measuredAv: () => { ms: number; source: string } | null = () => null) {
  Object.assign(generator.cfg, structuredClone({ ...DEFAULT_GEN, ...saved, running: false }));
  generator.sinkId = sink;
  let outputs: MediaDeviceInfo[] = [];
  const store = () => persist({ ...generator.cfg, running: false }, generator.sinkId);
  const set = (patch: Partial<GenConfig>) => {
    // level above −6 dBFS only after confirmation (audio.md d, Generator 6)
    const lvl = patch.level ?? generator.cfg.level;
    const starting = patch.running ?? generator.cfg.running;
    if (starting && lvl > -6 && (patch.level !== undefined || patch.running) && !confirm(t('audio.gen.loudConfirm', { level: fmt1(lvl) }))) { render(); return; }
    generator.update(patch).then(render);
    store();
    render();
  };
  generator.onState = () => render();
  onAvCalibration(() => render());
  // A/V calibration: the "Messwert übernehmen" button follows the measurement
  setInterval(() => { if (generator.cfg.signal === 'avsync' && !el.contains(document.activeElement)) render(); }, 2000);
  listDevices('audiooutput').then((d) => { outputs = d; render(); });
  navigator.mediaDevices?.addEventListener?.('devicechange', () => listDevices('audiooutput').then((d) => { outputs = d; render(); }));

  function render() {
    const c = generator.cfg;
    const rows: Node[] = [];
    const line = (...kids: Kid[]) => rows.push(row(...kids));
    const lbl = (text: string) => h('span', { class: 'lbl' }, text);
    line(
      select(c.signal, (Object.entries(SIGNAL_LABELS) as [Signal, string][]).map(([k, l]) => [k, l]), (v) => set({ signal: v as Signal }), 'Signal'),
      c.running ? button(t('audio.stop'), () => set({ running: false }), { pressed: true }) : button('▶ Start', () => set({ running: true }), { variant: 'primary' }),
    );
    if (TONAL.includes(c.signal)) line(lbl(t('audio.gen.freq')), numberInput(c.freq, (v) => set({ freq: v }), { min: 10, max: 20000, step: 1, title: '10 Hz – 20 kHz', clamp: true }), 'Hz',
      ...[[997, '997'], [1000, '1k'], [440, '440'], [100, '100'], [10000, '10k']].map(([f, l]) => button(String(l), () => set({ freq: Number(f) }), { small: true, pressed: c.freq === f })));
    line(lbl(t('audio.level')), numberInput(c.level, (v) => set({ level: v }), { min: -90, max: 0, step: 0.5, title: t('audio.gen.levelTitle'), clamp: true }), 'dBFS',
      ...LEVELS.map(([v, l]) => button(l, () => set({ level: v }), { small: true, pressed: c.level === v, title: v === -18 ? t('audio.gen.alignTitle') : '' })));
    if (c.signal === 'sweep') {
      line(lbl('Sweep'), numberInput(c.sweepFrom, (v) => set({ sweepFrom: v }), { min: 10, max: 20000, step: 1, clamp: true }), '–', numberInput(c.sweepTo, (v) => set({ sweepTo: v }), { min: 10, max: 20000, step: 1, clamp: true }), 'Hz');
      line(lbl(t('audio.gen.duration')), numberInput(c.sweepSeconds, (v) => set({ sweepSeconds: v }), { min: 0.5, max: 600, step: 0.5, clamp: true }), 's', checkbox(c.sweepRepeat, t('audio.gen.repeat'), (v) => set({ sweepRepeat: v })));
    }
    if (c.signal === 'steps') line(lbl(t('audio.gen.perStep')), numberInput(c.stepSeconds, (v) => set({ stepSeconds: v }), { min: 0.2, max: 60, step: 0.1, clamp: true }), t('audio.gen.stepsHint'));
    if (c.signal === 'white' || c.signal === 'pink' || c.signal === 'pink-band') {
      line(checkbox(c.correlated, t('audio.gen.correlated'), (v) => set({ correlated: v }), t('audio.gen.correlatedTitle')));
    }
    // channels (2 = stereo, 6 = 5.1, 8 = 7.1 in ffmpeg/WAV order)
    const nch = c.channels ?? 2, chInfo = channelInfo(nch);
    line(lbl(t('audio.channels')), select(String(nch), [['2', 'Stereo'], ['6', '5.1 (L R C LFE Ls Rs)'], ['8', '7.1 (L R C LFE Lb Rb Ls Rs)']], (v) => {
      const n = Number(v), inf = channelInfo(n);
      set({ channels: n, routes: inf.map((ci, i) => c.routes[i] ?? { on: !ci.lfe, invert: false, trim: 0 }) });
    }, t('audio.gen.channelsTitle')));
    // routing
    const route = (i: number, name: string) => {
      const r = c.routes[i] ?? { on: false, invert: false, trim: 0 };
      const upd = (patch: Partial<typeof r>) => {
      const routes = Array.from({ length: Math.max(c.routes.length, i + 1) }, (_, k) => ({ ...(c.routes[k] ?? { on: false, invert: false, trim: 0 }) }));
      Object.assign(routes[i], patch); set({ routes });
    };
      return h('span', { class: 'route' },
        button(name, () => upd({ on: !r.on }), { small: true, pressed: r.on, title: t('audio.gen.routeOnOff', { name }) }),
        button('Ø', () => upd({ invert: !r.invert }), { small: true, pressed: r.invert, title: t('audio.gen.invert') }),
        numberInput(r.trim, (v) => upd({ trim: v }), { min: -40, max: 0, step: 0.5, title: t('audio.gen.routeTrim', { name }), clamp: true }));
    };
    const preset = (label: string, l: boolean, r: boolean, inv: boolean) =>
      button(label, () => set({ routes: [{ on: l, invert: false, trim: 0 }, { on: r, invert: inv, trim: 0 }] }), { small: true, title: label === 'L−R' ? t('audio.gen.antiphase') : '' });
    if (nch <= 2) {
      line(route(0, 'L'), route(1, 'R'));
      line(lbl(t('audio.gen.quick')), preset('L', true, false, false), preset('R', false, true, false), preset('L+R', true, true, false), preset('L−R', true, true, true));
    } else {
      for (let i = 0; i < nch; i += 2) line(...[i, i + 1].filter((k) => k < nch).map((k) => route(k, chInfo[k].name)));
      line(lbl(t('audio.gen.quick')),
        button(t('audio.gen.all'), () => set({ routes: chInfo.map(() => ({ on: true, invert: false, trim: 0 })) }), { small: true }),
        button(t('audio.gen.noLfe'), () => set({ routes: chInfo.map((ci) => ({ on: !ci.lfe, invert: false, trim: 0 })) }), { small: true }));
    }
    // output device
    const outs: [string, string][] = [['', t('audio.defaultOutput')], ...outputs.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i): [string, string] => [d.deviceId, d.label || t('audio.gen.outputN', { n: i + 1 })])];
    line(lbl(t('audio.output')), select(generator.sinkId, outs, (v) => { generator.setSink(v).then(render); store(); }, t('audio.gen.outputTitle')));
    // expected readings
    const fs = generator.sampleRate || 48000;
    const exp = expectedSine(c, (f) => kWeightingPowerGain(f, fs));
    const info: string[] = [];
    if (exp) info.push(t('audio.gen.expected', { dbtp: fmt1(exp.dbtp), lufs: fmt1(exp.lufs) }));
    if (c.signal === 'ebu-ident') info.push(t('audio.gen.infoEbuIdent'));
    if (c.signal === 'glits') info.push(t('audio.gen.infoGlits'));
    if (c.signal === 'ident-lr') info.push(t('audio.gen.infoIdentLr'));
    if (c.signal === 'polarity') info.push(t('audio.gen.infoPolarity'));
    if (c.signal === 'avsync') info.push(t('audio.gen.infoAvsync'));
    if (c.signal === 'pink-band') info.push(t('audio.gen.infoPinkBand'));
    if (c.signal === 'blits') info.push(t('audio.gen.infoBlits') + (nch < 6 ? t('audio.gen.infoBlitsStereo') : ''));
    if (c.signal === 'ebu-multi') info.push(t('audio.gen.infoEbuMulti', { n: chInfo.filter((x) => !x.lfe).length + 4 }));
    if (c.signal === 'white' || c.signal === 'pink' || c.signal === 'pink-band') info.push(t('audio.gen.infoNoise'));
    const lat = generator.latency;
    if (generator.ctx && lat) info.push(t('audio.gen.latency', { khz: fmt1(generator.sampleRate / 1000), base: fmt1(lat.base), output: fmt1(lat.output), n: lat.maxChannels }) + (generator.running ? t('audio.gen.running') : ''));
    if (generator.error) info.push(t('audio.error', { msg: generator.error }));
    rows.push(hint(info.join(' · ')));
    if (c.signal === 'avsync') rows.push(...avCalibrationRows(measuredAv));
    rows.push(row(
      button(t('audio.gen.loopback'), addLoopbackSource, { title: t('audio.gen.loopbackTitle') }),
      button(t('audio.selftest'), () => runSelfTest(result), { title: t('audio.selftest.title') })));
    rows.push(result);
    el.replaceChildren(...rows);
  }
  const result = h('div', { class: 'selftest' });
  render();
}

/**
 * A/V-sync calibration: the beep is placed with the browser's output-latency estimate;
 * for the picture only a measurement helps (avcal.ts, docs/research/audio.md h).
 */
function avCalibrationRows(measuredAv: () => { ms: number; source: string } | null): Node[] {
  const cal = avCalibration();
  const lead = numberInput(cal.videoLeadMs, (v) => setAvCalibration(v, cal.note || t('audio.cal.byHand')), { min: -500, max: 500, step: 1, title: t('audio.cal.leadTitle'), clamp: true });
  const m = measuredAv();
  return [
    row(h('span', { class: 'lbl' }, t('audio.cal.lead')), lead, 'ms',
      button(m ? t('audio.cal.takeMs', { ms: `${m.ms > 0 ? '+' : ''}${fmt1(m.ms)}` }) : t('audio.cal.take'),
        () => { if (m) setAvCalibration(calibratedLead(cal.videoLeadMs, m.ms), t('audio.cal.note', { date: new Date().toLocaleDateString(lang() === 'de' ? 'de-DE' : 'en-GB'), source: m.source })); },
        { small: true, disabled: !m, title: m ? t('audio.cal.takeTitle', { ms: fmt1(m.ms), source: m.source }) : t('audio.cal.measureFirst') }),
      button('0', () => setAvCalibration(0, ''), { small: true, title: t('audio.cal.clear') })),
    hint(cal.note ? t('audio.cal.current', { note: cal.note }) : t('audio.cal.uncalibrated'), t('audio.cal.howTo')),
  ];
}

/** Run all synthesisable Tech 3341/3342 cases through the DSP core (48 kHz). */
async function runSelfTest(out: HTMLElement) {
  out.replaceChildren(hint(t('audio.selftest.running')));
  const results: CaseResult[] = [];
  for (const c of ALL_CASES) {
    await new Promise((r) => setTimeout(r, 0));
    try { results.push(c.run(48000)); } catch (e) { results.push({ id: c.id, label: c.label, expected: '', measured: (e as Error).message, pass: false }); }
  }
  const ok = results.filter((r) => r.pass).length;
  out.replaceChildren(
    h('p', { class: `hint ${ok === results.length ? 'ok' : 'bad'}` }, t('audio.selftest.result', { ok, n: results.length })),
    h('details', {}, h('summary', {}, t('audio.selftest.details')),
      h('table', { class: 'st' }, ...results.map((r) => h('tr', { class: r.pass ? 'ok' : 'bad', title: r.label },
        h('td', {}, r.pass ? '✓' : '✗'), h('td', {}, r.id), h('td', {}, r.measured), h('td', {}, r.expected))))),
  );
}

// ---------------------------------------------------------------- sources

/** How the different inputs reach LZ Scopes (shown under the input selector). */
const INPUT_HINTS: Record<Source['audioIn']['mode'], string> = {
  device: t('audio.src.hintDevice'),
  bridge: t('audio.src.hintBridge'),
  file: t('audio.src.hintFile'),
  generator: t('audio.src.hintGenerator'),
};

/** Controls of an audio-only source (kind 'audio'). */
export function audioSourceControls(s: Source, save: () => void, rerender: () => void, bridge: () => string = () => ''): Node[] {
  const out: Node[] = [];
  const running = s.status === 'live' || s.status === 'connecting';
  const devSel = select(s.audioIn.deviceId, [['', t('audio.src.defaultInput')]], (v) => { s.audioIn.deviceId = v; save(); if (running) s.startAudio(); }, t('audio.src.device'));
  listDevices('audioinput').then((d) => {
    for (const x of d) if (x.deviceId && x.deviceId !== 'default') devSel.append(h('option', { value: x.deviceId, selected: x.deviceId === s.audioIn.deviceId }, x.label || t('audio.src.inputN', { n: devSel.options.length })));
  });
  // bridge audio devices (ffmpeg's device list); #ch=n asks DirectShow/ALSA for more channels
  const brSel = select(s.audioIn.bridgeUrl ?? '', [['', s.audioIn.bridgeUrl ? s.audioIn.bridgeUrl.replace(/^audio:\w+:/, '') : t('audio.src.chooseDevice')]], (v) => { s.audioIn.bridgeUrl = v; save(); s.startAudio(undefined, bridge()); rerender(); }, t('audio.src.bridgeDeviceTitle'));
  if (s.audioIn.mode === 'bridge') {
    fetch(`${bridge().replace(/^ws/, 'http')}/api/devices`).then((r) => r.json()).then((list: { name: string; url: string; kind?: string }[]) => {
      brSel.replaceChildren(h('option', { value: '' }, list.some((d) => d.kind === 'audio') ? t('audio.src.chooseDevice') : t('audio.src.noDevices')),
        ...list.filter((d) => d.kind === 'audio').map((d) => h('option', { value: d.url, selected: d.url === s.audioIn.bridgeUrl }, d.name)));
    }).catch(() => brSel.replaceChildren(h('option', { value: '' }, t('audio.src.bridgeDown'))));
  }
  out.push(row(
    select(s.audioIn.mode, [['device', t('audio.src.modeDevice')], ['bridge', t('audio.src.modeBridge')], ['file', t('audio.src.modeFile')], ['generator', t('audio.src.modeGenerator')]], (v) => { s.audioIn.mode = v as Source['audioIn']['mode']; s.stop(); save(); rerender(); }, t('audio.src.input')),
    s.audioIn.mode === 'device' ? devSel : s.audioIn.mode === 'bridge' ? brSel : ''));
  out.push(hint(INPUT_HINTS[s.audioIn.mode]));
  const file = filePicker('audio/*,video/*', ([f]) => { lastFile.set(s, f); s.startAudio(f).then(rerender); });
  out.push(row(
    running ? button(t('audio.stop'), () => s.stop())
      : button(s.audioIn.mode === 'file' ? t('audio.src.chooseFile') : '▶ Start', () => (s.audioIn.mode === 'file' ? file.pick() : s.startAudio(undefined, bridge())), { variant: 'primary' }),
    file.input,
    s.audioIn.mode === 'file' && lastFile.get(s) && button(t('audio.src.measureFile'), () => measureFile(s, lastFile.get(s)!, rerender), { title: t('audio.src.measureFileTitle') })));
  if (s.audioEl) out.push(h('div', { class: 'row audio-el' }, s.audioEl));
  const fr = fileResults.get(s);
  if (fr) out.push(h('div', { class: 'msg' }, fr));
  return out;
}
const lastFile = new WeakMap<Source, File>();
const fileResults = new WeakMap<Source, string>();

async function measureFile(s: Source, f: File, rerender: () => void) {
  fileResults.set(s, t('audio.src.measuring')); rerender();
  try {
    const ctx = new OfflineAudioContext(1, 1, 48000);
    const buf = await ctx.decodeAudioData(await f.arrayBuffer());
    const chs = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
    const lm = new LoudnessMeter(buf.sampleRate, chs.length), lv = new LevelMeter(buf.sampleRate, chs.length);
    const step = 1 << 16;
    for (let off = 0; off < buf.length; off += step) {
      const n = Math.min(step, buf.length - off);
      lm.process(chs, n, off); lv.process(chs, n, off);
      if ((off / step) % 16 === 15) await new Promise((r) => setTimeout(r, 0));
    }
    const tp = toDb(Math.max(...lv.maxTP));
    fileResults.set(s, t('audio.src.fileResult', { s: fmt1(buf.duration), khz: buf.sampleRate / 1000, ch: chs.length, i: fmt1(lm.integrated), lra: fmt1(lm.lra), m: fmt1(lm.maxM), st: fmt1(lm.maxS), tp: fmt1(tp) }));
  } catch (e) {
    fileResults.set(s, t('audio.src.notMeasurable', { msg: (e as Error).message }));
  }
  rerender();
}

/** Compact row for every source that has sound: rate, I/LRA pause + reset, protocol, monitoring. */
export function audioRow(s: Source, rerender: () => void): Node | null {
  const a = s.audio;
  if (!a) return null;
  const rows: Node[] = [h('div', { class: 'row audio-row' },
    h('span', { class: 'lbl', title: a.label }, t('audio.row.rate', { khz: a.fs / 1000, ch: a.channels })),
    button(a.paused ? '▶ I' : '❚❚ I', () => { a.paused = !a.paused; rerender(); }, { small: true, pressed: a.paused, title: t('audio.row.pauseTitle') }),
    button('⟲ Reset', () => { a.reset(); rerender(); }, { small: true, title: t('audio.row.resetTitle') }),
    button('CSV', () => download(`${fileName(s)}.csv`, a.toCsv(), 'text/csv;charset=utf-8'), { small: true, title: t('audio.row.csvTitle') }),
    button('PNG', () => protocolPng(s).then((b) => b && download(`${fileName(s)}.png`, b)), { small: true, title: t('audio.row.pngTitle') }),
    s.canMonitor && button('🎧', () => { s.setMonitor(!s.monitoring); rerender(); }, { small: true, pressed: s.monitoring, title: s.kind === 'stream' ? t('audio.row.monitorStream') : t('audio.row.monitorDefault') }),
  )];
  if (s.kind === 'stream' && s.monitoring) {
    const outs = select('', [['', t('audio.defaultOutput')]], (v) => { monitorSink.id = v; s.monitor?.setSink(v).then(rerender); }, t('audio.mon.outputTitle'));
    listDevices('audiooutput').then((d) => {
      for (const x of d) if (x.deviceId && x.deviceId !== 'default') outs.append(h('option', { value: x.deviceId, selected: x.deviceId === monitorSink.id }, x.label || t('audio.output')));
    });
    const pairs = Math.ceil(a.channels / 2);
    const pairSel = pairs > 1 ? select(String(monitorSink.pair), Array.from({ length: pairs }, (_, i): [string, string] => [String(i), `${a.names[i * 2]}/${a.names[i * 2 + 1] ?? a.names[i * 2]}`]), (v) => { monitorSink.pair = Number(v); s.monitor?.setPair(monitorSink.pair); }, t('audio.mon.pair')) : '';
    const st = s.monitor?.stats;
    rows.push(row(outs, pairSel));
    rows.push(hint(s.monitorError ? t('audio.mon.error', { msg: s.monitorError })
      : st ? t('audio.mon.stats', { fill: Math.round(st.fillMs), target: Math.round(st.targetMs), ppm: `${st.ppm >= 0 ? '+' : ''}${Math.round(st.ppm)}`, empty: st.underruns ? t('audio.mon.underruns', { n: st.underruns }) : '', out: s.monitor?.latencyMs ?? 0 }) : t('audio.mon.starting')));
  }
  return rows.length === 1 ? rows[0] : h('div', {}, ...rows);
}

const fileName = (s: Source) => `lz-scopes-audio-${s.name.replace(/[^\w-]+/g, '_')}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;

/** PNG protocol: loudness history (whole measurement) and the meter's numbers side by side. */
async function protocolPng(s: Source): Promise<Blob | null> {
  const a = s.audio;
  if (!a) return null;
  const c = document.createElement('canvas');
  c.width = 1600; c.height = 900;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0b0c0e'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#d6d6d6'; ctx.font = '600 20px ui-monospace, Menlo, monospace'; ctx.textBaseline = 'top';
  ctx.fillText(t('audio.png.title', { name: s.name, date: new Date().toLocaleString(lang() === 'de' ? 'de-DE' : 'en-GB') }), 20, 16);
  const minutes = Math.max(1, Math.ceil(a.histLen / 600));
  const { drawAudioPanel } = await import('./panels');
  ctx.save(); ctx.translate(0, 50);
  drawAudioPanel(ctx, 'audio-loudness', a, 1040, 830, { span: minutes }, '', {});
  ctx.restore();
  ctx.save(); ctx.translate(1040, 50);
  drawAudioPanel(ctx, 'audio-meter', a, 560, 830, {}, '', {});
  ctx.restore();
  return new Promise((ok) => c.toBlob((b) => ok(b), 'image/png'));
}

// ---------------------------------------------------------------- panel ⚙

export function audioPanelSettings(p: PanelState, save: () => void): Node[] {
  const o = (p.audio ??= {});
  const v = <K extends keyof AudioPanelOptions>(k: K) => (o[k] ?? AUDIO_DEFAULTS[k]) as NonNullable<AudioPanelOptions[K]>;
  const rows: Node[] = [];
  const row = (label: string, ...kids: Kid[]) => rows.push(field(label, ...kids));
  const pick = <K extends keyof AudioPanelOptions>(k: K, opts: [string, string][], parse: (s: string) => AudioPanelOptions[K]) =>
    select(String(v(k)), opts, (s) => { o[k] = parse(s); save(); });
  if (p.scope === 'audio-meter' || p.scope === 'audio-loudness') {
    row(t('audio.set.scale'), pick('scale', [['ebu9', 'EBU +9 (−18 … +9 LU)'], ['ebu18', 'EBU +18 (−36 … +18 LU)']], (s) => s as 'ebu9'));
    row(t('audio.set.display'), pick('rel', [['false', t('audio.set.abs')], ['true', t('audio.set.rel')]], (s) => s === 'true'));
    row(t('audio.set.target'), pick('target', Object.entries(TARGETS).map(([k, tg]) => [k, tg.hint]), (s) => s as 'r128'));
  }
  if (p.scope === 'audio-loudness') row(t('audio.set.span'), pick('span', [['1', '1 min'], ['5', '5 min'], ['15', '15 min'], ['60', '60 min']], Number));
  if (p.scope === 'audio-spectrum') {
    row('FFT', pick('fft', [1024, 2048, 4096, 8192, 16384, 32768].map((n) => [String(n), String(n)]), Number));
    row(t('audio.channel'), pick('chan', [['lr', t('audio.set.lAndR')], ['mid', '(L+R)/2'], ['l', 'L'], ['r', 'R']], (s) => s as 'lr'));
    row(t('audio.set.view'), pick('bands', [['false', t('audio.set.line')], ['true', t('audio.set.bands')]], (s) => s === 'true'));
    row(t('audio.set.tilt'), pick('tilt', [['0', t('audio.set.tilt0')], ['3', t('audio.set.tilt3')], ['4.5', t('audio.set.tilt45')]], Number));
    row(t('audio.set.smooth'), pick('smooth', [['0', t('audio.set.off')], ['0.5', t('audio.set.light')], ['0.85', t('audio.set.strong')]], Number));
    row(t('audio.set.floor'), pick('floor', [['-80', '−80 dBFS'], ['-100', '−100 dBFS'], ['-120', '−120 dBFS']], Number));
  }
  if (p.scope === 'audio-phase') {
    row('Zoom', pick('zoom', [['0', 'auto'], ['1', '×1'], ['2', '×2'], ['4', '×4'], ['8', '×8']], Number));
    row(t('audio.set.correlation'), pick('corrMs', [['100', '100 ms'], ['300', '300 ms'], ['600', '600 ms'], ['1000', '1 s'], ['3000', '3 s']], Number));
    rows.push(hint(t('audio.set.phaseHint')));
  }
  if (p.scope === 'audio-meter') rows.push(hint(t('audio.set.meterHint')));
  if (p.scope === 'audio-loudness') rows.push(hint(t('audio.set.loudnessHint')));
  if (p.scope === 'audio-check') {
    rows.push(hint(t('audio.set.identHint')));
    rows.push(hint(t('audio.set.avHint')));
  }
  return rows;
}
