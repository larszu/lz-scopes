/**
 * Is a GitHub release complete? Reads the asset names (one per line) from stdin and checks
 * them against what release.yml must attach: both installers for Windows (NSIS + portable),
 * dmg + zip for macOS (universal), the update feeds for electron-updater and every ffmpeg
 * source archive of scripts/ffmpeg-builds.json (GPLv3 section 6d).
 *
 *   gh release view v1.3.0 --json assets -q '.assets[].name' | node scripts/release-check.mjs
 *
 * Exit 1 and a list of what is missing otherwise (release.yml keeps the release a draft).
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Required assets: [label, test] pairs. */
export function requiredAssets(manifest = JSON.parse(readFileSync(join(ROOT, 'scripts', 'ffmpeg-builds.json'), 'utf8'))) {
  const req = [
    ['Windows-Installer (NSIS)', (n) => /-x64\.exe$/.test(n)],
    ['Windows portable', (n) => /-portable\.exe$/.test(n)],
    ['macOS dmg (universal)', (n) => /-universal\.dmg$/.test(n)],
    ['macOS zip (universal)', (n) => /-universal\.zip$/.test(n)],
    ['Update-Feed Windows latest.yml', (n) => n === 'latest.yml'],
    ['Update-Feed macOS latest-mac.yml', (n) => n === 'latest-mac.yml'],
  ];
  for (const s of manifest.sources.files) req.push([`Quelltext ${s.name}`, (n) => n === s.name]);
  return req;
}

/** Labels of the required assets that are missing. */
export function missingAssets(names, req = requiredAssets()) {
  return req.filter(([, test]) => !names.some(test)).map(([label]) => label);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const names = readFileSync(0, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const missing = missingAssets(names);
  for (const [label] of requiredAssets()) console.log(`${missing.includes(label) ? 'FEHLT' : 'ok   '} ${label}`);
  process.exit(missing.length ? 1 : 0);
}
