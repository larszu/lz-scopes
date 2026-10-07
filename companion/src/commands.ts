// Companion action options → LZ Scopes control command (docs/control-api.md). Pure.

export type Command = Record<string, unknown> & { cmd: string }
type Options = Record<string, unknown>

/** '' and undefined are "not set"; digits become numbers (1-based references). */
function ref(v: unknown): string | number | undefined {
  if (v === undefined || v === null) return undefined
  const s = String(v).trim()
  if (!s || s === '0' || s === 'all') return undefined
  return /^\d+$/.test(s) ? Number(s) : s
}
const text = (v: unknown) => {
  const s = String(v ?? '').trim()
  return s ? s : undefined
}
/** Setting value from a text field: true/false, a number, "lo, hi" for a range, else the text. */
export function settingValue(v: unknown): unknown {
  const s = String(v ?? '').trim()
  if (s === 'true' || s === 'false') return s === 'true'
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  const pair = /^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/.exec(s)
  if (pair) return [Number(pair[1]), Number(pair[2])]
  return s
}
/** Drop undefined fields so the bridge sees only what the user set. */
function clean(c: Command): Command {
  return Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)) as Command
}

export function buildCommand(actionId: string, o: Options): Command {
  switch (actionId) {
    case 'source_select': return clean({ cmd: 'source.select', source: ref(o.source), panel: ref(o.panel) })
    case 'layout_preset': return { cmd: 'layout.preset', preset: ref(o.preset) ?? 1 }
    case 'layout_load': return clean({ cmd: 'layout.load', name: text(o.name) })
    case 'panel_scope': return clean({ cmd: 'panel.scope', panel: ref(o.panel) ?? 1, scope: o.scope })
    case 'panel_maximize': return clean({ cmd: 'panel.maximize', panel: ref(o.panel), mode: o.mode ?? 'toggle' })
    case 'freeze': return { cmd: 'freeze', mode: o.mode ?? 'toggle' }
    case 'qc_clear': return { cmd: 'qc.clear' }
    case 'roi_clear': return clean({ cmd: 'roi.clear', source: ref(o.source) })
    case 'pattern_select': return clean({ cmd: 'pattern.select', pattern: text(o.pattern), source: ref(o.source) })
    case 'pattern_next': return clean({ cmd: 'pattern.next', source: ref(o.source) })
    case 'pattern_prev': return clean({ cmd: 'pattern.prev', source: ref(o.source) })
    case 'output_open': return clean({
      cmd: 'output.open', name: text(o.name), view: o.view ?? 'overlay', panel: ref(o.panel), source: ref(o.source),
      scene: ref(o.scene), bg: o.bg ?? 'picture', display: text(o.display), fullscreen: o.fullscreen !== false,
      stream: text(o.stream), target: text(o.target),
    })
    case 'output_close': return clean({ cmd: 'output.close', name: text(o.name) })
    case 'scene_select': return clean({ cmd: 'scene.select', scene: ref(o.scene), output: text(o.output) })
    case 'stream_start': return clean({ cmd: 'stream.start', output: text(o.output), stream: text(o.stream) ?? 'scopes', target: text(o.target) })
    case 'stream_stop': return clean({ cmd: 'stream.stop', output: text(o.output), stream: text(o.stream) })
    case 'transport': return clean({ cmd: 'transport', op: o.op ?? 'toggle', source: ref(o.source) })
    case 'audio_reset': return clean({ cmd: 'audio.reset', source: ref(o.source) })
    case 'audio_pause': return clean({ cmd: 'audio.pause', mode: o.mode ?? 'toggle', source: ref(o.source) })
    case 'generator': {
      const level = o.level === undefined || o.level === '' ? undefined : Number(o.level)
      const freq = o.freq === undefined || o.freq === '' || Number(o.freq) === 0 ? undefined : Number(o.freq)
      return clean({ cmd: 'generator', mode: o.mode ?? 'toggle', signal: text(o.signal), freq, level, force: level !== undefined && level > -6 ? o.force === true || undefined : undefined })
    }
    case 'setting': return clean({ cmd: 'setting', key: text(o.key), value: settingValue(o.value) })
  }
  throw new Error(`Unbekannte Aktion ${actionId}`)
}
