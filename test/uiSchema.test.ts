import { describe, expect, it } from 'vitest';
import { SETTING_KEYS, validateCommand } from '../server/control.mjs';
import { applySetting, describeSettings, type Setting } from '../src/ui/schema';

// One description per global setting (src/ui/schema.ts) renders the settings window, the panel
// ⚙ rows and validates control API values (command "setting", docs/control-api.md).

const store = { unit: 'percent', zebra: 95, skin: [20, 80] as [number, number], sidebar: true };
const defs: Setting[] = [
  { key: 'unit', kind: 'select', label: () => 'Scale', options: () => [['percent', '%'], ['bit10', '10 bit']], get: () => store.unit, set: (v) => { store.unit = v; } },
  { key: 'zebra', kind: 'number', label: () => 'Zebra', min: 50, max: 109, unit: '%', get: () => store.zebra, set: (v) => { store.zebra = v; } },
  { key: 'skinLuma', kind: 'range', label: () => 'Skin', min: 0, max: 100, get: () => store.skin, set: (v) => { store.skin = v; } },
  { key: 'sidebar', kind: 'toggle', label: () => 'Sidebar', text: () => 'Show', get: () => store.sidebar, set: (v) => { store.sidebar = v; } },
];
const def = (k: string) => defs.find((d) => d.key === k)!;

describe('settings schema', () => {
  it('applies valid values and rejects the rest with an English message', () => {
    applySetting(def('unit'), 'bit10');
    expect(store.unit).toBe('bit10');
    expect(() => applySetting(def('unit'), 'nits')).toThrow(/one of percent, bit10/);
    applySetting(def('zebra'), '100');
    expect(store.zebra).toBe(100);
    expect(() => applySetting(def('zebra'), 120)).toThrow(/50…109/);
    applySetting(def('skinLuma'), [70, 30]);
    expect(store.skin).toEqual([30, 70]);
    expect(() => applySetting(def('skinLuma'), [10])).toThrow(/\[lo, hi\]/);
    applySetting(def('sidebar'), 'off');
    expect(store.sidebar).toBe(false);
    expect(() => applySetting(def('sidebar'), 'maybe')).toThrow(/true\/false/);
  });

  it('describes keys, values, choices and ranges for the control API state', () => {
    const d = describeSettings(defs);
    expect(d[0]).toEqual({ key: 'unit', kind: 'select', label: 'Scale', value: 'bit10', options: ['percent', 'bit10'] });
    expect(d[1]).toMatchObject({ key: 'zebra', min: 50, max: 109 });
  });

  it('control API: "setting" takes a known key and a plain value', () => {
    expect(SETTING_KEYS).toContain('unit');
    expect(SETTING_KEYS).not.toContain('lang');
    const r = validateCommand({ cmd: 'setting', key: 'unit', value: 'bit10' });
    expect(r).toEqual({ ok: true, command: { cmd: 'setting', key: 'unit', value: 'bit10' } });
    expect(validateCommand({ cmd: 'setting', key: 'skinLuma', value: [20, 80] }).ok).toBe(true);
    expect(validateCommand({ cmd: 'setting', key: 'nope', value: 1 }).ok).toBe(false);
    expect(validateCommand({ cmd: 'setting', key: 'unit', value: { a: 1 } }).ok).toBe(false);
    expect(validateCommand({ cmd: 'setting', key: 'unit' }).ok).toBe(false);
  });
});
