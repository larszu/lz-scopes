// Media files as stream inputs (#188): a file the user picked in the desktop app becomes the
// input `file:<name>`, so ffmpeg decodes it instead of the browser's <video> element. That is
// the only way to see what a file really carries – <video> gives 8-bit RGBA whatever the
// source was, and knows neither ProRes nor DNxHR nor v210 nor 16-bit stills.
//
// Only files released by the app are readable: the page sends a name, never a path, and the
// bridge never opens anything it was not handed by the app (same rule as the watch folders).

import { existsSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

/** `file:<name>` – a released file. Slashes are excluded, so no path can be smuggled in. */
export const MEDIA_URL = /^file:([^\n\r\0/\\]{1,120})$/u;

/** Stills: ffmpeg repeats the one picture instead of playing a stream. */
export const STILL_EXTENSIONS = ['.tif', '.tiff', '.dpx', '.exr', '.png', '.jpg', '.jpeg', '.webp', '.bmp'];

/** Frame rate of a still: the picture does not change, the scopes only need to be fed. */
export const STILL_FPS = 10;

/** How many files stay released; the oldest drops out (the app may open many in a session). */
const LIMIT = 64;

/** name → { path, still } */
const FILES = new Map();

const cleanName = (n) => n.replace(/[^\p{L}\p{N} ._()+-]/gu, '_').slice(0, 100) || 'file';

/** Release a file (desktop app: chosen in a native dialog); → { name, url, file }. */
export function addMediaFile(p) {
  const path = resolve(String(p ?? ''));
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`not a file: ${path}`);
  for (const [name, f] of FILES) if (f.path === path) return { name, url: `file:${name}`, file: basename(path) };
  const base = cleanName(basename(path));
  let name = base;
  for (let i = 2; FILES.has(name); i++) name = `${base} (${i})`;
  FILES.set(name, { path, still: STILL_EXTENSIONS.includes(extname(path).toLowerCase()) });
  for (const old of [...FILES.keys()].slice(0, Math.max(0, FILES.size - LIMIT))) FILES.delete(old);
  return { name, url: `file:${name}`, file: basename(path) };
}

/** The released file of a `file:<name>` URL, or null (unknown name, or the file is gone). */
export function mediaFile(url) {
  const m = MEDIA_URL.exec(String(url ?? ''));
  const f = m ? FILES.get(m[1]) : null;
  return f && existsSync(f.path) ? f : null;
}

/** Input path for ffmpeg/ffprobe: the released file of a `file:` URL, otherwise the URL itself. */
export const inputPath = (url) => mediaFile(url)?.path ?? url;

/**
 * ffmpeg input arguments of a released file: paced at its own frame rate and endlessly
 * looped, like the `<video loop>` of the browser path.
 */
export function mediaInputArgs(f) {
  return f.still
    ? ['-loop', '1', '-framerate', String(STILL_FPS), '-re', '-i', f.path]
    : ['-stream_loop', '-1', '-re', '-i', f.path];
}

/** Only for tests: forget every released file. */
export function clearMediaFiles() { FILES.clear(); }
