#!/usr/bin/env node
// Guard against hard-coded German UI text (#94). Idea from cable-planner's `lang:check`
// (scripts/quellsprache.mjs there): measure instead of asking people to remember.
//
// Reads every string literal and the static parts of template literals in the UI code
// (src/, server/, electron/, companion/src/) – comments are skipped – and reports those that
// look German: an umlaut/ß, or a word that only exists in German (lists below; words that also
// occur in English such as "in", "so", "man", "also" or "was" are left out on purpose, a guard
// that flags correct lines gets switched off instead of read).
//
// Texts belong in src/i18n/en/*.ts and src/i18n/de/*.ts. Exceptions:
//   - `// lang-ok: <reason>` at the end of the line or on the line above;
//   - whole files in ALLOW_FILES below, each with its reason.
//
//   node scripts/lang-check.mjs            report, exit 0
//   node scripts/lang-check.mjs --strict   report, exit 1 when anything is found

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const ROOTS = ['src', 'server', 'electron', 'companion/src'];
const EXT = /\.(ts|mts|cts|js|mjs|cjs)$/;

/** Files that may contain German, with the reason. Paths relative to the repo, `/` separated. */
export const ALLOW_FILES = {
  'src/i18n/': 'the dictionaries themselves',
  'src/vendor/': 'third-party code',
};

/** Words that only exist in German (lower case, whole words). */
const GERMAN_WORDS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des', 'und', 'oder', 'nicht', 'kein', 'keine', 'keinen',
  'ist', 'sind', 'wird', 'werden', 'wurde', 'mit', 'von', 'vom', 'zum', 'zur', 'beim', 'aus',
  'eine', 'einen', 'einem', 'einer', 'ein', 'nur', 'noch', 'schon', 'wenn', 'dann', 'auch', 'kann',
  'muss', 'soll', 'steht', 'gibt', 'sich', 'diese', 'dieser', 'dieses', 'nach', 'bei', 'ohne',
  'durch', 'gegen', 'damit', 'wieder', 'immer', 'jede', 'jeder', 'jedes', 'alle', 'allen', 'hier',
  'bitte', 'neu', 'neuer', 'neue', 'neues', 'bearbeiten', 'speichern', 'abbrechen', 'laden',
  'einstellungen', 'ansicht', 'auswahl', 'datei', 'dateien', 'suchen', 'farbe', 'farben', 'ordner',
  'quelle', 'quellen', 'fenster', 'ausgabe', 'bild', 'testbild', 'kamera', 'helligkeit', 'messung',
  'messpunkt', 'pegel', 'hinzufügen', 'entfernen', 'löschen', 'anzeigen', 'ausblenden', 'einfrieren',
  'standbild', 'vollbild', 'seitenleiste', 'oberfläche', 'uhr', 'verbindung', 'getrennt', 'fehler',
  'gerät', 'geräte', 'kanal', 'kanäle', 'zeigt', 'zeigen', 'aktuell', 'starten', 'stoppen', 'wählen',
  'eigene', 'eigenes', 'eigenen', 'ziel', 'ziele', 'grün', 'weiß', 'rot', 'blau', 'schwarz', 'grau',
  'hautton', 'falschfarben', 'spur', 'spurfarbe', 'skala', 'tastatur', 'hilfe', 'über', 'lizenzen',
  'bildschirm', 'aufnahme', 'wiedergabe', 'lautheit', 'tongenerator', 'lichtmesser', 'abgleich',
  'kalibrierung', 'mittelwert', 'werte', 'wert', 'zeit', 'sekunden', 'bildrate', 'zeile', 'spalte',
]);

const UMLAUT = /[äöüÄÖÜß]/;

/** Does this text look German? Returns the reason or ''. */
export function germanReason(text) {
  const u = text.match(UMLAUT);
  if (u) return `„${u[0]}“`;
  for (const w of text.toLowerCase().match(/[a-zäöüß]+/g) ?? []) if (GERMAN_WORDS.has(w)) return `„${w}“`;
  return '';
}

/**
 * String literals and the static parts of template literals, with line numbers.
 * A small tokenizer: comments, regex literals (by the previous token) and nested templates.
 */
