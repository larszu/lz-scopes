// English, the source language: every key exists here first (type `Key`).
// One file per area under en/, its German counterpart under de/ with the same name.
// A new area: add en/<area>.ts and de/<area>.ts and one line in en.ts and de.ts.
import common from './en/common';
import genlock from './en/genlock';
import shading from './en/shading';
import menu from './en/menu';
import panel from './en/panel';
import main from './en/main';

export const en = {
  ...common,
  ...genlock,
  ...shading,
  ...menu,
  ...panel,
  ...main,
};

export type Key = keyof typeof en;
