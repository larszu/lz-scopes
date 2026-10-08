import { describe, expect, it } from 'vitest';
import { missingAssets, requiredAssets } from '../scripts/release-check.mjs';
import { blobSha } from '../scripts/decklink-sdk-fetch.mjs';

// asset names as release.yml / electron-builder produce them (v1.2.0, checked with gh release view)
const v120 = ['BtbN-FFmpeg-Builds-6c9aec5.tar.gz', 'ffmpeg-9.0.2.tar.xz', 'ffmpeg-n9.0.2-17-g2a571b6068.tar.gz', 'latest-mac.yml', 'latest.yml',
  'LZ.Scopes-1.2.0-portable.exe', 'LZ.Scopes-1.2.0-universal.dmg', 'LZ.Scopes-1.2.0-universal.dmg.blockmap', 'LZ.Scopes-1.2.0-universal.zip',
  'LZ.Scopes-1.2.0-universal.zip.blockmap', 'LZ.Scopes-1.2.0-x64.exe', 'LZ.Scopes-1.2.0-x64.exe.blockmap', 'martin-riedl-build-script-6a611e1.tar.gz'];

// Linux assets as electron-builder names them (linux.artifactName lz-scopes-${version}-${arch}.${ext}:
// arch x86_64 for the AppImage, amd64 for the deb)
const linux = ['lz-scopes-1.6.0-x86_64.AppImage', 'lz-scopes-1.6.0-amd64.deb', 'latest-linux.yml'];

describe('release completeness (#51)', () => {
  const sources = { sources: { files: [{ name: 'ffmpeg-9.0.2.tar.xz' }, { name: 'BtbN-FFmpeg-Builds-6c9aec5.tar.gz' }] } };
  it('a complete release passes', () => {
    expect(missingAssets([...v120, ...linux], requiredAssets(sources))).toEqual([]);
  });
  it('v1.1.0 (no assets at all) and a release without the Windows installers fail', () => {
    expect(missingAssets([], requiredAssets(sources)).length).toBe(11);
    expect(missingAssets([...v120, ...linux].filter((n) => !n.endsWith('.exe')), requiredAssets(sources))).toEqual(['Windows-Installer (NSIS)', 'Windows portable']);
  });
  it('every ffmpeg source archive of the manifest is required', () => {
    const req = requiredAssets();
    expect(req.length).toBeGreaterThan(6);
    expect(missingAssets([...v120, ...linux].filter((n) => n !== 'ffmpeg-9.0.2.tar.xz'), requiredAssets(sources))).toEqual(['Quelltext ffmpeg-9.0.2.tar.xz']);
  });
  it('a release without the Linux build (v1.5.0 and earlier) is incomplete', () => {
    expect(missingAssets(v120, requiredAssets(sources))).toEqual(['Linux AppImage (x64)', 'Linux deb (amd64)', 'Update-Feed Linux latest-linux.yml']);
  });
});

describe('DeckLink SDK include files', () => {
  it('git blob hash as GitHub lists it (empty blob, "hello\\n")', () => {
    // well-known values: `git hash-object /dev/null`, `printf 'hello\n' | git hash-object --stdin`
    expect(blobSha(Buffer.alloc(0))).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    expect(blobSha(Buffer.from('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });
});
