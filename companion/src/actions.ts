import type { CompanionActionDefinitions, SomeCompanionActionInputField } from '@companion-module/base'
import { buildCommand } from './commands.js'
import type { ModuleInstance } from './main.js'

// Companion is English-only: labels follow the English UI of LZ Scopes (src/i18n, docs/research/i18n.md).
export const SCOPES: { id: string; label: string }[] = [
  { id: 'picture', label: 'Picture' }, { id: 'wf-luma', label: 'Waveform Luma' }, { id: 'wf-color', label: 'Waveform Colour' },
  { id: 'wf-skin', label: 'Waveform Skin Tones' }, { id: 'wf-rgb', label: 'Waveform RGB' }, { id: 'parade', label: 'RGB Parade' },
  { id: 'yrgb', label: 'YRGB Parade' }, { id: 'ycbcr', label: 'YCbCr Parade' }, { id: 'vector', label: 'Vectorscope' }, { id: 'hls', label: 'HLS Vectorscope' },
  { id: 'cie', label: 'CIE 1931' }, { id: 'diamond', label: 'Diamond (Gamut)' }, { id: 'cube', label: '3D Colour Volume' },
  { id: 'satlum', label: 'Saturation over Luma' }, { id: 'chplot', label: 'Channel Plot' }, { id: 'minmax', label: 'Min/Max per Line' },
  { id: 'timeline', label: 'Timeline' }, { id: 'qclog', label: 'QC Log' },
  { id: 'hist', label: 'Histogram' }, { id: 'stats', label: 'Measurements' },
  { id: 'wf-green', label: 'Waveform Greens' }, { id: 'match', label: 'Colour Match' },
  { id: 'audio-meter', label: 'Audio Levels & Loudness' }, { id: 'audio-loudness', label: 'Audio Loudness History' },
  { id: 'audio-spectrum', label: 'Audio Spectrum' }, { id: 'audio-phase', label: 'Audio Goniometer' },
  { id: 'clock', label: 'Clock / Time Code' }, { id: 'genlock', label: 'Reference / Genlock' },
  { id: 'audio-check', label: 'Audio Ident & A/V Offset' },
  { id: 'light-cie', label: 'Light: Chromaticity (CIE)' }, { id: 'light-vector', label: 'Light: Vectorscope' },
  { id: 'light-bands', label: 'Light: Filter Channels' }, { id: 'light-trend', label: 'Light: Timeline' }, { id: 'light-map', label: 'Light: Measuring Field' }, { id: 'light-spectrum', label: 'Light: Wavelengths' }, { id: 'light-swatch', label: 'Light: Colour Swatch' },
]
const SIGNALS = [
  { id: '', label: 'unchanged' }, { id: 'sine', label: 'Sine' }, { id: 'ebu-ident', label: 'EBU Stereo Ident' }, { id: 'glits', label: 'GLITS' },
  { id: 'blits', label: 'BLITS (5.1)' }, { id: 'ebu-multi', label: 'EBU Multichannel Ident' }, { id: 'ident-lr', label: 'Channel Ident L/R' },
  { id: 'pink', label: 'Pink Noise' }, { id: 'pink-band', label: 'Pink Noise 500–2000 Hz' }, { id: 'white', label: 'White Noise' },
  { id: 'sweep', label: 'Log Sweep' }, { id: 'steps', label: 'Stepped Sweep' }, { id: 'polarity', label: 'Polarity Test' }, { id: 'avsync', label: 'A/V Sync Beep' },
]
/** Global settings of the control command "setting" (server/control.mjs SETTING_KEYS). */
const SETTINGS = [
  { id: 'theme', label: 'Skin' }, { id: 'scheme', label: 'Appearance (dark/light/system)' }, { id: 'sidebar', label: 'Sidebar' },
  { id: 'display', label: 'Display colour space' }, { id: 'hdrPreview', label: 'HDR preview' }, { id: 'unit', label: 'Scale' },
  { id: 'tint', label: 'Trace colour' }, { id: 'precision', label: 'Precision' }, { id: 'falseColour', label: 'False colour' },
  { id: 'skinLuma', label: 'Skin tone luma (lo, hi %)' }, { id: 'skinHue', label: 'Skin tone hue ±' }, { id: 'zebra', label: 'Zebra %' },
  { id: 'stage', label: 'Measuring point' }, { id: 'deRef', label: 'ΔE at the probe' }, { id: 'lowLatency', label: 'Low Latency (0/1)' },
]
const MODES = [{ id: 'toggle', label: 'Toggle' }, { id: 'on', label: 'On' }, { id: 'off', label: 'Off' }]
const VIEWS = [
  { id: 'overlay', label: 'Picture + Scope Overlay (Scene)' }, { id: 'grid', label: 'Full View (Layout)' },
  { id: 'panel', label: 'Single Panel' }, { id: 'clean', label: 'Clean Source Picture' },
]
const OPS = [
  { id: 'toggle', label: 'Play/Stop' }, { id: 'play', label: 'Play' }, { id: 'pause', label: 'Pause' }, { id: 'stop', label: 'Stop (back to start)' },
  { id: 'next', label: 'Frame +1' }, { id: 'prev', label: 'Frame −1' }, { id: 'forward', label: 'Forward (L)' }, { id: 'rewind', label: 'Reverse (J)' },
  { id: 'start', label: 'Start' }, { id: 'end', label: 'End' },
]

