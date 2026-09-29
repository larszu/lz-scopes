import type { CompanionActionDefinitions, SomeCompanionActionInputField } from '@companion-module/base'
import { buildCommand } from './commands.js'
import type { ModuleInstance } from './main.js'

export const SCOPES: { id: string; label: string }[] = [
  { id: 'picture', label: 'Bild' }, { id: 'wf-luma', label: 'Waveform Luma' }, { id: 'wf-color', label: 'Waveform Farbe' },
  { id: 'wf-skin', label: 'Waveform Hauttöne' }, { id: 'wf-rgb', label: 'Waveform RGB' }, { id: 'parade', label: 'RGB-Parade' },
  { id: 'yrgb', label: 'YRGB-Parade' }, { id: 'ycbcr', label: 'YCbCr-Parade' }, { id: 'vector', label: 'Vectorscope' },
  { id: 'cie', label: 'CIE 1931' }, { id: 'hist', label: 'Histogramm' }, { id: 'stats', label: 'Messwerte' },
  { id: 'audio-meter', label: 'Audio Pegel & Lautheit' }, { id: 'audio-loudness', label: 'Audio Lautheitsverlauf' },
  { id: 'audio-spectrum', label: 'Audio Spektrum' }, { id: 'audio-phase', label: 'Audio Goniometer' },
]
const MODES = [{ id: 'toggle', label: 'Umschalten' }, { id: 'on', label: 'An' }, { id: 'off', label: 'Aus' }]
const VIEWS = [
  { id: 'overlay', label: 'Bild + Scope-Overlay (Szene)' }, { id: 'grid', label: 'Gesamtansicht (Layout)' },
  { id: 'panel', label: 'Einzelnes Panel' }, { id: 'clean', label: 'Quellbild sauber' },
]
const OPS = [
  { id: 'toggle', label: 'Start/Stopp' }, { id: 'play', label: 'Start' }, { id: 'pause', label: 'Pause' }, { id: 'stop', label: 'Stopp (an den Anfang)' },
  { id: 'next', label: 'Frame +1' }, { id: 'prev', label: 'Frame −1' }, { id: 'forward', label: 'Vorwärts (L)' }, { id: 'rewind', label: 'Rückwärts (J)' },
  { id: 'start', label: 'Anfang' }, { id: 'end', label: 'Ende' },
]

export function sourceOption(self: ModuleInstance, all = false): SomeCompanionActionInputField {
  return {
    type: 'dropdown', id: 'source', label: 'Quelle (Nummer, Name oder id)', allowCustom: true,
    default: all ? '' : '1',
    choices: [
      ...(all ? [{ id: '', label: 'alle / automatisch' }] : []),
      ...self.state.sources.map((s) => ({ id: String(s.index), label: `${s.index} ${s.name}` })),
    ],
  }
}
const panelOption = (label = 'Panel (1 …; 0 = alle)', def = 0): SomeCompanionActionInputField =>
  ({ type: 'number', id: 'panel', label, default: def, min: 0, max: 99 })
const text = (id: string, label: string, def = '', tooltip?: string): SomeCompanionActionInputField =>
  ({ type: 'textinput', id, label, default: def, ...(tooltip ? { tooltip } : {}) })

