import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { de } from '../src/i18n/de';
import { en } from '../src/i18n/en';
import { fill, lang, setLang, t, tIn, toLang, type Key } from '../src/i18n';
import type { Msg } from '../src/i18n/types';
// @ts-expect-error plain .mjs without types
import { check, germanReason, strings } from '../scripts/lang-check.mjs';

/**
 * Warning first (#94): while the migration runs in several PRs the guard only reports.
 * Set to true once everything is migrated – from then on new German strings fail the tests.
 */
const STRICT = false;

const placeholders = (m: Msg) => [...new Set((typeof m === 'string' ? m : `${m.one} ${m.other} ${m.zero ?? ''}`).match(/\{\w+\}/g) ?? [])].sort();

describe('i18n dictionaries', () => {
  const keys = Object.keys(en) as Key[];

  it('no key is defined in two area files (a later spread would silently win)', () => {
    const seen = new Map<string, string>();
    for (const [file, mod] of Object.entries(import.meta.glob('../src/i18n/en/*.ts', { eager: true }) as Record<string, { default: object }>)) {
      for (const k of Object.keys(mod.default)) {
        expect(seen.get(k), `${k} in ${file} and ${seen.get(k)}`).toBeUndefined();
        seen.set(k, file);
      }
    }
    expect(seen.size).toBe(Object.keys(en).length);
  });

  it('de has exactly the keys of en', () => {
    expect(Object.keys(de).sort()).toEqual([...keys].sort());
  });

  it('same placeholders and the same shape (text / plural) in both languages', () => {
    for (const k of keys) {
      expect(typeof de[k], k).toBe(typeof en[k]);
      expect(placeholders(de[k]), k).toEqual(placeholders(en[k]));
    }
  });

  it('no empty texts, no German left in English, no untranslated copy of a long English text', () => {
    for (const k of keys) {
      const e = en[k] as Msg, d = de[k];
      for (const s of typeof e === 'string' ? [e] : [e.one, e.other]) {
        expect(s.trim(), k).not.toBe('');
        expect(/[äöüÄÖÜß]/.test(s), `${k}: ${s}`).toBe(false);
      }
      for (const s of typeof d === 'string' ? [d] : [d.one, d.other]) expect(s.trim(), k).not.toBe('');
      if (typeof e === 'string' && e.split(' ').length > 4) expect(d, `${k} not translated`).not.toBe(e);
    }
  });
});

describe('Electron main process texts (electron/i18n.cjs)', () => {
  it('same keys and argument shape in de and en', () => {
    const { TEXT } = createRequire(import.meta.url)('../electron/i18n.cjs') as { TEXT: Record<'de' | 'en', Record<string, string | ((n: string) => string)>> };
    expect(Object.keys(TEXT.de).sort()).toEqual(Object.keys(TEXT.en).sort());
    for (const k of Object.keys(TEXT.en)) expect(typeof TEXT.de[k], k).toBe(typeof TEXT.en[k]);
  });
});

describe('t()', () => {
  afterEach(() => setLang('en'));

  it('fills placeholders and leaves unknown ones visible', () => {
    expect(fill('{a} → {b}', { a: 1, b: 'x' })).toBe('1 → x');
    expect(fill('{a} {missing}', { a: 1 })).toBe('1 {missing}');
  });

  it('translates into the active language', () => {
    setLang('de');
    expect(lang()).toBe('de');
    expect(t('common.close')).toBe('Schließen');
    expect(t('lang.auto', { lang: 'English' })).toBe('Automatisch (English)');
    setLang('en');
    expect(t('common.close')).toBe('Close');
  });

  it('picks plural forms by n (Intl.PluralRules)', () => {
    const p = { one: '{n} source', other: '{n} sources', zero: 'no source' };
    const de2 = { one: '{n} Quelle', other: '{n} Quellen' };
    // through the public path: a temporary key
    (en as Record<string, Msg>)['test.plural'] = p;
    (de as Record<string, Msg>)['test.plural'] = de2;
    try {
      expect(tIn('en', 'test.plural' as Key, { n: 1 })).toBe('1 source');
      expect(tIn('en', 'test.plural' as Key, { n: 3 })).toBe('3 sources');
      expect(tIn('en', 'test.plural' as Key, { n: 0 })).toBe('no source');
      expect(tIn('de', 'test.plural' as Key, { n: 0 })).toBe('0 Quellen');
      expect(tIn('de', 'test.plural' as Key, { n: 1 })).toBe('1 Quelle');
    } finally {
      delete (en as Record<string, Msg>)['test.plural'];
      delete (de as Record<string, Msg>)['test.plural'];
    }
  });

  it('maps locales: German variants → de, everything else → en', () => {
    expect(toLang('de-AT')).toBe('de');
    expect(toLang('de_CH')).toBe('de');
    expect(toLang('en-GB')).toBe('en');
    expect(toLang('fr-FR')).toBe('en');
    expect(toLang('')).toBeNull();
  });
});

describe('lang-check guard (scripts/lang-check.mjs)', () => {
  it('reads string literals and template text, skips comments and regexes', () => {
    const src = [
      "// Kommentar über die Quelle",
      "const a = 'Quelle wählen', b = /[äöü]/g;",
      'const c = `Hallo ${x ? "über" : `nested ${y} Größe`} Ende`;',
      '/* Block über */ const d = "plain";',
    ].join('\n');
    expect(strings(src).map((s: { text: string }) => s.text)).toEqual(['Quelle wählen', 'Hallo ', 'über', 'nested ', ' Größe', ' Ende', 'plain']);
  });

  it('detects German by umlauts and German-only words, not by shared words', () => {
    expect(germanReason('Quelle hinzufügen')).not.toBe('');
    expect(germanReason('Kanal 1 und 2')).not.toBe('');
    expect(germanReason('Waveform in % also shown')).toBe('');
    expect(germanReason('read-only, so was it')).toBe('');
  });

  it(STRICT ? 'no hard-coded German UI text outside src/i18n' : 'reports hard-coded German UI text (warning while #94 migrates)', () => {
    const found = check() as { file: string; line: number; text: string; why: string }[];
    if (STRICT) expect(found.map((f) => `${f.file}:${f.line} ${f.text}`)).toEqual([]);
    else if (found.length) {
      console.warn(`lang-check: ${found.length} German-looking strings outside src/i18n (npm run lang:check -- --list)`);
    }
  });
});
