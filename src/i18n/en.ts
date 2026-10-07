// English, the source language: every key exists here first (type `Key`).
// One file per area under en/, its German counterpart under de/ with the same name.
// A new area: add en/<area>.ts and de/<area>.ts and one line in en.ts and de.ts.
import common from './en/common';
import bridge from './en/bridge';
import bridgeui from './en/bridgeui';
import chain from './en/chain';
import color from './en/color';
import genlock from './en/genlock';
import lut from './en/lut';
import main from './en/main';
import match from './en/match';
import menu from './en/menu';
import output from './en/output';
import panel from './en/panel';
import pattern from './en/pattern';
import render from './en/render';
import scene from './en/scene';
import scope from './en/scope';
import shading from './en/shading';
import source from './en/source';
import testmedia from './en/testmedia';
import theme from './en/theme';

export const en = {
  ...common,
  ...bridge,
  ...bridgeui,
  ...chain,
  ...color,
  ...genlock,
  ...lut,
  ...main,
  ...match,
  ...menu,
  ...output,
  ...panel,
  ...pattern,
  ...render,
  ...scene,
  ...scope,
  ...shading,
  ...source,
  ...testmedia,
  ...theme,
};

export type Key = keyof typeof en;
