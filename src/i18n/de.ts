// German translation. `Record<Key, Msg>` makes a missing key a type error; the area files
// catch extra or mistyped keys (`satisfies Translation<typeof en>`).
import common from './de/common';
import opple from './de/opple';
import led from './de/led';
import calib from './de/calib';
import type { Key } from './en';
import type { Msg } from './types';

export const de: Record<Key, Msg> = {
  ...common,
  ...opple,
  ...led,
  ...calib,
};
