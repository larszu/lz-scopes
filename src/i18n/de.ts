// German translation. `Record<Key, Msg>` makes a missing key a type error; the area files
// catch extra or mistyped keys (`satisfies Translation<typeof en>`).
import common from './de/common';
import pattern from './de/pattern';
import lut from './de/lut';
import chain from './de/chain';
import match from './de/match';
import type { Key } from './en';
import type { Msg } from './types';

export const de: Record<Key, Msg> = {
  ...common,
  ...pattern,
  ...lut,
  ...chain,
  ...match,
};
