// Sidebar and ⚙ controls for audio: tone generator, audio sources, audio panel settings
// and the self-test. Kept out of main.ts; main.ts only mounts these.

import type { PanelState } from '../panel';
import type { Source } from '../sources';
import { kWeightingPowerGain } from './dsp/kweight';
import { DEFAULT_GEN, SIGNAL_LABELS, expectedSine, type GenConfig, type Signal } from './dsp/signals';
import { LoudnessMeter } from './dsp/loudness';
import { LevelMeter } from './dsp/meters';
import { ALL_CASES, type CaseResult } from './dsp/testsignals';
import { toDb } from './dsp/truepeak';
import { generator, listDevices } from './io';
import { AUDIO_DEFAULTS, TARGETS, fmt1, type AudioPanelOptions } from './panels';

type Kid = Node | string;
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: Kid[]) => {
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
const select = (value: string, options: [string, string][], onchange: (v: string) => void, title = '') =>
  h('select', { title, onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value) },
    ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
const num = (value: number, min: number, max: number, step: number, onchange: (v: number) => void, title = '') => {
  const i = h('input', { type: 'number', class: 'num', min, max, step, value, title }) as HTMLInputElement;
  i.onchange = () => { const v = Number(i.value); if (Number.isFinite(v)) onchange(Math.min(max, Math.max(min, v))); };
  return i;
};
const check = (on: boolean, label: string, onchange: (v: boolean) => void, title = '') => {
  const c = h('input', { type: 'checkbox', checked: on }) as HTMLInputElement;
  c.onchange = () => onchange(c.checked);
  return h('label', { class: 'inline', title }, c, label);
};

// ---------------------------------------------------------------- generator

const LEVELS: [number, string][] = [[-18, '−18 (R 68)'], [-20, '−20'], [-23, '−23'], [-9, '−9'], [0, '0']];
const TONAL: Signal[] = ['sine', 'square', 'triangle', 'saw'];

/** The generator section in the sidebar. `persist` stores the settings (not the running state). */
export function mountGenerator(el: HTMLElement, saved: Partial<GenConfig> | undefined, sink: string, persist: (cfg: GenConfig, sink: string) => void, addLoopbackSource: () => void) {
  Object.assign(generator.cfg, structuredClone({ ...DEFAULT_GEN, ...saved, running: false }));
  generator.sinkId = sink;
  let outputs: MediaDeviceInfo[] = [];
  const store = () => persist({ ...generator.cfg, running: false }, generator.sinkId);
  const set = (patch: Partial<GenConfig>) => {
    // level above −6 dBFS only after confirmation (audio.md d, Generator 6)
    const lvl = patch.level ?? generator.cfg.level;
    const starting = patch.running ?? generator.cfg.running;
    if (starting && lvl > -6 && (patch.level !== undefined || patch.running) && !confirm(`Pegel ${fmt1(lvl)} dBFS – das ist laut. Trotzdem ausgeben?`)) { render(); return; }
    generator.update(patch).then(render);
    store();
    render();
  };
  generator.onState = () => render();
  listDevices('audiooutput').then((d) => { outputs = d; render(); });
  navigator.mediaDevices?.addEventListener?.('devicechange', () => listDevices('audiooutput').then((d) => { outputs = d; render(); }));

  function render() {
    const c = generator.cfg;
    const rows: Node[] = [];
    const row = (...kids: Kid[]) => rows.push(h('div', { class: 'row' }, ...kids));
    row(
      select(c.signal, (Object.entries(SIGNAL_LABELS) as [Signal, string][]).map(([k, l]) => [k, l]), (v) => set({ signal: v as Signal }), 'Signal'),
      c.running ? h('button', { class: 'on', onclick: () => set({ running: false }) }, '■ Stopp') : h('button', { class: 'primary', onclick: () => set({ running: true }) }, '▶ Start'),
    );
    if (TONAL.includes(c.signal)) row(h('span', { class: 'lbl' }, 'Frequenz'), num(c.freq, 10, 20000, 1, (v) => set({ freq: v }), '10 Hz – 20 kHz'), 'Hz',
      ...[[997, '997'], [1000, '1k'], [440, '440'], [100, '100'], [10000, '10k']].map(([f, l]) => h('button', { class: `mini ${c.freq === f ? 'on' : ''}`, onclick: () => set({ freq: Number(f) }) }, String(l))));
    row(h('span', { class: 'lbl' }, 'Pegel'), num(c.level, -90, 0, 0.5, (v) => set({ level: v }), 'Spitzenpegel in dBFS'), 'dBFS',
      ...LEVELS.map(([v, l]) => h('button', { class: `mini ${c.level === v ? 'on' : ''}`, title: v === -18 ? 'Ausrichtungspegel EBU R 68' : '', onclick: () => set({ level: v }) }, l)));
    if (c.signal === 'sweep') {
      row(h('span', { class: 'lbl' }, 'Sweep'), num(c.sweepFrom, 10, 20000, 1, (v) => set({ sweepFrom: v })), '–', num(c.sweepTo, 10, 20000, 1, (v) => set({ sweepTo: v })), 'Hz');
      row(h('span', { class: 'lbl' }, 'Dauer'), num(c.sweepSeconds, 0.5, 600, 0.5, (v) => set({ sweepSeconds: v })), 's', check(c.sweepRepeat, 'wiederholen', (v) => set({ sweepRepeat: v })));
    }
    if (c.signal === 'steps') row(h('span', { class: 'lbl' }, 'je Stufe'), num(c.stepSeconds, 0.2, 60, 0.1, (v) => set({ stepSeconds: v })), 's (Terzmitten 20 Hz – 20 kHz)');
    if (c.signal === 'white' || c.signal === 'pink' || c.signal === 'pink-band') {
      row(check(c.correlated, 'korreliert (L = R)', (v) => set({ correlated: v }), 'aus = unabhängiges Rauschen je Kanal'));
    }
    // routing
    const route = (i: number, name: string) => {
      const r = c.routes[i];
      const upd = (patch: Partial<typeof r>) => { const routes = c.routes.map((x) => ({ ...x })); Object.assign(routes[i], patch); set({ routes }); };
      return h('span', { class: 'route' },
        h('button', { class: `mini ${r.on ? 'on' : ''}`, title: `${name} an/aus`, onclick: () => upd({ on: !r.on }) }, name),
        h('button', { class: `mini ${r.invert ? 'on' : ''}`, title: 'Polarität umkehren', onclick: () => upd({ invert: !r.invert }) }, 'Ø'),
        num(r.trim, -40, 0, 0.5, (v) => upd({ trim: v }), `Pegel ${name} relativ, dB`));
    };
    const preset = (label: string, l: boolean, r: boolean, inv: boolean) => h('button', {
      class: 'mini', title: label === 'L−R' ? 'gegenphasig' : '',
      onclick: () => set({ routes: [{ on: l, invert: false, trim: 0 }, { on: r, invert: inv, trim: 0 }] }),
    }, label);
    row(route(0, 'L'), route(1, 'R'));
    row(h('span', { class: 'lbl' }, 'Schnell'), preset('L', true, false, false), preset('R', false, true, false), preset('L+R', true, true, false), preset('L−R', true, true, true));
    // output device
    const outs: [string, string][] = [['', 'Standard-Ausgang'], ...outputs.filter((d) => d.deviceId && d.deviceId !== 'default').map((d, i): [string, string] => [d.deviceId, d.label || `Ausgang ${i + 1}`])];
    row(h('span', { class: 'lbl' }, 'Ausgang'), select(generator.sinkId, outs, (v) => { generator.setSink(v).then(render); store(); }, 'Ausgabegerät (AudioContext.setSinkId)'));
    // expected readings
    const fs = generator.sampleRate || 48000;
    const exp = expectedSine(c, (f) => kWeightingPowerGain(f, fs));
    const info: string[] = [];
    if (exp) info.push(`Erwartet: ${fmt1(exp.dbtp)} dBTP · ${fmt1(exp.lufs)} LUFS`);
    if (c.signal === 'ebu-ident') info.push('1 kHz, L alle 3 s für 250 ms unterbrochen (Tech 3304)');
    if (c.signal === 'glits') info.push('1 kHz, Zyklus 4 s: L 250 ms aus, danach R zweimal 250 ms aus');
    if (c.signal === 'ident-lr') info.push('L: ein Ton, R: zwei Töne (Zyklus 3 s)');
    if (c.signal === 'polarity') info.push('positiver Puls: Goniometer/Analyser zeigt die Polarität je Kanal');
    if (c.signal === 'avsync') info.push('Piep zu jeder vollen Sekunde – dazu das Testbild „A/V-Sync“ ausgeben, es blitzt zeitgleich');
    if (c.signal === 'pink-band') info.push('Tech 3343 LLISTref: bei −23 LUFS gemessen je Lautsprecher 73 dBC SPL');
    if (c.signal === 'white' || c.signal === 'pink' || c.signal === 'pink-band') info.push('Rauschen: gleicher Effektivwert wie ein Sinus dieses Spitzenpegels');
    if (generator.ctx) info.push(`${fmt1(generator.sampleRate / 1000)} kHz · Latenz ${generator.latencyMs} ms${generator.running ? ' · läuft' : ''}`);
    if (generator.error) info.push(`Fehler: ${generator.error}`);
    rows.push(h('p', { class: 'hint' }, info.join(' · ')));
    rows.push(h('div', { class: 'row' },
      h('button', { title: 'Den Generator als Audio-Quelle messen (Rückweg ohne Soundkarte)', onclick: addLoopbackSource }, '→ als Messquelle'),
      h('button', { title: 'Tech-3341/3342-Testsignale durch den Messkern schicken', onclick: () => runSelfTest(result) }, 'Selbsttest')));
    rows.push(result);
    el.replaceChildren(...rows);
  }
  const result = h('div', { class: 'selftest' });
  render();
}

/** Run all synthesisable Tech 3341/3342 cases through the DSP core (48 kHz). */
async function runSelfTest(out: HTMLElement) {
  out.replaceChildren(h('p', { class: 'hint' }, 'Selbsttest läuft …'));
  const results: CaseResult[] = [];
  for (const c of ALL_CASES) {
    await new Promise((r) => setTimeout(r, 0));
    try { results.push(c.run(48000)); } catch (e) { results.push({ id: c.id, label: c.label, expected: '', measured: (e as Error).message, pass: false }); }
  }
  const ok = results.filter((r) => r.pass).length;
  out.replaceChildren(
    h('p', { class: `hint ${ok === results.length ? 'ok' : 'bad'}` }, `Tech 3341/3342: ${ok} von ${results.length} bestanden (48 kHz, erzeugte Signale)`),
    h('details', {}, h('summary', {}, 'Einzelwerte'),
      h('table', { class: 'st' }, ...results.map((r) => h('tr', { class: r.pass ? 'ok' : 'bad', title: r.label },
        h('td', {}, r.pass ? '✓' : '✗'), h('td', {}, r.id), h('td', {}, r.measured), h('td', {}, r.expected))))),
  );
}

// ---------------------------------------------------------------- sources

/** Controls of an audio-only source (kind 'audio'). */
export function audioSourceControls(s: Source, save: () => void, rerender: () => void): Node[] {
  const out: Node[] = [];
  const running = s.status === 'live' || s.status === 'connecting';
  const devSel = select(s.audioIn.deviceId, [['', 'Standard-Eingang']], (v) => { s.audioIn.deviceId = v; save(); if (running) s.startAudio(); }, 'Audiogerät');
  listDevices('audioinput').then((d) => {
    for (const x of d) if (x.deviceId && x.deviceId !== 'default') devSel.append(h('option', { value: x.deviceId, selected: x.deviceId === s.audioIn.deviceId }, x.label || `Eingang ${devSel.options.length}`));
  });
  out.push(h('div', { class: 'row' },
    select(s.audioIn.mode, [['device', 'Audiogerät'], ['file', 'Audiodatei'], ['generator', 'Generator (Rückweg)']], (v) => { s.audioIn.mode = v as Source['audioIn']['mode']; s.stop(); save(); rerender(); }, 'Eingang'),
    s.audioIn.mode === 'device' ? devSel : ''));
  const file = h('input', { type: 'file', accept: 'audio/*,video/*', hidden: true }) as HTMLInputElement;
  file.onchange = () => { const f = file.files?.[0]; if (f) { lastFile.set(s, f); s.startAudio(f).then(rerender); } };
  out.push(h('div', { class: 'row' },
    running ? h('button', { onclick: () => s.stop() }, '■ Stopp')
      : h('button', { class: 'primary', onclick: () => (s.audioIn.mode === 'file' ? file.click() : s.startAudio()) }, s.audioIn.mode === 'file' ? 'Datei wählen …' : '▶ Start'),
    file,
    s.audioIn.mode === 'file' && lastFile.get(s) ? h('button', { title: 'Ganze Datei sofort messen (schneller als Echtzeit)', onclick: () => measureFile(s, lastFile.get(s)!, rerender) }, 'Ganze Datei messen') : ''));
  if (s.audioEl) out.push(h('div', { class: 'row audio-el' }, s.audioEl));
  const fr = fileResults.get(s);
  if (fr) out.push(h('div', { class: 'msg' }, fr));
  return out;
}
const lastFile = new WeakMap<Source, File>();
const fileResults = new WeakMap<Source, string>();

async function measureFile(s: Source, f: File, rerender: () => void) {
  fileResults.set(s, 'Messe …'); rerender();
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
    fileResults.set(s, `Datei (${fmt1(buf.duration)} s, ${buf.sampleRate / 1000} kHz, ${chs.length} Kan.): I ${fmt1(lm.integrated)} LUFS · LRA ${fmt1(lm.lra)} LU · Max M ${fmt1(lm.maxM)} · Max S ${fmt1(lm.maxS)} LUFS · Max TP ${fmt1(tp)} dBTP`);
  } catch (e) {
    fileResults.set(s, `Nicht messbar: ${(e as Error).message}`);
  }
  rerender();
}

