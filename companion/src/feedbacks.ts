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
      type: 'boolean', name: 'Mit LZ Scopes verbunden', defaultStyle: { bgcolor: BLUE, color: WHITE }, options: [],
      callback: () => checks.connected(s(), self.appConnected),
    },
    frozen: { type: 'boolean', name: 'Eingefroren', defaultStyle: { bgcolor: AMBER, color: BLACK }, options: [], callback: () => checks.frozen(s()) },
    source_active: {
      type: 'boolean', name: 'Quelle aktiv', defaultStyle: { bgcolor: RED, color: WHITE },
      options: [{ type: 'textinput', id: 'source', label: 'Quelle (Nummer, Name oder id)', default: '1' }],
      callback: (fb) => checks.source_active(s(), opts(fb.options)),
    },
    clip_above: {
      type: 'boolean', name: 'Clipping über Schwelle', defaultStyle: { bgcolor: RED, color: WHITE },
      options: [num('threshold', 'Schwelle %', 0.5, 0, 100)], callback: (fb) => checks.clip_above(s(), opts(fb.options)),
    },
    ymax_above: {
      type: 'boolean', name: "Y′ max über Schwelle", defaultStyle: { bgcolor: RED, color: WHITE },
      options: [num('threshold', 'Schwelle %', 100, -10, 110)], callback: (fb) => checks.ymax_above(s(), opts(fb.options)),
    },
    ymin_below: {
      type: 'boolean', name: "Y′ min unter Schwelle", defaultStyle: { bgcolor: BLUE, color: WHITE },
      options: [num('threshold', 'Schwelle %', 0, -10, 110)], callback: (fb) => checks.ymin_below(s(), opts(fb.options)),
    },
    layout_active: {
      type: 'boolean', name: 'Layout aktiv', defaultStyle: { bgcolor: GREEN, color: WHITE },
      options: [{ type: 'textinput', id: 'layout', label: 'Name der Konfiguration oder Vorlage (z. B. lc, 2×2)', default: '' }],
      callback: (fb) => checks.layout_active(s(), opts(fb.options)),
    },
    scene_active: {
      type: 'boolean', name: 'Overlay-Szene aktiv', defaultStyle: { bgcolor: GREEN, color: WHITE },
      options: [{ type: 'textinput', id: 'scene', label: 'Szene (Name oder id)', default: '' }],
      callback: (fb) => checks.scene_active(s(), opts(fb.options)),
    },
    output_open: {
      type: 'boolean', name: 'Ausgabe offen', defaultStyle: { bgcolor: GREEN, color: WHITE },
      options: [{ type: 'textinput', id: 'output', label: 'Name der Ausgabe', default: 'out1' }],
      callback: (fb) => checks.output_open(s(), opts(fb.options)),
    },
    streaming: {
      type: 'boolean', name: 'Stream läuft', defaultStyle: { bgcolor: RED, color: WHITE },
      options: [{ type: 'textinput', id: 'stream', label: 'Stream-Name (leer = irgendeiner)', default: '' }],
      callback: (fb) => checks.streaming(s(), opts(fb.options)),
    },
    maximized: {
      type: 'boolean', name: 'Panel maximiert', defaultStyle: { bgcolor: GREEN, color: WHITE },
      options: [{ type: 'number', id: 'panel', label: 'Panel', default: 1, min: 1, max: 99 }],
      callback: (fb) => checks.maximized(s(), opts(fb.options)),
    },
    playing: { type: 'boolean', name: 'Videodatei läuft', defaultStyle: { bgcolor: GREEN, color: WHITE }, options: [], callback: () => checks.playing(s()) },
  }
  self.setFeedbackDefinitions(defs)
}

export const FEEDBACK_IDS = ['connected', 'frozen', 'source_active', 'clip_above', 'ymax_above', 'ymin_below', 'layout_active', 'scene_active', 'output_open', 'streaming', 'maximized', 'playing']
