// Test videos (#52): download from the official server on request, check size and SHA-256,
// unpack a single-entry ZIP (stored or deflate, CRC-32 checked) and keep the video in
// <userData>/testvideos. The page plays it over lzs-media://video/<file> (range requests,
// CORS for WebGL). Only URLs under ALLOWED and only with a SHA-256 are downloaded.
const { app, ipcMain, protocol } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { unzipSingle } = require('./unzip.cjs');

const ALLOWED = ['https://download.blender.org/peach/bigbuckbunny_movies/', 'https://download.blender.org/demo/movies/BBB/', 'https://s3.amazonaws.com/download.opencontent.netflix.com/'];
const SCHEME = 'lzs-media';

/** must run before app ready */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);
}

const dir = () => path.join(app.getPath('userData'), 'testvideos');
const safeName = (n) => String(n).replace(/[^\w.-]/g, '_').slice(0, 120);
const fileFor = (v) => path.join(dir(), safeName(v.zip ? v.zip.name : path.basename(new URL(v.url).pathname)));

function validEntry(v) {
  return v && typeof v.id === 'string' && typeof v.url === 'string' && ALLOWED.some((p) => v.url.startsWith(p))
    && /^[0-9a-f]{64}$/.test(v.sha256 || '') && Number.isFinite(v.bytes) && v.bytes > 0
    && (!v.zip || (typeof v.zip.name === 'string' && /^[0-9a-f]{8}$/.test(v.zip.crc32 || '') && Number.isFinite(v.zip.size)));
}

const jobs = new Map();

async function download(v, send) {
  await fs.promises.mkdir(dir(), { recursive: true });
  const final = fileFor(v), part = `${final}.download`;
  const ac = new AbortController();
  jobs.set(v.id, ac);
  try {
    const r = await fetch(v.url, { signal: ac.signal });
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
    const hash = crypto.createHash('sha256');
    let got = 0, last = 0;
    const meter = new Transform({ transform(chunk, _e, cb) {
      hash.update(chunk); got += chunk.length;
      const now = Date.now();
      if (now - last > 250) { last = now; send({ id: v.id, state: 'loading', got, total: v.bytes }); }
      cb(null, chunk);
    } });
    await pipeline(Readable.fromWeb(r.body), meter, fs.createWriteStream(part));
    if (got !== v.bytes) throw new Error(`Größe ${got} statt ${v.bytes} Bytes – Datei auf dem Server geändert?`);
    const sha = hash.digest('hex');
    if (sha !== v.sha256) throw new Error('SHA-256 stimmt nicht – Datei auf dem Server geändert? Nicht verwendet.');
    send({ id: v.id, state: 'verifying', got, total: v.bytes });
    if (v.zip) { await unzipSingle(part, final, v.zip); await fs.promises.rm(part, { force: true }); }
    else await fs.promises.rename(part, final);
    send({ id: v.id, state: 'done', file: path.basename(final) });
    return { ok: true, file: path.basename(final) };
  } catch (e) {
    await fs.promises.rm(part, { force: true }).catch(() => {});
    await fs.promises.rm(final, { force: true }).catch(() => {});
    const msg = ac.signal.aborted ? 'abgebrochen' : (e && e.message) || String(e);
    send({ id: v.id, state: 'error', error: msg });
    return { ok: false, error: msg };
  } finally { jobs.delete(v.id); }
}

/** Range-capable file response for <video>. */
async function serve(req) {
  const name = safeName(decodeURIComponent(new URL(req.url).pathname.replace(/^\//, '')));
  const file = path.join(dir(), name);
  let st;
  try { st = await fs.promises.stat(file); } catch { return new Response('not found', { status: 404 }); }
  const type = /\.mov$/i.test(name) ? 'video/quicktime' : 'video/mp4';
  const base = { 'content-type': type, 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  if (!m) return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...base, 'content-length': String(st.size) } });
  const start = m[1] ? Number(m[1]) : Math.max(0, st.size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
  if (start >= st.size || end < start) return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${st.size}` } });
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
    status: 206, headers: { ...base, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${st.size}` },
  });
}

/** IPC and protocol; call after app ready with the main window. */
function setupTestVideos(getWindow) {
  protocol.handle(SCHEME, serve);
  const send = (m) => { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send('lzs:tv-progress', m); };
  ipcMain.handle('lzs:tv-status', async (_e, list) => {
    const out = {};
    for (const v of Array.isArray(list) ? list : []) {
      if (!validEntry(v)) continue;
      const f = fileFor(v);
      out[v.id] = jobs.has(v.id) ? { state: 'loading' } : fs.existsSync(f) ? { state: 'done', file: path.basename(f), bytes: fs.statSync(f).size } : { state: 'none' };
    }
    return out;
  });
  ipcMain.handle('lzs:tv-download', (_e, v) => {
    if (!validEntry(v)) return { ok: false, error: 'Eintrag ungültig oder Quelle nicht erlaubt' };
    if (jobs.has(v.id)) return { ok: false, error: 'läuft schon' };
    return download(v, send);
  });
  ipcMain.handle('lzs:tv-cancel', (_e, id) => { jobs.get(String(id))?.abort(); return true; });
  ipcMain.handle('lzs:tv-delete', async (_e, v) => {
    if (!validEntry(v)) return false;
    await fs.promises.rm(fileFor(v), { force: true });
    return true;
  });
  ipcMain.handle('lzs:tv-folder', () => dir());
}

module.exports = { registerScheme, setupTestVideos, SCHEME };
