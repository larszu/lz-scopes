// The ffmpeg build the desktop app ships, fetched for this machine by `npm run ffmpeg:fetch`
// (vendor/ffmpeg/<target>/, scripts/ffmpeg-builds.json). Tests that need ffmpeg run against
// it; without it they are skipped, unless LZS_FFMPEG_REQUIRED=1 (ci.yml, release.yml).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { bundledDirs } from '../server/ffmpeg.mjs';

const dir = bundledDirs(process.env, '').find((d) => d.kind === 'vendor')!.dir;
const file = join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
if (!existsSync(file) && process.env.LZS_FFMPEG_REQUIRED === '1') throw new Error(`${file} fehlt – vorher node scripts/ffmpeg-fetch.mjs`);

/** Path of the shipped ffmpeg for this machine, or null. */
export const shippedFfmpeg: string | null = existsSync(file) ? file : null;
