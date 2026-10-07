// English, the source language: every key exists here first (type `Key`).
// One file per area under en/, its German counterpart under de/ with the same name.
// A new area: add en/<area>.ts and de/<area>.ts and one line in en.ts and de.ts.
import common from './en/common';
import color from './en/color';
import scope from './en/scope';
import pattern from './en/pattern';
import lut from './en/lut';
import chain from './en/chain';
import match from './en/match';

export const en = {
  ...common,
  ...color,
  ...scope,
  ...pattern,
  ...lut,
  ...chain,
  ...match,
};

export type Key = keyof typeof en;
