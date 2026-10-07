// Which ffmpeg the bridge runs, and what it is (docs/research/ffmpeg-lizenz.md).
//
// Order: $FFMPEG, the ffmpeg shipped with the desktop app (<resources>/ffmpeg/, see
// electron-builder.js), the one fetched for development (vendor/ffmpeg/<target>/, npm run
// ffmpeg:fetch – same build as the app), then PATH plus the Homebrew prefixes (an app
// started from the Finder does not inherit the shell's PATH). The app never needs a
// system ffmpeg; PATH is only a fallback for `npm start` without a fetched build.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bmsg } from './messages.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** vendor/ffmpeg/<target> for this machine (same rule as scripts/ffmpeg-fetch.mjs). */
export function hostTarget(platform = process.platform, arch = process.arch) {
  return platform === 'darwin' ? 'darwin-universal' : `${platform}-${arch}`;
}

/** Folders with a shipped or fetched ffmpeg, in order, each with its kind. */
export function bundledDirs(env = process.env, resourcesPath = process.resourcesPath) {
  const dirs = [];
  if (resourcesPath) dirs.push({ dir: join(resourcesPath, 'ffmpeg'), kind: 'bundled' });
  dirs.push({ dir: join(ROOT, 'vendor', 'ffmpeg', hostTarget()), kind: 'vendor' });
  return dirs;
}

const exeName = (name) => (process.platform === 'win32' ? `${name}.exe` : name);

/** All ffmpeg binaries found, best first. */
export function ffmpegCandidates(env = process.env) {
  const exe = exeName('ffmpeg');
  const list = [];
  if (env.FFMPEG) list.push(env.FFMPEG);
  for (const { dir } of bundledDirs(env)) list.push(join(dir, exe));
  const dirs = (env.PATH ?? '').split(delimiter).filter(Boolean);
  if (process.platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin');
  if (process.platform === 'linux') dirs.push('/usr/bin', '/usr/local/bin');
  for (const d of dirs) list.push(join(d, exe));
  return [...new Set(list)].filter((f) => existsSync(f));
}

/** Where a binary comes from: env ($FFMPEG), bundled (desktop app), vendor (npm run ffmpeg:fetch), system. */
export function ffmpegOrigin(path, env = process.env) {
  if (!path) return 'none';
  if (env.FFMPEG && path === env.FFMPEG) return 'env';
  for (const { dir, kind } of bundledDirs(env)) if (dirname(path) === dir) return kind;
  return 'system';
}

/** Licence from the configure line, as ffmpeg's own LICENSE.md derives it. */
export function licenseOf(configuration) {
  if (/--enable-nonfree/.test(configuration)) return 'nonfree – not redistributable';
  const gpl = /--enable-gpl/.test(configuration), v3 = /--enable-version3/.test(configuration);
  return gpl ? (v3 ? 'GPL-3.0-or-later' : 'GPL-2.0-or-later') : (v3 ? 'LGPL-3.0-or-later' : 'LGPL-2.1-or-later');
}

/** Output protocols from `ffmpeg -protocols`. */
export function outputProtocols(text) {
  return new Set((text.split(/Output:/)[1] ?? '').split('\n').map((l) => l.trim()).filter(Boolean));
}

function capture(bin, args) {
  return new Promise((ok) => {
    let out = '';
    let p;
    try { p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch { return ok(''); }
    const t = setTimeout(() => p.kill('SIGKILL'), 10_000);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', () => { clearTimeout(t); ok(''); });
    p.on('close', () => { clearTimeout(t); ok(out); });
  });
}

const infoCache = new Map();
/**
 * What an ffmpeg is: {path, origin, version, license, srt, inputSrt}. Read from the binary
 * itself (`-version`, `-protocols`), never assumed.
 */
export function ffmpegInfo(path, env = process.env) {
  if (!path) return Promise.resolve(null);
  if (!infoCache.has(path)) {
    infoCache.set(path, (async () => {
      const [ver, protos] = await Promise.all([capture(path, ['-hide_banner', '-version']), capture(path, ['-hide_banner', '-protocols'])]);
      const version = /ffmpeg version (\S+)/.exec(ver)?.[1] ?? null;
      const configuration = /configuration: (.*)/.exec(ver)?.[1] ?? '';
      const out = outputProtocols(protos);
      const input = new Set((protos.split(/Input:/)[1] ?? '').split(/Output:/)[0].split('\n').map((l) => l.trim()).filter(Boolean));
      return { path, origin: ffmpegOrigin(path, env), version, license: version ? licenseOf(configuration) : null, srt: out.has('srt'), inputSrt: input.has('srt') };
    })());
  }
  return infoCache.get(path);
}

/** Does this ffmpeg read and write srt://? */
export async function hasSrt(path) {
  const i = await ffmpegInfo(path);
  return !!(i?.srt && i.inputSrt);
}

/**
 * The ffmpeg for one URL (input or push target): the first candidate, or for srt:// the
 * first one with SRT. null if there is none.
 */
export async function ffmpegFor(url, candidates = ffmpegCandidates()) {
  if (!/^srt:/i.test(url ?? '')) return candidates[0] ?? null;
  for (const c of candidates) if (await hasSrt(c)) return c;
  return null;
}

/** Error message ({ code, message }, server/messages.mjs) when no ffmpeg fits the URL. */
export function noFfmpegMessage(url, candidates = ffmpegCandidates()) {
  if (!candidates.length) return bmsg('ffmpeg.none', 'ffmpeg not found – use the desktop app, run npm run ffmpeg:fetch or set FFMPEG');
  return /^srt:/i.test(url ?? '')
    ? bmsg('ffmpeg.noSrt', 'no ffmpeg with SRT found – run npm run ffmpeg:fetch or point FFMPEG to an ffmpeg with libsrt')
    : bmsg('ffmpeg.missing', 'ffmpeg not found');
}
