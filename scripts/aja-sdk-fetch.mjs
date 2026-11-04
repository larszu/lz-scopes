/**
 * Fetches libajantv2 – AJA's open-source NTV2 SDK (MIT licence) – that the AJA helper
 * (helpers/aja) is linked against, at the release tag pinned in scripts/aja-sdk.json; the
 * checkout must sit at exactly the pinned commit.
 *
 *   node scripts/aja-sdk-fetch.mjs                 → vendor/libajantv2
 *   node scripts/aja-sdk-fetch.mjs --pin <tag>     rewrite the pin (GitHub API)
 *
 * The driver (AJA Desktop Software on macOS/Windows, the ntv2 kernel module on Linux) is
 * installed by the user and never shipped. Then: node scripts/build-helpers.mjs aja
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PINS = join(ROOT, 'scripts', 'aja-sdk.json');
export const AJA_SDK_DIR = join(ROOT, 'vendor', 'libajantv2');

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function pin(tag) {
  const pins = JSON.parse(readFileSync(PINS, 'utf8'));
  const ref = JSON.parse(execFileSync('gh', ['api', `repos/${pins.repo}/commits/${tag}`], { encoding: 'utf8' }));
  writeFileSync(PINS, `${JSON.stringify({ ...pins, tag, commit: ref.sha }, null, 2)}\n`);
  console.log(`libajantv2 gepinnt: ${tag} (${ref.sha})`);
}

export function fetchSdk() {
  const pins = JSON.parse(readFileSync(PINS, 'utf8'));
  if (existsSync(join(AJA_SDK_DIR, '.git'))) {
    let head = '';
    try { head = git(['rev-parse', 'HEAD'], AJA_SDK_DIR); } catch { /* broken checkout: fetch again */ }
    if (head === pins.commit) return console.log(`libajantv2 ${pins.tag} schon da → ${AJA_SDK_DIR}`);
    rmSync(AJA_SDK_DIR, { recursive: true, force: true });
  }
  git(['clone', '--quiet', '--depth', '1', '--branch', pins.tag, `https://github.com/${pins.repo}.git`, AJA_SDK_DIR], ROOT);
  const head = git(['rev-parse', 'HEAD'], AJA_SDK_DIR);
  if (head !== pins.commit) {
    rmSync(AJA_SDK_DIR, { recursive: true, force: true });
    throw new Error(`Tag ${pins.tag} zeigt auf ${head}, erwartet ${pins.commit}`);
  }
  console.log(`libajantv2 ${pins.tag} (${head.slice(0, 10)}) → ${AJA_SDK_DIR}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--pin');
  try {
    if (i > 0) pin(process.argv[i + 1]);
    else fetchSdk();
  } catch (e) { console.error(`aja-sdk-fetch: ${e.message}`); process.exit(1); }
}
