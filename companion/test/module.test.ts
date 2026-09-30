/**
 * Pure parts of the module: action options → command, state → variables/feedbacks,
 * connection URL. No Companion, no network. The bridge validates the same commands
 * (server/control.mjs in the app repo); the last test checks against it when present.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { buildCommand } from '../src/commands.js'
import { EMPTY_STATE, checks, choicesKey, normalizeState, variableValues } from '../src/state.js'
import { controlUrl } from '../src/client.js'
import { DEFAULT_CONFIG } from '../src/config.js'

test('actions map to control commands', () => {
  assert.deepEqual(buildCommand('source_select', { source: '2', panel: 0 }), { cmd: 'source.select', source: 2 })
  assert.deepEqual(buildCommand('source_select', { source: 'Kamera 1', panel: 3 }), { cmd: 'source.select', source: 'Kamera 1', panel: 3 })
  assert.deepEqual(buildCommand('freeze', {}), { cmd: 'freeze', mode: 'toggle' })
  assert.deepEqual(buildCommand('panel_maximize', { panel: 0, mode: 'off' }), { cmd: 'panel.maximize', mode: 'off' })
  assert.deepEqual(buildCommand('roi_clear', { source: '' }), { cmd: 'roi.clear' })
  assert.deepEqual(buildCommand('layout_preset', { preset: '4' }), { cmd: 'layout.preset', preset: 4 })
  assert.deepEqual(buildCommand('output_open', { name: 'key', view: 'overlay', bg: 'black', scene: '', source: '', panel: 1, display: '', fullscreen: false, stream: '', target: '' }),
    { cmd: 'output.open', name: 'key', view: 'overlay', panel: 1, bg: 'black', fullscreen: false })
  assert.deepEqual(buildCommand('stream_start', {}), { cmd: 'stream.start', stream: 'scopes' })
  assert.deepEqual(buildCommand('transport', { op: 'next', source: '' }), { cmd: 'transport', op: 'next' })
  assert.throws(() => buildCommand('nope', {}))
})

test('state normalisation never invents values', () => {
  const s = normalizeState({ frozen: 'yes', clip: 'NaN', sources: 'x', yMax: 101.3 })
  assert.equal(s.frozen, false)
  assert.equal(s.clip, null)
  assert.deepEqual(s.sources, [])
  assert.equal(s.yMax, 101.3)
  assert.deepEqual(normalizeState(null), EMPTY_STATE)
  const v = variableValues(EMPTY_STATE, false)
  assert.equal(v.clip, '')
  assert.equal(v.ymax, '')
  assert.equal(v.connected, 'false')
})

test('variables and feedbacks from a state', () => {
  const s = normalizeState({
    source: { index: 2, id: 's2', name: 'Kamera 1', status: 'live' }, frozen: true, clip: 1.25, yMin: -0.5, yMax: 102,
    layoutName: 'Grading', preset: 'lc', scene: { id: 'a', name: 'Studio' },
    outputs: [{ name: 'key', view: 'overlay', scene: 'Studio', stream: 'scopes' }], maximized: 3, playing: false,
  })
  const v = variableValues(s, true)
  assert.equal(v.source, 'Kamera 1'); assert.equal(v.source_index, '2'); assert.equal(v.clip, '1.3')
  assert.equal(v.ymin, '-0.5'); assert.equal(v.layout, 'Grading'); assert.equal(v.streams, 'scopes'); assert.equal(v.playing, 'false')
  assert.ok(checks.source_active(s, { source: '2' }))
  assert.ok(checks.source_active(s, { source: 'kamera 1' }))
  assert.ok(!checks.source_active(s, { source: '1' }))
  assert.ok(checks.clip_above(s, { threshold: 1 }))
  assert.ok(!checks.clip_above(s, { threshold: 2 }))
  assert.ok(checks.ymax_above(s, { threshold: 100 }))
  assert.ok(checks.ymin_below(s, { threshold: 0 }))
  assert.ok(checks.layout_active(s, { layout: 'grading' }))
  assert.ok(checks.layout_active(s, { layout: 'lc' }))
  assert.ok(checks.scene_active(s, { scene: 'Studio' }))
  assert.ok(checks.output_open(s, { output: 'key' }))
  assert.ok(checks.streaming(s, { stream: '' }))
  assert.ok(!checks.streaming(s, { stream: 'other' }))
  assert.ok(checks.maximized(s, { panel: 3 }))
  assert.ok(checks.frozen(s))
  assert.ok(!checks.playing(s))
  // unknown statistics never trigger an alarm
  assert.ok(!checks.clip_above(EMPTY_STATE, { threshold: 0 }))
})

test('choices key changes only with the lists', () => {
  const a = normalizeState({ sources: [{ index: 1, id: 's1', name: 'A' }], yMax: 50 })
  const b = normalizeState({ sources: [{ index: 1, id: 's1', name: 'A' }], yMax: 90 })
  const c = normalizeState({ sources: [{ index: 1, id: 's1', name: 'B' }] })
  assert.equal(choicesKey(a), choicesKey(b))
  assert.notEqual(choicesKey(a), choicesKey(c))
})

test('connection URL', () => {
  assert.equal(controlUrl(DEFAULT_CONFIG), 'ws://127.0.0.1:4192/control')
  assert.equal(controlUrl({ host: 'studio.local', port: 5000, token: 'a b' }), 'ws://studio.local:5000/control?token=a%20b')
  assert.equal(controlUrl({ host: '::1', port: 4190, token: '' }), 'ws://[::1]:4190/control')
})

test('commands pass the bridge validation', async (t) => {
  const path = new URL('../../server/control.mjs', import.meta.url)
  if (!existsSync(path)) return t.skip('outside the lz-scopes repo')
  const { validateCommand } = await import(path.href)
  for (const [id, o] of [
    ['source_select', { source: '1', panel: 0 }], ['layout_preset', { preset: '2' }], ['layout_load', { name: 'Grading' }],
    ['panel_scope', { panel: 2, scope: 'vector' }], ['panel_maximize', { panel: 1, mode: 'toggle' }], ['freeze', { mode: 'on' }],
    ['roi_clear', {}], ['pattern_select', { pattern: 'smpte75' }], ['pattern_next', {}], ['pattern_prev', {}],
    ['output_open', { name: 'key', view: 'overlay', bg: 'black', stream: 'scopes', target: 'srt://1.2.3.4:9000' }], ['output_close', { name: '' }],
    ['scene_select', { scene: 'Studio' }], ['stream_start', { stream: 'scopes' }], ['stream_stop', {}], ['transport', { op: 'toggle' }],
    ['audio_reset', { source: '' }], ['audio_pause', { mode: 'on', source: '2' }],
    ['generator', { mode: 'on', signal: 'ebu-ident', freq: 0, level: '-18' }], ['generator', { mode: 'off', signal: '', level: '' }],
    ['generator', { mode: 'on', level: '-3', force: true }],
  ] as [string, Record<string, unknown>][]) {
    const r = validateCommand(buildCommand(id, o))
    assert.ok(r.ok, `${id}: ${r.error}`)
  }
})