export function strings(src) {
  const out = [];
  let i = 0, line = 1, prev = '';
  const n = src.length;
  const regexAfter = /[(,=:[!&|?{};+\-*%<>~^]$/;
  const push = (text, at) => { if (text.trim()) out.push({ text, line: at }); };
  // depth stack: '`' = inside template text, '{' = inside an expression of a template
  const stack = [];
  const braces = [];
  while (i < n) {
    const c = src[i];
    if (stack[stack.length - 1] === '`') {
      // template text up to ` or ${
      let text = '', at = line;
      while (i < n && src[i] !== '`' && !(src[i] === '$' && src[i + 1] === '{')) {
        if (src[i] === '\\') { text += src[i + 1] ?? ''; i += 2; continue; }
        if (src[i] === '\n') line++;
        text += src[i++];
      }
      push(text, at);
      if (src[i] === '`') { stack.pop(); i++; prev = 'x'; }
      else { stack.push('{'); braces.push(0); i += 2; prev = '('; }
      continue;
    }
    if (c === '\n') { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
    if (c === "'" || c === '"') {
      let text = '', at = line; i++;
      while (i < n && src[i] !== c && src[i] !== '\n') { if (src[i] === '\\') { text += src[i + 1] ?? ''; i += 2; continue; } text += src[i++]; }
      i++; push(text, at); prev = 'x'; continue;
    }
    if (c === '`') { stack.push('`'); i++; continue; }
    if (c === '/' && (prev === '' || regexAfter.test(prev) || /\b(return|typeof|case|of|in)$/.test(prev))) {
      // regex literal
      i++; let cls = false;
      while (i < n && src[i] !== '\n') {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; else if (src[i] === '/' && !cls) break;
        i++;
      }
      i++; while (/[a-z]/i.test(src[i] ?? '')) i++;
      prev = 'x'; continue;
    }
    if (stack[stack.length - 1] === '{') {
      if (c === '{') braces[braces.length - 1]++;
      else if (c === '}') {
        if (braces[braces.length - 1] === 0) { braces.pop(); stack.pop(); i++; prev = 'x'; continue; }
        braces[braces.length - 1]--;
      }
    }
    if (/[\w$]/.test(c)) { let w = ''; while (i < n && /[\w$]/.test(src[i])) w += src[i++]; prev = w; continue; }
    prev = c; i++;
  }
  return out;
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (EXT.test(name) && !/\.d\.(m|c)?ts$/.test(name)) yield p;
  }
}

/** All findings: { file, line, text, why }. */
export function check(root = ROOT) {
  const found = [];
  for (const r of ROOTS) {
    let st; try { st = statSync(join(root, r)); } catch { continue; }
    if (!st.isDirectory()) continue;
    for (const f of files(join(root, r))) {
      const rel = relative(root, f).split(sep).join('/');
      if (Object.keys(ALLOW_FILES).some((a) => rel.startsWith(a))) continue;
      const src = readFileSync(f, 'utf8');
      const lines = src.split('\n');
      for (const s of strings(src)) {
        const why = germanReason(s.text);
        if (!why) continue;
        if (/lang-ok:/.test(lines[s.line - 1] ?? '') || /lang-ok:/.test(lines[s.line - 2] ?? '')) continue;
        found.push({ file: rel, line: s.line, text: s.text.trim().slice(0, 90), why });
      }
    }
  }
  return found;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const strict = process.argv.includes('--strict');
  const found = check();
  const byFile = new Map();
  for (const f of found) byFile.set(f.file, (byFile.get(f.file) ?? 0) + 1);
  if (process.argv.includes('--list')) for (const f of found) console.log(`${f.file}:${f.line}  ${f.why}  ${f.text}`);
  for (const [f, c] of [...byFile].sort((a, b) => b[1] - a[1])) console.log(`${String(c).padStart(5)}  ${f}`);
  console.log(`${found.length} German-looking strings outside src/i18n${found.length ? ' – move them to src/i18n (t()) or mark them `// lang-ok: <reason>`' : ''}`);
  if (strict && found.length) process.exit(1);
}
