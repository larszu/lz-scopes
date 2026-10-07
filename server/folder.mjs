// Watch folders in the bridge: the newest still in a folder becomes the picture – exports
// from Lightroom, Capture One or Resolve (stills), also on a remote bridge machine.
//
// Only folders released on the command line (`--watch-dir <dir>`, repeatable) or in
// LZS_WATCH_DIRS (separated by the path delimiter) can be opened; a client addresses them
// by name (`folder:<name>`), never by path. Decoding runs through ffmpeg (TIFF 8/16 bit,
// DPX 10/12/16 bit, PNG 8/16 bit, JPEG, WebP, OpenEXR), output as in the stream path.

import { spawn } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { basename, delimiter, extname, join, resolve } from 'node:path';
import { BridgeError, bmsg, toMsg } from './messages.mjs';

export const STILL_EXTENSIONS = ['.tif', '.tiff', '.dpx', '.png', '.jpg', '.jpeg', '.webp', '.exr'];

/** Released folders: [{ name, dir }], names unique (suffix -2, -3 …). */
export function watchRoots(argv = process.argv.slice(2), env = process.env) {
  const dirs = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--watch-dir' && argv[i + 1]) dirs.push(argv[++i]);
  for (const d of (env.LZS_WATCH_DIRS ?? '').split(delimiter)) if (d.trim()) dirs.push(d.trim());
  const out = [];
  for (const d of dirs) {
    const dir = resolve(d);
    if (out.some((r) => r.dir === dir)) continue;
    const base = (basename(dir) || 'folder').replace(/[^\w .-]/g, '_').slice(0, 60);
    let name = base, k = 2;
    while (out.some((r) => r.name === name)) name = `${base}-${k++}`;
    out.push({ name, dir });
  }
  return out;
}

/** folder:<name> → released root or null (no paths, no traversal). */
export function resolveFolder(url, roots) {
  const m = /^folder:(.{1,80})$/.exec(url ?? '');
  return m ? roots.find((r) => r.name === m[1]) ?? null : null;
}

/** Newest still (by modification time) in a folder, not recursive; hidden files ignored. */
export async function newestStill(dir) {
  let best = null;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (!e.isFile() || e.name.startsWith('.') || !STILL_EXTENSIONS.includes(extname(e.name).toLowerCase())) continue;
    const st = await stat(join(dir, e.name)).catch(() => null);
    if (st && (!best || st.mtimeMs > best.mtimeMs)) best = { path: join(dir, e.name), name: e.name, mtimeMs: st.mtimeMs, size: st.size };
  }
  return best;
}

/** Colour tags from ffmpeg's banner line of a still (pix_fmt, transfer for EXR). */
function stillInfo(stderr) {
  const line = stderr.split('\n').find((l) => /Stream #\d+:\d+.*: Video: /.test(l)) ?? '';
  const size = /,\s*(\d{2,5})x(\d{2,5})\b/.exec(line);
  const codec = /Video: ([\w-]+)/.exec(line)?.[1] ?? '';
  const pixFmt = /Video: [^,]+,\s*(\w+)/.exec(line)?.[1] ?? '';
  return size ? { width: +size[1], height: +size[2], codec, pixFmt } : null;
}

/**
 * Stream a watch folder to a WebSocket (frame protocol 1). A new picture is sent when the
 * newest file changes and its size has been stable for one poll (file completely written).
 */
export function startFolderStream(ws, { root, params, ctx, pollMs = 500 }) {
  const depth = params.get('depth') === '8' ? 8 : 16;
  const maxWidth = Math.min(3840, Math.max(0, Number(params.get('width') ?? 960) || 0));
  const opts = ctx.deviceOptions(params);
  let lastKey = '', pending = '', busy = false, closed = false, sent = 0, sentInfo = '';
  const status = (m) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'stats', sent, dropped: 0, ...toMsg(m) })); };

  const decode = (file) => new Promise((ok, fail) => {
    // probe size first (banner), then decode scaled in one go
    const probe = spawn(ctx.ffmpeg, ['-hide_banner', '-i', file.path], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    probe.stderr.on('data', (d) => { err += d; });
    probe.on('error', fail);
    probe.on('close', () => {
      const info = stillInfo(err);
      if (!info) return fail(new BridgeError('folder.unreadable', `${file.name}: no readable picture`, { file: file.name }));
      const { width, height } = ctx.outputSize(info.width, info.height, maxWidth);
      const rgb = /^(gbr|rgb|bgr|argb|abgr|rgba|bgra|gray|ya|pal)/.test(info.pixFmt) || info.codec === 'exr';
      const { decodeMatrix, decodeRange } = ctx.applyDecodeOverride(ctx.decodeParams({ matrix: 'unknown', range: /^yuvj/.test(info.pixFmt) ? 'pc' : 'unknown', height: info.height }), opts);
      const vf = `scale=${width}:${height}:flags=area${rgb ? '' : `:in_color_matrix=${decodeMatrix}:in_range=${decodeRange}`}`;
      const p = spawn(ctx.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file.path, '-frames:v', '1', '-vf', vf, '-pix_fmt', depth === 16 ? 'rgba64le' : 'rgba', '-f', 'rawvideo', 'pipe:1'],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      const chunks = [];
      let perr = '';
      p.stdout.on('data', (d) => chunks.push(d));
      p.stderr.on('data', (d) => { perr += d; });
      p.on('error', fail);
      p.on('close', (code) => {
        const data = Buffer.concat(chunks);
        if (code || data.length !== width * height * 4 * (depth / 8)) return fail(new Error(`${file.name}: ${perr.trim().split('\n').pop() || 'decoding failed'}`));
        ok({ info, width, height, data, decodeMatrix: rgb ? 'rgb' : decodeMatrix, linear: info.codec === 'exr' });
      });
    });
  });

  const poll = async () => {
    if (busy || closed) return;
    busy = true;
    try {
      const f = await newestStill(root.dir);
      if (!f) { if (lastKey !== 'none') status(bmsg('folder.empty', `${root.name}: no picture yet (TIFF, DPX, PNG, JPEG, WebP, EXR)`, { folder: root.name })); lastKey = 'none'; return; }
      const key = `${f.path}:${f.mtimeMs}:${f.size}`;
      if (key === lastKey) return;
      if (key !== pending) { pending = key; return; } // wait one poll: size/time must be stable
      const pic = await decode(f);
      lastKey = key;
      if (ws.readyState !== ws.OPEN) return;
      const infoMsg = JSON.stringify({
        type: 'info', width: pic.width, height: pic.height, depth, fps: 0, sourceWidth: pic.info.width, sourceHeight: pic.info.height,
        codec: `Folder ${root.name} · ${pic.info.codec}`, pixFmt: pic.info.pixFmt, decodeMatrix: pic.decodeMatrix,
        transfer: pic.linear ? 'linear' : 'unknown', primaries: 'unknown', matrix: 'unknown', range: 'pc',
      });
      if (infoMsg !== sentInfo) { ws.send(infoMsg); sentInfo = infoMsg; }
      ws.send(pic.data, { binary: true });
      sent++;
      status(`${root.name}/${f.name} · ${pic.info.width}×${pic.info.height} ${pic.info.pixFmt}`);
    } catch (e) {
      status(e);
    } finally { busy = false; }
  };
  const timer = setInterval(() => { poll(); }, pollMs);
  poll();
  ws.on('close', () => { closed = true; clearInterval(timer); });
}
