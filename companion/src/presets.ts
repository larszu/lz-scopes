import { combineRgb, type CompanionButtonPresetDefinition, type CompanionOptionValues, type CompanionPresetDefinitions } from '@companion-module/base'
import type { ModuleInstance } from './main.js'

const WHITE = combineRgb(255, 255, 255), DARK = combineRgb(24, 27, 31), RED = combineRgb(204, 0, 0)
const AMBER = combineRgb(230, 150, 0), GREEN = combineRgb(0, 140, 60), BLACK = combineRgb(0, 0, 0)

function button(category: string, name: string, text: string, actionId: string, options: CompanionOptionValues = {},
  feedbacks: CompanionButtonPresetDefinition['feedbacks'] = [], size: '7' | '14' | '18' | 'auto' = 'auto'): CompanionButtonPresetDefinition {
  return {
    type: 'button', category, name,
    style: { text, size, color: WHITE, bgcolor: DARK },
    feedbacks,
    steps: [{ down: [{ actionId, options }], up: [] }],
  }
}

export function updatePresets(self: ModuleInstance): void {
  const s = self.state
  const p: CompanionPresetDefinitions = {}
  const sources = s.sources.length ? s.sources.slice(0, 8) : [1, 2, 3, 4].map((i) => ({ index: i, name: `Source ${i}` }))
  for (const src of sources) {
    p[`source_${src.index}`] = button('Sources', `Source ${src.index}`, `${src.index}\\n${src.name}`, 'source_select', { source: String(src.index), panel: 0 },
      [{ feedbackId: 'source_active', options: { source: String(src.index) }, style: { bgcolor: RED, color: WHITE } }])
  }
  const presets = s.presets.length ? s.presets : ['1', '1+1', '2×2', 'Colorist', '3×2', '3×3'].map((label, i) => ({ index: i + 1, key: '', label }))
  for (const l of presets) {
    p[`preset_${l.index}`] = button('Layout', `Preset ${l.label}`, `Layout\\n${l.label}`, 'layout_preset', { preset: String(l.index) },
      [{ feedbackId: 'layout_active', options: { layout: l.key || l.label }, style: { bgcolor: GREEN, color: WHITE } }])
  }
  for (const n of s.layouts.slice(0, 12)) {
    p[`layout_${n}`] = button('Layout', `Configuration ${n}`, n, 'layout_load', { name: n },
      [{ feedbackId: 'layout_active', options: { layout: n }, style: { bgcolor: GREEN, color: WHITE } }])
  }
  p.freeze = button('Measure', 'Freeze', 'FREEZE', 'freeze', { mode: 'toggle' },
    [{ feedbackId: 'frozen', options: {}, style: { bgcolor: AMBER, color: BLACK } }])
  p.roi_clear = button('Measure', 'Clear measuring frame', 'ROI\\nclear', 'roi_clear', { source: '' })
  p.clip = button('Measure', 'Clipping display', 'Clip\\n$(lz-scopes:clip) %', 'freeze', { mode: 'toggle' },
    [{ feedbackId: 'clip_above', options: { threshold: 0.5 }, style: { bgcolor: RED, color: WHITE } }], '14')
  p.clip.steps = [{ down: [], up: [] }]
  p.levels = button('Measure', "Y′ min/max", "Y′ $(lz-scopes:ymin)\\n– $(lz-scopes:ymax)", 'freeze', {},
    [{ feedbackId: 'ymax_above', options: { threshold: 100 }, style: { bgcolor: RED, color: WHITE } }], '14')
  p.levels.steps = [{ down: [], up: [] }]
  for (let i = 1; i <= 4; i++) {
    p[`max_${i}`] = button('Panels', `Maximise panel ${i}`, `Panel ${i}\\n⤢`, 'panel_maximize', { panel: i, mode: 'toggle' },
      [{ feedbackId: 'maximized', options: { panel: i }, style: { bgcolor: GREEN, color: WHITE } }])
  }
  p.pattern_prev = button('Test pattern', 'Previous test pattern', '◀\\nPattern', 'pattern_prev', { source: '' })
  p.pattern_next = button('Test pattern', 'Next test pattern', 'Pattern\\n▶', 'pattern_next', { source: '' })
  p.pattern_name = button('Test pattern', 'Test pattern name', '$(lz-scopes:pattern)', 'pattern_next', { source: '' }, [], '7')
  s.scenes.slice(0, 8).forEach((sc, i) => {
    p[`scene_${i + 1}`] = button('Overlay', `Scene ${sc.name}`, `Scene\\n${sc.name}`, 'scene_select', { scene: sc.name, output: '' },
      [{ feedbackId: 'scene_active', options: { scene: sc.name }, style: { bgcolor: GREEN, color: WHITE } }])
  })
  p.overlay_open = button('Output', 'Open overlay', 'Overlay\\nopen', 'output_open', { name: 'overlay', view: 'overlay', scene: '', bg: 'picture', source: '', panel: 1, display: '', fullscreen: false, stream: '', target: '' },
    [{ feedbackId: 'output_open', options: { output: 'overlay' }, style: { bgcolor: GREEN, color: WHITE } }])
  p.key_open = button('Output', 'Open overlay on black (luma key)', 'Key\\nopen', 'output_open', { name: 'key', view: 'overlay', scene: '', bg: 'black', source: '', panel: 1, display: '', fullscreen: false, stream: '', target: '' },
    [{ feedbackId: 'output_open', options: { output: 'key' }, style: { bgcolor: GREEN, color: WHITE } }])
  p.outputs_close = button('Output', 'Close all outputs', 'Outputs\\nclose', 'output_close', { name: '' })
  p.stream_start = button('Output', 'Start stream', 'Stream\\nstart', 'stream_start', { stream: 'scopes', output: '', target: '' },
    [{ feedbackId: 'streaming', options: { stream: 'scopes' }, style: { bgcolor: RED, color: WHITE } }])
  p.stream_stop = button('Output', 'Stop stream', 'Stream\\nstop', 'stream_stop', { stream: '', output: '' })
  const tp: [string, string, string][] = [['rewind', 'Reverse', '◀◀'], ['prev', 'Frame −1', '◀|'], ['toggle', 'Play/Stop', '▶/❚❚'], ['next', 'Frame +1', '|▶'], ['forward', 'Forward', '▶▶']]
  for (const [op, name, text] of tp) {
    p[`transport_${op}`] = button('Transport', name, text, 'transport', { op, source: '' },
      op === 'toggle' ? [{ feedbackId: 'playing', options: {}, style: { bgcolor: GREEN, color: WHITE } }] : [], '18')
  }
  self.setPresetDefinitions(p)
}
