// ArgyllCMS (AGPL-3) must never be in the repository or the installers – the app only calls a
// user-installed spotread (docs/research/display-kalibrierung.md, "ArgyllCMS: Lizenzlage").
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
// @ts-expect-error plain JS config module
import config, { ARGYLL_EXCLUDE } from '../electron-builder.js';

const ARGYLL_NAME = /(^|\/)(spotread|dispcal|dispread|colprof|collink|targen|dispwin|ccxxmake|chartread|printtarg)(\.exe)?$|argyll.*\.(exe|dll|so|dylib|zip|tgz)$|\.(ccmx|ccss)$/i;

describe('ArgyllCMS is not shipped', () => {
  it('no Argyll binaries, archives or correction files are tracked in git', () => {
    const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
    expect(files.filter((f) => ARGYLL_NAME.test(f))).toEqual([]);
  });
  it('the installer config excludes Argyll tools from every packaged folder', () => {
    expect(config.files).toEqual(expect.arrayContaining(ARGYLL_EXCLUDE));
    for (const tool of ['spotread', 'dispcal', 'dispread', 'colprof', 'collink']) expect(ARGYLL_EXCLUDE as string[]).toContain(`!**/${tool}*`);
  });
});
