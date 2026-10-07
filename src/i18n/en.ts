// English, the source language: every key exists here first (type `Key`).
// One file per area under en/, its German counterpart under de/ with the same name.
// A new area: add en/<area>.ts and de/<area>.ts and one line in en.ts and de.ts.
import common from './en/common';
import testmedia from './en/testmedia';
import render from './en/render';
import output from './en/output';
import bridgeui from './en/bridgeui';
import source from './en/source';
import scene from './en/scene';
import theme from './en/theme';
import color from './en/color';
import scope from './en/scope';
import pattern from './en/pattern';
import lut from './en/lut';
import chain from './en/chain';
import match from './en/match';
import bridge from './en/bridge';

export const en = {
  ...common,
  ...testmedia,
  ...render,
  ...output,
  ...bridgeui,
  ...source,
  ...scene,
  ...theme,
  ...color,
  ...scope,
  ...pattern,
  ...lut,
  ...chain,
  ...match,
  ...bridge,
};

export type Key = keyof typeof en;