export function updateActions(self: ModuleInstance): void {
  const s = self.state
  const run = (actionId: string) => async (e: { options: Record<string, unknown> }) => { await self.run(buildCommand(actionId, e.options)) }
  const sceneChoices = s.scenes.map((x, i) => ({ id: x.name, label: `${i + 1} ${x.name}` }))
  const defs: CompanionActionDefinitions = {
    source_select: { name: 'Quelle wählen', options: [sourceOption(self), panelOption()], callback: run('source_select') },
    layout_preset: {
      name: 'Layout-Vorlage',
      options: [{
        type: 'dropdown', id: 'preset', label: 'Vorlage', default: '1',
        choices: s.presets.length ? s.presets.map((p) => ({ id: String(p.index), label: `${p.index} ${p.label}` }))
          : ['1', '1+1', '2×2', 'Colorist', '3×2', '3×3'].map((l, i) => ({ id: String(i + 1), label: `${i + 1} ${l}` })),
      }],
      callback: run('layout_preset'),
    },
    layout_load: {
      name: 'Layout-Konfiguration laden',
      options: [{ type: 'dropdown', id: 'name', label: 'Konfiguration', allowCustom: true, default: s.layouts[0] ?? '', choices: s.layouts.map((n) => ({ id: n, label: n })) }],
      callback: run('layout_load'),
    },
    panel_scope: {
      name: 'Scope eines Panels',
      options: [panelOption('Panel', 1), { type: 'dropdown', id: 'scope', label: 'Scope', default: 'wf-luma', choices: SCOPES }],
      callback: run('panel_scope'),
    },
    panel_maximize: {
      name: 'Panel maximieren',
      options: [panelOption('Panel (0 = zurück)', 1), { type: 'dropdown', id: 'mode', label: 'Modus', default: 'toggle', choices: MODES }],
      callback: async (e) => {
        const o = { ...e.options }
        if (Number(o.panel) === 0) o.mode = 'off'
        await self.run(buildCommand('panel_maximize', o))
      },
    },
    freeze: { name: 'Einfrieren', options: [{ type: 'dropdown', id: 'mode', label: 'Modus', default: 'toggle', choices: MODES }], callback: run('freeze') },
    roi_clear: { name: 'Messrahmen und Messpunkt löschen', options: [sourceOption(self, true)], callback: run('roi_clear') },
    pattern_select: {
      name: 'Testbild wählen',
      options: [
        {
          type: 'dropdown', id: 'pattern', label: 'Testbild (id oder Name)', allowCustom: true, default: 'smpte75',
          choices: (s.patterns ?? []).length ? (s.patterns ?? []).map((p) => ({ id: p.id, label: p.name })) : [{ id: 'smpte75', label: 'SMPTE 75 %' }],
        },
        sourceOption(self, true),
      ],
      callback: run('pattern_select'),
    },
    pattern_next: { name: 'Testbild weiter', options: [sourceOption(self, true)], callback: run('pattern_next') },
    pattern_prev: { name: 'Testbild zurück', options: [sourceOption(self, true)], callback: run('pattern_prev') },
    output_open: {
      name: 'Ausgabe öffnen',
      options: [
        text('name', 'Name der Ausgabe', 'out1', 'Buchstaben, Ziffern, _ und -; gleicher Name ersetzt das Fenster'),
        { type: 'dropdown', id: 'view', label: 'Inhalt', default: 'overlay', choices: VIEWS },
        { type: 'dropdown', id: 'scene', label: 'Overlay-Szene', allowCustom: true, default: '', choices: [{ id: '', label: 'aktuelle Szene' }, ...sceneChoices] },
        { type: 'dropdown', id: 'bg', label: 'Overlay-Hintergrund', default: 'picture', choices: [{ id: 'picture', label: 'Bild' }, { id: 'black', label: 'Schwarz (Luma-Key)' }] },
        sourceOption(self, true),
        panelOption('Panel (bei Einzelnes Panel)', 1),
        text('display', 'Bildschirm-id (leer = neues Fenster)'),
        { type: 'checkbox', id: 'fullscreen', label: 'Vollbild', default: true },
        text('stream', 'Stream-Name (optional)', '', '→ http://<bridge>/out/<name>.mjpeg'),
        text('target', 'Push an (optional)', '', 'rtmp:// srt:// rtsp:// udp://'),
      ],
      callback: run('output_open'),
    },
    output_close: { name: 'Ausgabe schließen', options: [text('name', 'Name (leer = alle)')], callback: run('output_close') },
    scene_select: {
      name: 'Overlay-Szene wählen',
      options: [
        { type: 'dropdown', id: 'scene', label: 'Szene', allowCustom: true, default: sceneChoices[0]?.id ?? '1', choices: sceneChoices },
        text('output', 'Ausgabe (leer = alle Overlay-Ausgaben)'),
      ],
      callback: run('scene_select'),
    },
    stream_start: {
      name: 'Stream starten',
      options: [text('stream', 'Stream-Name', 'scopes'), text('output', 'Ausgabe (leer = erste offene, sonst neues Overlay)'), text('target', 'Push an (optional)', '', 'rtmp:// srt:// rtsp:// udp://')],
      callback: run('stream_start'),
    },
    stream_stop: { name: 'Stream stoppen', options: [text('stream', 'Stream-Name (leer = alle)'), text('output', 'Ausgabe (optional)')], callback: run('stream_stop') },
    transport: { name: 'Transport (Videodatei)', options: [{ type: 'dropdown', id: 'op', label: 'Aktion', default: 'toggle', choices: OPS }, sourceOption(self, true)], callback: run('transport') },
  }
  self.setActionDefinitions(defs)
}
