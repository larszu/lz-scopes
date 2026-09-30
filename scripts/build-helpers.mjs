// Builds the native capture helpers into helpers/bin/ (git-ignored; the desktop app
// ships whatever is there). Each helper is optional – missing SDKs are skipped.
//
//   DECKLINK_SDK_DIR=~/SDKs/Blackmagic_DeckLink_SDK_16.0 node scripts/build-helpers.mjs
//
// DeckLink: the Desktop Video SDK is a free download from Blackmagic Design after
// registration and is not part of this repository. macOS and Linux build here with
// clang++/g++; Windows needs MIDL (see helpers/decklink/README.md).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const bin = join(root, 'helpers', 'bin');
mkdirSync(bin, { recursive: true });
const only = process.argv.slice(2);
const want = (name) => !only.length || only.includes(name);
const run = (cmd, args) => { console.log(`> ${cmd} ${args.join(' ')}`); execFileSync(cmd, args, { stdio: 'inherit' }); };

function buildDeckLink() {
  const sdk = process.env.DECKLINK_SDK_DIR;
  if (!sdk) return console.log('decklink: übersprungen – DECKLINK_SDK_DIR nicht gesetzt (DeckLink SDK von blackmagicdesign.com/developer)');
  const src = join(root, 'helpers', 'decklink', 'lz-decklink.cpp');
  if (process.platform === 'darwin') {
    const inc = [join(sdk, 'Mac', 'include'), sdk].find((d) => existsSync(join(d, 'DeckLinkAPI.h')));
    if (!inc) throw new Error(`DeckLinkAPI.h nicht gefunden unter ${sdk}/Mac/include`);
    run('clang++', ['-std=c++17', '-O2', '-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=11.0', `-I${inc}`, src, join(inc, 'DeckLinkAPIDispatch.cpp'),
      '-framework', 'CoreFoundation', '-o', join(bin, 'lz-decklink')]);
  } else if (process.platform === 'linux') {
    const inc = [join(sdk, 'Linux', 'include'), sdk].find((d) => existsSync(join(d, 'DeckLinkAPI.h')));
    if (!inc) throw new Error(`DeckLinkAPI.h nicht gefunden unter ${sdk}/Linux/include`);
    run('g++', ['-std=c++17', '-O2', `-I${inc}`, src, join(inc, 'DeckLinkAPIDispatch.cpp'), '-ldl', '-lpthread', '-o', join(bin, 'lz-decklink')]);
  } else {
    console.log('decklink: Windows-Build siehe helpers/decklink/README.md (MIDL + cl.exe)');
  }
}

if (want('decklink')) buildDeckLink();
