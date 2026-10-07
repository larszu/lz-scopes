/**
 * Fetches the DeckLink SDK include files (headers, IDL, DeckLinkAPIDispatch.cpp) that the
 * DeckLink helper is compiled against, from the copy in the OBS Studio repository at a fixed
 * commit, each file checked against its git blob hash in scripts/decklink-sdk.json.
 *
 *   node scripts/decklink-sdk-fetch.mjs            → vendor/decklink-sdk/{Mac,Win,Linux}/include
 *   node scripts/decklink-sdk-fetch.mjs --pin <commit>   rewrite the pin list (GitHub API)
 *
 * Licence: the include files carry Blackmagic Design's own permissive licence in their
 * header (licenses/decklink-sdk-headers.txt); the DeckLink SDK EULA §0.1 exempts
 * /Mac/Include, /Win/Include and /Linux/Include from its restrictive clauses. The runtime
 * (Desktop Video) is installed by the user and never shipped. docs/research/geraete-eingaenge.md
 * Then: DECKLINK_SDK_DIR=vendor/decklink-sdk node scripts/build-helpers.mjs decklink
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PINS = join(ROOT, 'scripts', 'decklink-sdk.json');
const OUT = join(ROOT, 'vendor', 'decklink-sdk');
const REPO = 'obsproject/obs-studio';
const DIRS = { Mac: 'plugins/decklink/mac/decklink-sdk', Win: 'plugins/decklink/win/decklink-sdk', Linux: 'plugins/decklink/linux/decklink-sdk' };

/** git blob hash (what GitHub lists as `sha` for a file). */
export const blobSha = (buf) => createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

function pin(commit) {
  const files = [];
  for (const [os, dir] of Object.entries(DIRS)) {
    const list = JSON.parse(execFileSync('gh', ['api', `repos/${REPO}/contents/${dir}?ref=${commit}`], { encoding: 'utf8' }));
    for (const f of list) if (f.type === 'file' && !f.name.startsWith('.')) files.push({ os, name: f.name, sha: f.sha });
  }
  const pins = { _doc: 'DeckLink SDK include files (OBS Studio copy), git blob hashes. scripts/decklink-sdk-fetch.mjs', repo: REPO, commit, dirs: DIRS, files };
  writeFileSync(PINS, `${JSON.stringify(pins, null, 2)}\n`);
  console.log(`${files.length} Dateien gepinnt (${commit})`);
}

async function fetchAll() {
  const pins = JSON.parse(readFileSync(PINS, 'utf8'));
  let n = 0;
  for (const f of pins.files) {
    const dest = join(OUT, f.os, 'include', f.name);
    if (existsSync(dest) && blobSha(readFileSync(dest)) === f.sha) continue;
    const url = `https://raw.githubusercontent.com/${pins.repo}/${pins.commit}/${pins.dirs[f.os]}/${f.name}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (blobSha(buf) !== f.sha) throw new Error(`${f.os}/${f.name}: Prüfsumme ${blobSha(buf)}, erwartet ${f.sha}`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
    n++;
  }
  console.log(`DeckLink-SDK-Header → ${OUT} (${pins.files.length} Dateien, ${n} geladen)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--pin');
  try {
    if (i > 0) pin(process.argv[i + 1]);
    else await fetchAll();
  } catch (e) { console.error(`decklink-sdk-fetch: ${e.message}`); process.exit(1); }
}
