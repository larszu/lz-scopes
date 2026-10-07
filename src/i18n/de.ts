// German translation. `Record<Key, Msg>` makes a missing key a type error; the area files
// catch extra or mistyped keys (`satisfies Translation<typeof en>`).
import common from './de/common';
import panel from './de/panel';
import main from './de/main';
import type { Key } from './en';
import type { Msg } from './types';

export const de: Record<Key, Msg> = {
  ...common,
  ...panel,
  ...main,
};
