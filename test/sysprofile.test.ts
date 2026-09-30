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
