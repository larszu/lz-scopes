// Builds the native capture helpers into helpers/bin/ (git-ignored; the desktop app
// ships whatever is there). Each helper is optional – missing SDKs are skipped.
//
//   DECKLINK_SDK_DIR=~/SDKs/Blackmagic_DeckLink_SDK_16.0 node scripts/build-helpers.mjs
//
// NDI: builds without the SDK (helpers/ndi/ndi-min.h); the NDI runtime is loaded at run
// time from the user's installation.
//
// AJA: libajantv2 (MIT) from scripts/aja-sdk-fetch.mjs (or AJA_SDK_DIR), built with CMake
// together with the helper and linked statically (helpers/aja/README.md).
//
// DeckLink: the Desktop Video SDK is a free download from Blackmagic Design after
// registration and is not part of this repository. macOS and Linux build here with
// clang++/g++; Windows needs MIDL (see helpers/decklink/README.md).

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const bin = join(root, 'helpers', 'bin');
mkdirSync(bin, { recursive: true });
const only = process.argv.slice(2);
const want = (name) => !only.length || only.includes(name);
const run = (cmd, args) => { console.log(`> ${cmd} ${args.join(' ')}`); execFileSync(cmd, args, { stdio: 'inherit' }); };

function buildDeckLink() {
  // DECKLINK_SDK_DIR, else the include files fetched by scripts/decklink-sdk-fetch.mjs
  const fetched = join(root, 'vendor', 'decklink-sdk');
  const sdk = process.env.DECKLINK_SDK_DIR || (existsSync(fetched) ? fetched : '');
  if (!sdk) return console.log('decklink: übersprungen – erst npm run decklink:fetch (oder DECKLINK_SDK_DIR setzen)');
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
  } else if (process.platform === 'win32') {
    // MSVC developer environment needed (midl, cl): "x64 Native Tools" console or, in CI, ilammy/msvc-dev-cmd
    const inc = join(sdk, 'Win', 'include');
    if (!existsSync(join(inc, 'DeckLinkAPI.idl'))) throw new Error(`DeckLinkAPI.idl nicht gefunden unter ${inc}`);
    const gen = join(root, 'helpers', 'decklink', 'win-gen');
    mkdirSync(gen, { recursive: true });
    run('midl', ['/nologo', '/env', 'x64', '/h', 'DeckLinkAPI.h', '/iid', 'DeckLinkAPI_i.c', '/out', gen, '/I', inc, join(inc, 'DeckLinkAPI.idl')]);
    run('cl', ['/nologo', '/EHsc', '/O2', '/std:c++17', '/utf-8', `/I${gen}`, src, join(gen, 'DeckLinkAPI_i.c'), `/Fo${gen}\\`,
      `/Fe${join(bin, 'lz-decklink.exe')}`, 'ole32.lib', 'oleaut32.lib']);
  } else {
    console.log(`decklink: ${process.platform} nicht unterstützt`);
  }
}

/**
 * macOS SDK path with a version in its name: libajantv2's CMakeOptions.cmake parses the major and
 * minor version out of CMAKE_OSX_SYSROOT, and CMake 4 leaves it empty (MacOSX.sdk has no version).
 */
export function versionedMacSdk() {
  const sdk = realpathSync(execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' }).trim());
  if (/MacOSX\d+\.\d+/.test(basename(sdk))) return sdk;
  const ver = execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-version'], { encoding: 'utf8' }).trim();
  const named = join(dirname(sdk), `MacOSX${/\./.test(ver) ? ver : `${ver}.0`}.sdk`);
  if (!existsSync(named)) throw new Error(`macOS-SDK mit Versionsnummer nicht gefunden (${named})`);
  return named;
}

function buildAja() {
  const fetched = join(root, 'vendor', 'libajantv2');
  const sdk = process.env.AJA_SDK_DIR || (existsSync(join(fetched, 'CMakeLists.txt')) ? fetched : '');
  if (!sdk) return console.log('aja: übersprungen – erst npm run aja:fetch (oder AJA_SDK_DIR setzen)');
  const src = join(root, 'helpers', 'aja'), out = join(src, 'build');
  const args = ['-S', src, '-B', out, '-DCMAKE_BUILD_TYPE=Release', `-DAJA_SDK_DIR=${resolve(sdk)}`];
  if (process.platform === 'darwin') args.push(`-DCMAKE_OSX_SYSROOT=${versionedMacSdk()}`, '-DCMAKE_OSX_ARCHITECTURES=arm64;x86_64', '-DCMAKE_OSX_DEPLOYMENT_TARGET=11.0');
  if (process.platform === 'win32') args.push('-A', 'x64');
  run('cmake', args);
  run('cmake', ['--build', out, '--config', 'Release', '--target', 'lz-aja', '--parallel']);
  const exe = process.platform === 'win32' ? 'lz-aja.exe' : 'lz-aja';
  const built = [join(out, 'Release', exe), join(out, exe)].find((f) => existsSync(f));
  if (!built) throw new Error(`aja: ${exe} nach dem Bau nicht gefunden unter ${out}`);
  copyFileSync(built, join(bin, exe));
}

// ColorSync display-profile helper (#17): Swift, public ColorSync API, macOS only, universal.
function buildColorSync() {
  if (process.platform !== 'darwin') return console.log('colorsync: nur macOS');
  const src = join(root, 'helpers', 'colorsync', 'lzs-colorsync.swift'), out = join(bin, 'lzs-colorsync');
  const parts = ['arm64', 'x86_64'].map((a) => { const o = `${out}-${a}`; run('swiftc', ['-O', '-target', `${a}-apple-macos11`, src, '-o', o]); return o; });
  run('lipo', ['-create', ...parts, '-output', out]);
  for (const p of parts) rmSync(p);
}

function buildNdi() {
  const dir = join(root, 'helpers', 'ndi');
  const src = join(dir, 'lz-ndi.cpp');
  if (process.platform === 'darwin') {
    run('clang++', ['-std=c++17', '-O2', '-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=11.0', `-I${dir}`, src, '-o', join(bin, 'lz-ndi')]);
  } else if (process.platform === 'linux') {
    run('g++', ['-std=c++17', '-O2', `-I${dir}`, src, '-ldl', '-lpthread', '-o', join(bin, 'lz-ndi')]);
  } else {
    run('cl', ['/nologo', '/EHsc', '/O2', '/std:c++17', `/I${dir}`, src, `/Fe:${join(bin, 'lz-ndi.exe')}`, `/Fo:${join(bin, 'lz-ndi.obj')}`]);
  }
}

if (want('ndi')) buildNdi();
if (want('decklink')) buildDeckLink();
if (want('aja')) buildAja();
if (want('colorsync')) buildColorSync();
