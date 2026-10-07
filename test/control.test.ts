import { describe, expect, it } from 'vitest';
import { COMMANDS, OVERLAY_SCOPES, PANEL_SCOPES, controlAccess, isLoopback, validateCommand } from '../server/control.mjs';
import { SCOPE_LABELS } from '../src/graticule';

const ok = (raw: unknown) => {
  const r = validateCommand(raw);
  if (!r.ok) throw new Error(r.error);
  return r.command;
};
const err = (raw: unknown) => {
  const r = validateCommand(raw);
  if (r.ok) throw new Error(`accepted ${JSON.stringify(raw)}`);
  return r.error;
};

describe('validateCommand', () => {
  it('rejects non-objects and unknown commands', () => {
    expect(err(null)).toMatch(/JSON object/);
    expect(err([])).toMatch(/JSON object/);
    expect(err('freeze')).toMatch(/JSON object/);
    expect(err({ cmd: 'rm -rf' })).toMatch(/Unknown command/);
    expect(err({})).toMatch(/Unknown command/);
  });

  it('audio commands: I/LRA reset and pause, generator with a loudness guard (#24)', () => {
    expect(ok({ cmd: 'audio.reset' })).toEqual({ cmd: 'audio.reset' });
    expect(ok({ cmd: 'audio.reset', source: '2' })).toEqual({ cmd: 'audio.reset', source: 2 });
    expect(ok({ cmd: 'audio.pause' })).toEqual({ cmd: 'audio.pause', mode: 'toggle' });
    expect(ok({ cmd: 'audio.pause', mode: 'on', source: 'Kamera' })).toEqual({ cmd: 'audio.pause', mode: 'on', source: 'Kamera' });
    expect(ok({ cmd: 'generator', mode: 'on', signal: 'ebu-ident', level: -18 })).toEqual({ cmd: 'generator', mode: 'on', signal: 'ebu-ident', level: -18 });
    expect(ok({ cmd: 'generator', mode: 'off' })).toEqual({ cmd: 'generator', mode: 'off' });
    expect(err({ cmd: 'generator', signal: 'laser' })).toMatch(/signal/);
    expect(err({ cmd: 'generator', level: -3 })).toMatch(/force/);
    expect(ok({ cmd: 'generator', level: -3, force: true }).level).toBe(-3);
    expect(err({ cmd: 'generator', freq: 5 })).toMatch(/freq/);
    expect(PANEL_SCOPES).toContain('audio-check');
  });

  it('every documented command is known', () => {
    for (const cmd of ['state', 'source.select', 'layout.preset', 'layout.load', 'panel.scope', 'panel.maximize', 'freeze', 'roi.clear',
      'pattern.select', 'pattern.next', 'pattern.prev', 'output.open', 'output.close', 'scene.select', 'stream.start', 'stream.stop', 'transport']) {
      expect(COMMANDS).toHaveProperty([cmd]);
    }
  });

  it('source.select: number, numeric string or name; optional panel', () => {
    expect(ok({ cmd: 'source.select', source: 2 })).toEqual({ cmd: 'source.select', source: 2 });
    expect(ok({ cmd: 'source.select', source: ' 3 ', panel: '4' })).toEqual({ cmd: 'source.select', source: 3, panel: 4 });
    expect(ok({ cmd: 'source.select', source: 'Kamera 1' }).source).toBe('Kamera 1');
    expect(err({ cmd: 'source.select' })).toMatch(/source missing/);
    expect(err({ cmd: 'source.select', source: 0 })).toMatch(/source/);
    expect(err({ cmd: 'source.select', source: 1.5 })).toMatch(/source/);
    expect(err({ cmd: 'source.select', source: {} })).toMatch(/source/);
    expect(err({ cmd: 'source.select', source: 'x'.repeat(200) })).toMatch(/source/);
  });

  it('mode defaults to toggle and is checked', () => {
    expect(ok({ cmd: 'freeze' })).toEqual({ cmd: 'freeze', mode: 'toggle' });
    expect(ok({ cmd: 'freeze', mode: 'on' }).mode).toBe('on');
    expect(err({ cmd: 'freeze', mode: 'yes' })).toMatch(/mode/);
    expect(ok({ cmd: 'panel.maximize', mode: 'off' })).toEqual({ cmd: 'panel.maximize', mode: 'off' });
    expect(err({ cmd: 'panel.maximize' })).toMatch(/panel missing/);
    expect(ok({ cmd: 'panel.maximize', panel: 1 })).toEqual({ cmd: 'panel.maximize', mode: 'toggle', panel: 1 });
  });

  it('panel.scope only with a real scope', () => {
    expect(ok({ cmd: 'panel.scope', panel: 2, scope: 'vector' })).toEqual({ cmd: 'panel.scope', panel: 2, scope: 'vector' });
    expect(err({ cmd: 'panel.scope', panel: 2, scope: 'nope' })).toMatch(/scope/);
    expect(err({ cmd: 'panel.scope', scope: 'vector' })).toMatch(/panel missing/);
  });

  it('scope lists match the app', () => {
    expect([...PANEL_SCOPES].sort()).toEqual(Object.keys(SCOPE_LABELS).sort());
    for (const s of OVERLAY_SCOPES) expect(SCOPE_LABELS).toHaveProperty([s]);
    expect(OVERLAY_SCOPES).not.toContain('picture');
  });

  it('output.open fills defaults and checks names, targets, display', () => {
    expect(ok({ cmd: 'output.open' })).toEqual({ cmd: 'output.open', view: 'overlay', bg: 'picture', fullscreen: true });
    const c = ok({ cmd: 'output.open', name: 'beamer', view: 'grid', display: 69733378, fullscreen: false, stream: 'scopes', target: 'srt://10.0.0.5:9000' });
    expect(c).toMatchObject({ name: 'beamer', view: 'grid', display: '69733378', fullscreen: false, stream: 'scopes', target: 'srt://10.0.0.5:9000' });
    expect(err({ cmd: 'output.open', view: 'wall' })).toMatch(/view/);
    expect(err({ cmd: 'output.open', name: '../etc' })).toMatch(/name/);
    expect(err({ cmd: 'output.open', stream: 'a', target: 'file:///tmp/x' })).toMatch(/target/);
    expect(err({ cmd: 'output.open', target: 'rtmp://x/y' })).toMatch(/target needs stream/);
    expect(err({ cmd: 'output.open', bg: 'green' })).toMatch(/bg/);
    expect(err({ cmd: 'output.open', display: 'screen; rm' })).toMatch(/display/);
    expect(err({ cmd: 'output.open', fullscreen: 'yes' })).toMatch(/fullscreen/);
  });

  it('stream, scene, transport', () => {
    expect(ok({ cmd: 'stream.start', stream: 'scopes' })).toEqual({ cmd: 'stream.start', stream: 'scopes' });
    expect(err({ cmd: 'stream.start' })).toMatch(/stream/);
    expect(err({ cmd: 'stream.start', stream: 'a b' })).toMatch(/stream/);
    expect(ok({ cmd: 'stream.stop' })).toEqual({ cmd: 'stream.stop' });
    expect(ok({ cmd: 'scene.select', scene: 'Studio', output: 'out1' })).toEqual({ cmd: 'scene.select', scene: 'Studio', output: 'out1' });
    expect(err({ cmd: 'scene.select' })).toMatch(/scene missing/);
    expect(ok({ cmd: 'transport', op: 'next' })).toEqual({ cmd: 'transport', op: 'next' });
    expect(err({ cmd: 'transport', op: 'eject' })).toMatch(/op/);
  });

  it('drops unknown extra fields', () => {
    expect(ok({ cmd: 'roi.clear', evil: '<script>' })).toEqual({ cmd: 'roi.clear' });
  });
});

describe('controlAccess', () => {
  it('loopback detection', () => {
    for (const a of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) expect(isLoopback(a)).toBe(true);
    for (const a of ['10.0.0.2', '::ffff:192.168.1.4', '', undefined]) expect(isLoopback(a)).toBe(false);
  });
  it('without token only loopback', () => {
    expect(controlAccess({ remote: '127.0.0.1' })).toBeNull();
    expect(controlAccess({ remote: '192.168.1.20' })?.status).toBe(403);
  });
  it('with token everybody who presents it', () => {
    expect(controlAccess({ remote: '192.168.1.20', token: 's3cret', presented: 's3cret' })).toBeNull();
    expect(controlAccess({ remote: '127.0.0.1', token: 's3cret', presented: null })?.status).toBe(401);
    expect(controlAccess({ remote: '192.168.1.20', token: 's3cret', presented: 'nope' })?.status).toBe(401);
  });
  it('refuses foreign web pages', () => {
    expect(controlAccess({ remote: '127.0.0.1', origin: 'https://evil.example', host: '127.0.0.1:4190' })?.status).toBe(403);
    expect(controlAccess({ remote: '127.0.0.1', origin: 'http://127.0.0.1:4190', host: '127.0.0.1:4190' })).toBeNull();
  });
});
