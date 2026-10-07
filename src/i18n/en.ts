// English, the source language: every key exists here first (type `Key`).
// One file per area under en/, its German counterpart under de/ with the same name.
// A new area: add en/<area>.ts and de/<area>.ts and one line in en.ts and de.ts.
import common from './en/common';
import match from './en/match';

export const en = {
  ...common,
  ...match,
};

export type Key = keyof typeof en;
