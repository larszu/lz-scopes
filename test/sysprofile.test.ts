// System profile switching (#17): backup-before-change and restore, with a fake platform layer.
// The real macOS helper was checked by hand on the test Mac (docs/research/systemprofil.md).
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { ProfileSwitcher } = require('../electron/displayProfile.cjs');

const icc = join(mkdtempSync(join(tmpdir(), 'lzs-icc-')), 'test.icc');
writeFileSync(icc, 'x');

function fake(initialCustom: string | null) {
  const state = { custom: initialCustom, log: [] as string[] };
  return {
    state,
    list: async () => [{ id: 7, name: 'Test', custom: state.custom, current: state.custom ?? '/factory.icc' }],
    set: async (id: number, p: string) => { state.log.push(`set ${id} ${p}`); state.custom = p; },
    reset: async (id: number) => { state.log.push(`reset ${id}`); state.custom = null; },
    restoreSync: (id: number, prev: string | null) => { state.log.push(`sync ${id} ${prev}`); state.custom = prev; return true; },
  };
}

describe('ProfileSwitcher', () => {
  it('writes the backup before switching and resets to the factory profile', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzs-ud-')), f = fake(null);
    const sw = new ProfileSwitcher(dir, f);
    await sw.set(7, icc);
    expect(JSON.parse(readFileSync(join(dir, 'display-profile-backup.json'), 'utf8'))['7'].previous).toBeNull();
    await sw.set(7, icc); // second switch keeps the ORIGINAL state
    expect(JSON.parse(readFileSync(join(dir, 'display-profile-backup.json'), 'utf8'))['7'].previous).toBeNull();
    await sw.restore();
    expect(f.state.custom).toBeNull();
    expect(f.state.log.at(-1)).toBe('reset 7');
    expect(existsSync(join(dir, 'display-profile-backup.json'))).toBe(false);
  });
  it('gives a previous custom profile back, also after a crash (next start)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzs-ud-')), f = fake('/mine.icc');
    await new ProfileSwitcher(dir, f).set(7, icc);
    await new ProfileSwitcher(dir, f).restoreLeftovers();
    expect(f.state.custom).toBe('/mine.icc');
  });
  it('restoreSync on quit keeps the backup when the platform cannot restore synchronously', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzs-ud-')), f = fake(null);
    const sw = new ProfileSwitcher(dir, { ...f, restoreSync: () => false });
    await sw.set(7, icc);
    sw.restoreSync();
    expect(existsSync(join(dir, 'display-profile-backup.json'))).toBe(true);
  });
  it('rejects anything that is not an existing .icc/.icm file', async () => {
    const sw = new ProfileSwitcher(mkdtempSync(join(tmpdir(), 'lzs-ud-')), fake(null));
    await expect(sw.set(7, '/etc/passwd')).rejects.toThrow();
    await expect(sw.set(7, '/nope.icc')).rejects.toThrow();
  });
});

// colormgr output as colord's client/cd-util.c prints it (cd_util_print_field: label, colon,
// padding to column 15; the profile file name on an unlabelled line below `Profile n:`).
describe('Linux colord (colormgr) parsing', () => {
  const { parseColordDevices, parseObjectPath } = require('../electron/displayProfile.cjs');
  const out = [
    'Object Path:   /org/freedesktop/ColorManager/devices/xrandr_Dell_Inc__DELL_U2415_ABC_lars_1000',
    'Owner:         lars',
    'Kind:          display',
    'Model:         DELL U2415',
    'Vendor:        Dell Inc.',
    'Device ID:     xrandr-Dell Inc.-DELL U2415-ABC',
    'Profile 1:     icc-0123abcd',
    '               /home/lars/.local/share/icc/rec709.icc',
    'Profile 2:     icc-4567ef01',
    '               /var/lib/colord/icc/edid-1.icc',
    'Metadata:      XRANDR_name=DP-1',
    '',
    'Object Path:   /org/freedesktop/ColorManager/devices/xrandr_eDP_1_lars_1000',
    'Model:         eDP-1',
    'Device ID:     xrandr-eDP-1',
    '',
  ].join('\n');
  it('reads displays, default profile (Profile 1) and the output name', () => {
    expect(parseColordDevices(out)).toEqual([
      { id: 'xrandr-Dell Inc.-DELL U2415-ABC', name: 'DP-1 – Dell Inc. DELL U2415', current: '/home/lars/.local/share/icc/rec709.icc', custom: '/home/lars/.local/share/icc/rec709.icc', profileId: 'icc-0123abcd' },
      { id: 'xrandr-eDP-1', name: 'eDP-1', current: null, custom: null, profileId: null },
    ]);
  });
  it('object path of an imported or found profile', () => {
    expect(parseObjectPath('Object Path:   /org/freedesktop/ColorManager/profiles/icc_0123\nFilename:      /x.icc\n')).toBe('/org/freedesktop/ColorManager/profiles/icc_0123');
    expect(parseObjectPath('')).toBe(null);
  });
});
