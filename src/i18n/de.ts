// German translation. `Record<Key, Msg>` makes a missing key a type error; the area files
// catch extra or mistyped keys (`satisfies Translation<typeof en>`).
import common from './de/common';
import native from './de/native';
import sysprofile from './de/sysprofile';
import testmedia from './de/testmedia';
import render from './de/render';
import output from './de/output';
import bridgeui from './de/bridgeui';
import source from './de/source';
import scene from './de/scene';
import theme from './de/theme';
import color from './de/color';
import scope from './de/scope';
import pattern from './de/pattern';
import lut from './de/lut';
import chain from './de/chain';
import match from './de/match';
import bridge from './de/bridge';
import opple from './de/opple';
import led from './de/led';
import calib from './de/calib';
import type { Key } from './en';
import type { Msg } from './types';

export const de: Record<Key, Msg> = {
  ...common,
  ...native,
  ...sysprofile,
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
  ...opple,
  ...led,
  ...calib,
};
