import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { resolveProcessCheck, resolveState } from '../server/resolve.mjs';
import { resolveLines } from '../src/resolveLive';
import { setLang } from '../src/i18n';

setLang('de'); // the UI texts below are checked in German

describe('running DaVinci Resolve', () => {
  it('process check per platform', () => {
    expect(resolveProcessCheck('darwin').args).toEqual(['-x', 'Resolve']);
    expect(resolveProcessCheck('darwin').match('45599\n')).toBe(true);
    expect(resolveProcessCheck('darwin').match('')).toBe(false);
    const w = resolveProcessCheck('win32');
    expect(w.match('"Resolve.exe","1234","Console","1","2.000.000 K"\r\n')).toBe(true);
    expect(w.match('INFO: No tasks are running which match the specified criteria.')).toBe(false);
  });
  it('states: not running, scripting off, no python, connected', () => {
    expect(resolveState(false, null)).toEqual({ running: false });
    expect(resolveState(true, null)).toMatchObject({ running: true, scripting: false, reason: 'python' });
    expect(resolveState(true, { scripting: false })).toMatchObject({ reason: 'off' });
    // probe output captured from Resolve Studio 21.1.1 on 06.10.2026
    const st = resolveState(true, { scripting: true, product: 'DaVinci Resolve Studio', version: '21.1.1.10', page: 'color', project: '20261003_Selina', timeline: null });
    expect(st).toMatchObject({ running: true, scripting: true, project: '20261003_Selina' });
    expect(resolveLines(st)).toEqual({ title: 'DaVinci Resolve Studio 21.1.1 läuft', detail: '20261003_Selina – keine Timeline offen', canConnect: true });
  });
  it('tells how to switch external scripting on, and offers no connect button then', () => {
    const l = resolveLines({ running: true, scripting: false, reason: 'off' })!;
    expect(l.canConnect).toBe(false);
    expect(l.detail).toMatch(/Externes Scripting.*Lokal/);
    expect(resolveLines({ running: false })).toBeNull();
  });
});
