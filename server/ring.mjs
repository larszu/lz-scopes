// Ring buffer of one bridge source ("save the last 60 s", #140 step 5, docs/research/aufzeichnung.md).
//
// A third output of the source's ffmpeg writes segments of about 2 s in turn into a fixed set
// of files (segment muxer, `segment_wrap`), always on disk, never in RAM. "Save" copies the
// segments of the wanted window aside and joins them without re-encoding (concat demuxer,
// `-c copy`), starting at the last key frame before "now − length", optionally with a
// post-roll. All sources of one press get the same time mark; the window is shifted by the
// latency of each source so that all files start at the same moment of the scene.

import { spawn } from 'node:child_process';
import { constants, existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Length of one ring segment in seconds. */
export const RING_SEGMENT = 2;
/** Extra seconds kept beyond length + post-roll, so the oldest needed file is not overwritten while it is copied. */
export const RING_MARGIN = 10;

/** Number of files in the ring for a window of `pre` + `post` seconds. */
export function ringWrap(pre, post, seg = RING_SEGMENT, margin = RING_MARGIN) {
  return Math.ceil((Math.max(1, pre) + Math.max(0, post) + margin) / seg) + 2;
}

/**
 * Window of one save in arrival time of this source (wall clock ms): a frame that arrives at
 * wall time w shows the scene at w − latency, so the scene window [at − pre, at + post] is
 * [at − pre + latency, at + post + latency] here.
 */
export function saveWindow(at, pre, post, latencyMs = 0) {
  const l = Number.isFinite(latencyMs) ? Math.max(0, latencyMs) : 0;
  return { from: at - pre * 1000 + l, to: at + post * 1000 + l };
}

/**
 * Ring entries ({ file, startMs, endMs, gen }, wall clock) needed for [from, to], oldest first,
 * with the offsets into the first and last file (seconds). Each segment begins with a key frame
 * (copy: the muxer cuts at key frames; encode: intra codecs or forced key frames).
 * Returns null when the ring does not reach back to `from` (window starts before the oldest entry).
 */
export function selectSegments(entries, from, to) {
  const list = [...entries].sort((a, b) => a.startMs - b.startMs).filter((e) => e.endMs > from && e.startMs < to);
  if (!list.length) return null;
  const first = list[0], last = list[list.length - 1];
  return {
    items: list,
    inpoint: Math.max(0, (from - first.startMs) / 1000),
    outpoint: Math.max(0, (to - last.startMs) / 1000),
    complete: first.startMs <= from + 1 && last.endMs >= to - 1,
  };
}

/** Last key frame at or before `t` (seconds) in a sorted list of key frame times; the first one if none. */
export function lastKeyframeBefore(keys, t) {
  let best = keys.length ? keys[0] : 0;
  for (const k of keys) { if (k <= t + 1e-6) best = k; else break; }
  return best;
}

/** concat demuxer list: `file '…'` with inpoint/outpoint (ffmpeg-formats, concat: quote ' as '\''). */
export function concatList(items) {
  const q = (p) => `'${String(p).replace(/'/g, "'\\''")}'`;
  return items.map((it) => [`file ${q(it.path)}`, ...(it.inpoint ? [`inpoint ${it.inpoint.toFixed(6)}`] : []), ...(it.outpoint !== undefined ? [`outpoint ${it.outpoint.toFixed(6)}`] : [])].join('\n')).join('\n') + '\n';
}

/** Ring entries of the files a new segment line makes stale (the file just reported is rewritten next round). */
export function dropOverwritten(entries, file, wrap, gen) {
  const m = /^(.*_)(\d+)(\.\w+)$/.exec(file);
  const next = m ? `${m[1]}${String((Number(m[2]) + 1) % wrap).padStart(m[2].length, '0')}${m[3]}` : '';
  return entries.filter((e) => !(e.gen === gen && (e.file === file || e.file === next)));
}

function run(bin, args, timeoutMs = 120000) {
  return new Promise((ok) => {
    let err = '', out = '';
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', (e) => { clearTimeout(timer); ok({ code: -1, out, err: e.message }); });
    p.on('close', (code) => { clearTimeout(timer); ok({ code, out, err }); });
  });
}

/** Key frame times (s) of the video in one file (ffprobe), sorted. */
export async function keyframes(ffprobe, file) {
  if (!ffprobe) return [];
  const r = await run(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', file], 30000);
  return r.out.split('\n').map((l) => l.split(',')).filter(([t, f]) => f?.includes('K') && t !== 'N/A').map(([t]) => Number(t)).filter(Number.isFinite).sort((a, b) => a - b);
}

/**
 * Join the selected ring segments into `out` without re-encoding. The files are copied aside
 * first (APFS/Btrfs: clone, instant), so the ring may go on overwriting meanwhile.
 * → { ok, startOffset (s, the key frame the file begins with), error? }
 */
export async function joinSegments({ ffmpeg, ffprobe, dir, sel, out }) {
  const stage = join(dir, `save-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await mkdir(stage, { recursive: true });
  try {
    const items = [];
    for (let i = 0; i < sel.items.length; i++) {
      const src = join(dir, sel.items[i].file);
      if (!existsSync(src)) continue;
      const dst = join(stage, `${String(i).padStart(4, '0')}_${sel.items[i].file}`);
      await copyFile(src, dst, constants.COPYFILE_FICLONE);
      items.push({ path: dst, entry: sel.items[i] });
    }
    if (!items.length) return { ok: false, error: 'no segments' };
    // the file begins at the last key frame before the window start ("ab dem letzten Keyframe vor jetzt − Länge")
    const keys = await keyframes(ffprobe, items[0].path);
    const start = keys.length ? lastKeyframeBefore(keys, sel.inpoint) : 0;
    const list = items.map((it, i) => ({
      path: it.path,
      ...(i === 0 && start > 0 ? { inpoint: start } : {}),
      ...(i === items.length - 1 && it.entry === sel.items[sel.items.length - 1] && sel.outpoint < (it.entry.endMs - it.entry.startMs) / 1000 ? { outpoint: sel.outpoint } : {}),
    }));
    const listFile = join(stage, 'list.txt');
    await writeFile(listFile, concatList(list));
    const r = await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-map', '0', '-c', 'copy', out]);
    return r.code === 0 ? { ok: true, startOffset: start, files: items.length } : { ok: false, error: r.err.trim().split('\n').pop() || `ffmpeg ${r.code}` };
  } finally {
    await rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

/** Delete the ring folder of a source (its own segment files only). */
export async function clearRing(dir) {
  try {
    for (const f of await readdir(dir)) if (/^ring\d*_\d+\.mkv$|^ring\d*\.csv$/.test(f)) await rm(join(dir, f), { force: true });
    await rmdir(dir).catch(() => {});
  } catch { /* gone */ }
}