export function sourceOption(self: ModuleInstance, all = false): SomeCompanionActionInputField {
  return {
    type: 'dropdown', id: 'source', label: 'Source (number, name or id)', allowCustom: true,
    default: all ? '' : '1',
    choices: [
      ...(all ? [{ id: '', label: 'all / automatic' }] : []),
      ...self.state.sources.map((s) => ({ id: String(s.index), label: `${s.index} ${s.name}` })),
    ],
  }
}
const panelOption = (label = 'Panel (1 …; 0 = all)', def = 0): SomeCompanionActionInputField =>
  ({ type: 'number', id: 'panel', label, default: def, min: 0, max: 99 })
const text = (id: string, label: string, def = '', tooltip?: string): SomeCompanionActionInputField =>
  ({ type: 'textinput', id, label, default: def, ...(tooltip ? { tooltip } : {}) })

export function updateActions(self: ModuleInstance): void {
  const s = self.state
  const run = (actionId: string) => async (e: { options: Record<string, unknown> }) => { await self.run(buildCommand(actionId, e.options)) }
  const sceneChoices = s.scenes.map((x, i) => ({ id: x.name, label: `${i + 1} ${x.name}` }))
  const defs: CompanionActionDefinitions = {
    source_select: { name: 'Select source', options: [sourceOption(self), panelOption()], callback: run('source_select') },
    layout_preset: {
      name: 'Layout preset',
      options: [{
        type: 'dropdown', id: 'preset', label: 'Preset', default: '1',
        choices: s.presets.length ? s.presets.map((p) => ({ id: String(p.index), label: `${p.index} ${p.label}` }))
          : ['1', '1+1', '2×2', 'Colorist', '3×2', '3×3'].map((l, i) => ({ id: String(i + 1), label: `${i + 1} ${l}` })),
      }],
      callback: run('layout_preset'),
    },
    layout_load: {
      name: 'Load layout configuration',
      options: [{ type: 'dropdown', id: 'name', label: 'Configuration', allowCustom: true, default: s.layouts[0] ?? '', choices: s.layouts.map((n) => ({ id: n, label: n })) }],
      callback: run('layout_load'),
    },
    panel_scope: {
      name: 'Scope of a panel',
      options: [panelOption('Panel', 1), { type: 'dropdown', id: 'scope', label: 'Scope', default: 'wf-luma', choices: SCOPES }],
      callback: run('panel_scope'),
    },
    panel_maximize: {
      name: 'Maximise panel',
      options: [panelOption('Panel (0 = back)', 1), { type: 'dropdown', id: 'mode', label: 'Mode', default: 'toggle', choices: MODES }],
      callback: async (e) => {
        const o = { ...e.options }
        if (Number(o.panel) === 0) o.mode = 'off'
        await self.run(buildCommand('panel_maximize', o))
      },
    },
    qc_clear: { name: 'Clear QC log', options: [], callback: run('qc_clear') },
    freeze: { name: 'Freeze', options: [{ type: 'dropdown', id: 'mode', label: 'Mode', default: 'toggle', choices: MODES }], callback: run('freeze') },
    roi_clear: { name: 'Clear measuring frame and point', options: [sourceOption(self, true)], callback: run('roi_clear') },
    pattern_select: {
      name: 'Select test pattern',
      options: [
        {
          type: 'dropdown', id: 'pattern', label: 'Test pattern (id or name)', allowCustom: true, default: 'smpte75',
          choices: (s.patterns ?? []).length ? (s.patterns ?? []).map((p) => ({ id: p.id, label: p.name })) : [{ id: 'smpte75', label: 'SMPTE 75 %' }],
        },
        sourceOption(self, true),
      ],
      callback: run('pattern_select'),
    },
    pattern_next: { name: 'Next test pattern', options: [sourceOption(self, true)], callback: run('pattern_next') },
    pattern_prev: { name: 'Previous test pattern', options: [sourceOption(self, true)], callback: run('pattern_prev') },
    output_open: {
      name: 'Open output',
      options: [
        text('name', 'Output name', 'out1', 'Letters, digits, _ and -; the same name replaces the window'),
        { type: 'dropdown', id: 'view', label: 'Content', default: 'overlay', choices: VIEWS },
        { type: 'dropdown', id: 'scene', label: 'Overlay scene', allowCustom: true, default: '', choices: [{ id: '', label: 'current scene' }, ...sceneChoices] },
        { type: 'dropdown', id: 'bg', label: 'Overlay background', default: 'picture', choices: [{ id: 'picture', label: 'Picture' }, { id: 'black', label: 'Black (luma key)' }] },
        sourceOption(self, true),
        panelOption('Panel (for Single Panel)', 1),
        text('display', 'Display id (empty = new window)'),
        { type: 'checkbox', id: 'fullscreen', label: 'Full screen', default: true },
        text('stream', 'Stream name (optional)', '', '→ http://<bridge>/out/<name>.mjpeg'),
        text('target', 'Push to (optional)', '', 'rtmp:// srt:// rtsp:// udp://'),
      ],
      callback: run('output_open'),
    },
    output_close: { name: 'Close output', options: [text('name', 'Name (empty = all)')], callback: run('output_close') },
    scene_select: {
      name: 'Select overlay scene',
      options: [
        { type: 'dropdown', id: 'scene', label: 'Scene', allowCustom: true, default: sceneChoices[0]?.id ?? '1', choices: sceneChoices },
        text('output', 'Output (empty = all overlay outputs)'),
      ],
      callback: run('scene_select'),
    },
    stream_start: {
      name: 'Start stream',
      options: [text('stream', 'Stream name', 'scopes'), text('output', 'Output (empty = first open one, else a new overlay)'), text('target', 'Push to (optional)', '', 'rtmp:// srt:// rtsp:// udp://')],
      callback: run('stream_start'),
    },
    stream_stop: { name: 'Stop stream', options: [text('stream', 'Stream name (empty = all)'), text('output', 'Output (optional)')], callback: run('stream_stop') },
    audio_reset: { name: 'Reset loudness (I, LRA, max, log)', options: [sourceOption(self, true)], callback: run('audio_reset') },
    audio_pause: { name: 'Pause/resume I/LRA', options: [{ type: 'dropdown', id: 'mode', label: 'Mode', default: 'toggle', choices: MODES }, sourceOption(self, true)], callback: run('audio_pause') },
    generator: {
      name: 'Tone generator',
      options: [
        { type: 'dropdown', id: 'mode', label: 'Mode', default: 'toggle', choices: MODES },
        { type: 'dropdown', id: 'signal', label: 'Signal', default: '', choices: SIGNALS },
        { type: 'number', id: 'freq', label: 'Frequency Hz (0 = unchanged)', default: 0, min: 0, max: 20000 },
        text('level', 'Level dBFS (empty = unchanged)', '', 'e.g. -18 (EBU R 68)'),
        { type: 'checkbox', id: 'force', label: 'Allow levels above −6 dBFS (loud!)', default: false },
      ],
      callback: run('generator'),
    },
    setting: {
      name: 'Set a setting',
      options: [
        { type: 'dropdown', id: 'key', label: 'Setting', default: 'unit', allowCustom: true, choices: SETTINGS },
        text('value', 'Value', '', 'a choice (e.g. bit10, lzm, light), a number, true/false, or "lo, hi" for skin tone luma'),
      ],
      callback: run('setting'),
    },
    transport: { name: 'Transport (video file)', options: [{ type: 'dropdown', id: 'op', label: 'Action', default: 'toggle', choices: OPS }, sourceOption(self, true)], callback: run('transport') },
  }
  self.setActionDefinitions(defs)
}
