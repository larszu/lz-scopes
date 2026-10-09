import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en/help';
import de from '../src/i18n/de/help';
import { SCOPE_LABELS } from '../src/graticule';

describe('scope help texts', () => {
  const ids = Object.keys(SCOPE_LABELS);
  it('every scope has a one-liner, purpose, task and success check in both languages', () => {
    for (const dict of [en, de] as Record<string, string>[]) {
      for (const id of ids) for (const part of ['one', 'what', 'try', 'check']) expect(dict[`help.${id}.${part}`], `${id}.${part}`).toBeTruthy();
    }
  });
  it('no leftover markers or source keys from the research draft', () => {
    for (const v of [...Object.values(en), ...Object.values(de)] as string[]) {
      expect(v).not.toMatch(/\[ungeprüft\]|\[unchecked\]|as above|wie oben|\bRD-\d|\bTEK\b|\bBBC57\b|\[unsicher|\[uncertain/);
    }
  });
});
