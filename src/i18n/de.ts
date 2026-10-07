// German translation. `Record<Key, Msg>` makes a missing key a type error; the area files
// catch extra or mistyped keys (`satisfies Translation<typeof en>`).
import common from './de/common';
import bridge from './de/bridge';
import bridgeui from './de/bridgeui';
import chain from './de/chain';
import color from './de/color';
import genlock from './de/genlock';
import lut from './de/lut';
import main from './de/main';
import match from './de/match';
import menu from './de/menu';
import output from './de/output';
import panel from './de/panel';
import pattern from './de/pattern';
import render from './de/render';
import scene from './de/scene';
import scope from './de/scope';
import shading from './de/shading';
import source from './de/source';
import testmedia from './de/testmedia';
import theme from './de/theme';
import type { Key } from './en';
import type { Msg } from './types';

export const de: Record<Key, Msg> = {
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
