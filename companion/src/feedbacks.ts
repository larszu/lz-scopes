import { combineRgb, type CompanionFeedbackDefinitions } from '@companion-module/base'
import type { ModuleInstance } from './main.js'
import { checks } from './state.js'

const RED = combineRgb(204, 0, 0), GREEN = combineRgb(0, 140, 60), AMBER = combineRgb(230, 150, 0), BLUE = combineRgb(0, 90, 180)
const WHITE = combineRgb(255, 255, 255), BLACK = combineRgb(0, 0, 0)

export function updateFeedbacks(self: ModuleInstance): void {
  const s = () => self.state
  const opts = (o: unknown) => o as Record<string, unknown>
  const num = (id: string, label: string, def: number, min: number, max: number) =>
    ({ type: 'number' as const, id, label, default: def, min, max, step: 0.1 })
  const defs: CompanionFeedbackDefinitions = {
    connected: {
      type: 'boolean', name: 'Connected to LZ Scopes', defaultStyle: { bgcolor: BLUE, color: WHITE }, options: [],
      callback: () => checks.connected(s(), self.appConnected),
    },
    qc_active: { type: 'boolean', name: 'QC event active', defaultStyle: { bgcolor: RED, color: WHITE }, options: [], callback: () => checks.qc_active(s()) },
    frozen: { type: 'boolean', name: 'Frozen', defaultStyle: { bgcolor: AMBER, color: BLACK }, options: [], callback: () => checks.frozen(s()) },
    source_active: {
      type: 'boolean', name: 'Source active', defaultStyle: { bgcolor: RED, color: WHITE },
      options: [{ type: 'textinput', id: 'source', label: 'Source (number, name or id)', default: '1' }],
      callback: (fb) => checks.source_active(s(), opts(fb.options)),
    },
    clip_above: {
      type: 'boolean', name: 'Clipping above threshold', defaultStyle: { bgcolor: RED, color: WHITE },
      options: [num('threshold', 'Threshold %', 0.5, 0, 100)], callback: (fb) => checks.clip_above(s(), opts(fb.options)),
    },
    ymax_above: {
      type: 'boolean', name: "Y′ max above threshold", defaultStyle: { bgcolor: RED, color: WHITE },
      options: [num('threshold', 'Threshold %', 100, -10, 110)], callback: (fb) => checks.ymax_above(s(), opts(fb.options)),
    },
    ymin_below: {
      type: 'boolean', name: "Y′ min below threshold", defaultStyle: { bgcolor: BLUE, color: WHITE },
      options: [num('threshold', 'Threshold %', 0, -10, 110)], callback: (fb) => checks.ymin_below(s(), opts(fb.options)),
    },
    layout_active: {
      type: 'boolean', name: 'Layout active', defaultStyle: { bgcolor: GREEN, color: WHITE },
      options: [{ type: 'textinput', id: 'layout', label: 'Configuration or preset name (e.g. lc, 2×2)', default: '' }],
      callback: (fb) => checks.layout_active(s(), opts(fb.options)),
    },
    scene_active: {
      type: 'boolean', name: 'Overlay scene active', defaultStyle: { bgcolor: GREEN, color: WHITE },
      options: [{ type: 'textinput', id: 'scene', label: 'Scene (name or id)', default: '' }],
      callback: (fb) => checks.scene_active(s(), opts(fb.options)),
    },
    output_open: {
      type: 'boolean', name: 'Output open', defaultStyle: { bgcolor: GREEN, color: WHITE },
      options: [{ type: 'textinput', id: 'output', label: 'Output name', default: 'out1' }],
      callback: (fb) => checks.output_open(s(), opts(fb.options)),
    },
    streaming: {
      type: 'boolean', name: 'Stream running', defaultStyle: { bgcolor: RED, color: WHITE },
      options: [{ type: 'textinput', id: 'stream', label: 'Stream name (empty = any)', default: '' }],
      callback: (fb) => checks.streaming(s(), opts(fb.options)),
    },
    maximized: {
      type: 'boolean', name: 'Panel maximised', defaultStyle: { bgcolor: GREEN, color: WHITE },
      options: [{ type: 'number', id: 'panel', label: 'Panel', default: 1, min: 1, max: 99 }],
      callback: (fb) => checks.maximized(s(), opts(fb.options)),
    },
    playing: { type: 'boolean', name: 'Video file playing', defaultStyle: { bgcolor: GREEN, color: WHITE }, options: [], callback: () => checks.playing(s()) },
    generator_running: { type: 'boolean', name: 'Tone generator running', defaultStyle: { bgcolor: RED, color: WHITE }, options: [], callback: () => checks.generator_running(s()) },
    loudness_paused: { type: 'boolean', name: 'I/LRA paused', defaultStyle: { bgcolor: AMBER, color: BLACK }, options: [], callback: () => checks.loudness_paused(s()) },
    true_peak_above: {
      type: 'boolean', name: 'Max true peak above threshold', defaultStyle: { bgcolor: RED, color: WHITE },
      options: [num('threshold', 'Threshold dBTP', -1, -60, 6)], callback: (fb) => checks.true_peak_above(s(), opts(fb.options)),
    },
    ident_problem: { type: 'boolean', name: 'Ident finding (swapped, missing, polarity)', defaultStyle: { bgcolor: RED, color: WHITE }, options: [], callback: () => checks.ident_problem(s()) },
  }
  self.setFeedbackDefinitions(defs)
}

export const FEEDBACK_IDS = ['connected', 'qc_active', 'frozen', 'source_active', 'clip_above', 'ymax_above', 'ymin_below', 'layout_active', 'scene_active', 'output_open', 'streaming', 'maximized', 'playing', 'generator_running', 'loudness_paused', 'true_peak_above', 'ident_problem']