/** Compact row for every source that has sound: rate, I/LRA pause + reset, monitoring. */
export function audioRow(s: Source, rerender: () => void): Node | null {
  const a = s.audio;
  if (!a) return null;
  return h('div', { class: 'row audio-row' },
    h('span', { class: 'lbl', title: a.label }, `♪ ${a.fs / 1000} kHz · ${a.channels} Kan.`),
    h('button', { class: `mini ${a.paused ? 'on' : ''}`, title: 'I und LRA anhalten / fortsetzen (Tech 3341)', onclick: () => { a.paused = !a.paused; rerender(); } }, a.paused ? '▶ I' : '❚❚ I'),
    h('button', { class: 'mini', title: 'I, LRA, Max M/S, Max TP und Zähler zurücksetzen', onclick: () => { a.reset(); rerender(); } }, '⟲ Reset'),
    s.canMonitor ? h('button', { class: `mini ${s.monitoring ? 'on' : ''}`, title: 'Mithören über den Standard-Ausgang', onclick: () => { s.setMonitor(!s.monitoring); rerender(); } }, '🎧') : '',
  );
}

// ---------------------------------------------------------------- panel ⚙

export function audioPanelSettings(p: PanelState, save: () => void): Node[] {
  const o = (p.audio ??= {});
  const v = <K extends keyof AudioPanelOptions>(k: K) => (o[k] ?? AUDIO_DEFAULTS[k]) as NonNullable<AudioPanelOptions[K]>;
  const rows: Node[] = [];
  const row = (label: string, ...kids: Kid[]) => rows.push(h('label', { class: 'mrow' }, h('span', {}, label), ...kids));
  const pick = <K extends keyof AudioPanelOptions>(k: K, opts: [string, string][], parse: (s: string) => AudioPanelOptions[K]) =>
    select(String(v(k)), opts, (s) => { o[k] = parse(s); save(); });
  if (p.scope === 'audio-meter' || p.scope === 'audio-loudness') {
    row('Skala', pick('scale', [['ebu9', 'EBU +9 (−18 … +9 LU)'], ['ebu18', 'EBU +18 (−36 … +18 LU)']], (s) => s as 'ebu9'));
    row('Anzeige', pick('rel', [['false', 'absolut (LUFS)'], ['true', 'relativ (LU, 0 LU = −23 LUFS)']], (s) => s === 'true'));
    row('Zielwert', pick('target', Object.entries(TARGETS).map(([k, t]) => [k, t.hint]), (s) => s as 'r128'));
  }
  if (p.scope === 'audio-loudness') row('Zeitraum', pick('span', [['1', '1 min'], ['5', '5 min'], ['15', '15 min'], ['60', '60 min']], Number));
  if (p.scope === 'audio-spectrum') {
    row('FFT', pick('fft', [1024, 2048, 4096, 8192, 16384, 32768].map((n) => [String(n), String(n)]), Number));
    row('Kanal', pick('chan', [['lr', 'L und R'], ['mid', '(L+R)/2'], ['l', 'L'], ['r', 'R']], (s) => s as 'lr'));
    row('Darstellung', pick('bands', [['false', 'Linie'], ['true', 'Terzbänder']], (s) => s === 'true'));
    row('Neigung', pick('tilt', [['0', '0 dB/Okt.'], ['3', '3 dB/Okt.'], ['4.5', '4,5 dB/Okt.']], Number));
    row('Glättung', pick('smooth', [['0', 'aus'], ['0.5', 'leicht'], ['0.85', 'stark']], Number));
    row('Untergrenze', pick('floor', [['-80', '−80 dBFS'], ['-100', '−100 dBFS'], ['-120', '−120 dBFS']], Number));
  }
  if (p.scope === 'audio-phase') {
    row('Zoom', pick('zoom', [['0', 'auto'], ['1', '×1'], ['2', '×2'], ['4', '×4'], ['8', '×8']], Number));
    row('Korrelation', pick('corrMs', [['100', '100 ms'], ['300', '300 ms'], ['600', '600 ms'], ['1000', '1 s'], ['3000', '3 s']], Number));
    rows.push(h('p', { class: 'hint' }, 'Mono senkrecht, gegenphasig waagerecht, L links oben, R rechts oben. Die Zeitkonstante des Korrelationsgradmessers ist nicht genormt.'));
  }
  if (p.scope === 'audio-meter') rows.push(h('p', { class: 'hint' }, 'Balken: Sample-Peak über 100 ms, weiße Marke True Peak, feine Marke Peak-Hold 3 s. Pause/Reset von I und LRA an der Quelle (♪-Zeile).'));
  return rows;
}
