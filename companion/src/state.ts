// State reported by LZ Scopes (GET /api/control, WebSocket {type:'state'}) and what
// the module derives from it. Pure – no Companion, no network – so it is testable.

export interface ScopesState {
  source: { index: number; id: string; name: string; status: string } | null
  sources: { index: number; id: string; name: string; kind: string; status: string }[]
  frozen: boolean
  /** percent, rounded to 0.1; null without statistics */
  clip: number | null
  clipHigh: number | null
  clipLow: number | null
  yMin: number | null
  yMax: number | null
  layoutName: string
  preset: string
  layouts: string[]
  presets: { index: number; key: string; label: string }[]
  panels: { panel: number; scope: string; source: string }[]
  maximized: number | null
  scene: { id: string; name: string } | null
  scenes: { id: string; name: string; elements: number }[]
  outputs: { name: string; view: string; scene: string; stream: string }[]
  pattern: { id: string; name: string } | null
  patterns?: { id: string; name: string }[]
  playing: boolean | null
}

export const EMPTY_STATE: ScopesState = {
  source: null, sources: [], frozen: false, clip: null, clipHigh: null, clipLow: null, yMin: null, yMax: null,
  layoutName: '', preset: '', layouts: [], presets: [], panels: [], maximized: null, scene: null, scenes: [],
  outputs: [], pattern: null, patterns: [], playing: null,
}

/** Merge a (possibly partial or malformed) state from the bridge onto the defaults. */
export function normalizeState(raw: unknown): ScopesState {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STATE }
  const r = raw as Partial<ScopesState>
  const arr = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : [])
  const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return {
    ...EMPTY_STATE, ...r,
    sources: arr(r.sources), layouts: arr(r.layouts), presets: arr(r.presets), panels: arr(r.panels),
    scenes: arr(r.scenes), outputs: arr(r.outputs), patterns: arr(r.patterns),
    frozen: r.frozen === true,
    clip: numOrNull(r.clip), clipHigh: numOrNull(r.clipHigh), clipLow: numOrNull(r.clipLow),
    yMin: numOrNull(r.yMin), yMax: numOrNull(r.yMax),
  }
}

const pct = (v: number | null) => (v === null ? '' : v.toFixed(1))

/** Companion variable values; empty strings for "unknown", never invented zeros. */
export function variableValues(s: ScopesState, connected: boolean): Record<string, string> {
  return {
    connected: connected ? 'true' : 'false',
    source: s.source?.name ?? '',
    source_index: s.source ? String(s.source.index) : '',
    frozen: s.frozen ? 'true' : 'false',
    clip: pct(s.clip),
    clip_high: pct(s.clipHigh),
    clip_low: pct(s.clipLow),
    ymin: pct(s.yMin),
    ymax: pct(s.yMax),
    layout: s.layoutName,
    scene: s.scene?.name ?? '',
    outputs: s.outputs.map((o) => o.name).join(', '),
    streams: s.outputs.filter((o) => o.stream).map((o) => o.stream).join(', '),
    pattern: s.pattern?.name ?? '',
    maximized: s.maximized === null ? '' : String(s.maximized),
    playing: s.playing === null ? '' : s.playing ? 'true' : 'false',
  }
}

export const VARIABLES: { variableId: string; name: string }[] = [
  { variableId: 'connected', name: 'Mit LZ Scopes verbunden' },
  { variableId: 'source', name: 'Aktive Quelle' },
  { variableId: 'source_index', name: 'Nummer der aktiven Quelle' },
  { variableId: 'frozen', name: 'Eingefroren' },
  { variableId: 'clip', name: 'Clipping-Anteil % (max. Kanal, oben oder unten)' },
  { variableId: 'clip_high', name: 'Clipping oben %' },
  { variableId: 'clip_low', name: 'Clipping unten %' },
  { variableId: 'ymin', name: "Y' min %" },
  { variableId: 'ymax', name: "Y' max %" },
  { variableId: 'layout', name: 'Layout-Name' },
  { variableId: 'scene', name: 'Overlay-Szene' },
  { variableId: 'outputs', name: 'Offene Ausgaben' },
  { variableId: 'streams', name: 'Laufende Streams' },
  { variableId: 'pattern', name: 'Testbild' },
  { variableId: 'maximized', name: 'Vergrößertes Panel' },
  { variableId: 'playing', name: 'Videodatei läuft' },
]

const same = (a: string, b: unknown) => a.toLowerCase() === String(b ?? '').trim().toLowerCase()

/** Boolean feedback checks; options as Companion delivers them. */
export const checks = {
  connected: (_s: ScopesState, connected: boolean) => connected,
  frozen: (s: ScopesState) => s.frozen,
  source_active: (s: ScopesState, o: Record<string, unknown>) =>
    !!s.source && (String(s.source.index) === String(o.source) || s.source.id === o.source || same(s.source.name, o.source)),
  clip_above: (s: ScopesState, o: Record<string, unknown>) => s.clip !== null && s.clip > Number(o.threshold ?? 0.5),
  ymax_above: (s: ScopesState, o: Record<string, unknown>) => s.yMax !== null && s.yMax > Number(o.threshold ?? 100),
  ymin_below: (s: ScopesState, o: Record<string, unknown>) => s.yMin !== null && s.yMin < Number(o.threshold ?? 0),
  layout_active: (s: ScopesState, o: Record<string, unknown>) => same(s.layoutName, o.layout) || same(s.preset, o.layout),
  scene_active: (s: ScopesState, o: Record<string, unknown>) => !!s.scene && (s.scene.id === o.scene || same(s.scene.name, o.scene)),
  output_open: (s: ScopesState, o: Record<string, unknown>) => s.outputs.some((x) => same(x.name, o.output)),
  streaming: (s: ScopesState, o: Record<string, unknown>) =>
    s.outputs.some((x) => x.stream && (!o.stream || same(x.stream, o.stream))),
  maximized: (s: ScopesState, o: Record<string, unknown>) => s.maximized !== null && s.maximized === Number(o.panel),
  playing: (s: ScopesState) => s.playing === true,
}

/** Lists that feed dropdown choices; when this key changes the definitions are rebuilt. */
export const choicesKey = (s: ScopesState) =>
  JSON.stringify([s.sources.map((x) => x.name), s.layouts, s.presets, s.scenes.map((x) => [x.id, x.name]), (s.patterns ?? []).length, s.panels.length])
