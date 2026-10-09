// Built-in camera bridge (larszu/lz-camera-bridge, bundled by scripts/build-camera-bridge.mjs into
// camera-bridge.cjs): Touch Shading and the camera list talk to it on ws://localhost:9700, exactly
// as to the LZ Camera Bridge app. It runs in the main process (one `require`, no second Node
// binary) and only once it is wanted – when Touch Shading or the camera dialog opens, or at start
// when cameras were set up before – because it listens in the network (tablets, Companion) and
// a firewall may ask about that.
//
// Never fatal: every failure becomes a status the page shows; the app always starts.
// Port 9700 already taken by an LZ Camera Bridge (its own app, a second machine's tunnel …):
// that one is used and named.

const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');

const PORT = 9700;
const COMPANION = { ws: 9701, http: 9702 };
const bundle = path.join(__dirname, 'camera-bridge.cjs');

let server = null;
/** @type {{ state: 'off' | 'running' | 'external' | 'missing' | 'busy' | 'failed', port: number, version: string, message?: string, configDir?: string }} */
let status = { state: 'off', port: PORT, version: '' };

function bundleVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'camera-bridge.json'), 'utf8')).version ?? ''; } catch { return ''; }
}

/** Can a server listen on `port` (all interfaces, like the bridge)? */
function portFree(port) {
  return new Promise((ok) => {
    const s = net.createServer();
    s.once('error', () => ok(false));
    s.once('listening', () => s.close(() => ok(true)));
    s.listen(port);
  });
}
/** `port` when free, else one the system picks. */
async function freeOr(port) {
  if (await portFree(port)) return port;
  return new Promise((ok) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); s.on('error', () => ok(0)); });
}

/** Whatever answers on the port: another LZ Camera Bridge (its /health), or something else. */
async function whoIsThere(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    return j && j.service === 'lz-camera-bridge' ? 'bridge' : 'other';
  } catch { return 'other'; }
}

/** Cameras set up in an earlier session (site.json of the bridge, in the app's user folder). */
function hasCameras(configDir) {
  try { const s = JSON.parse(fs.readFileSync(path.join(configDir, 'site.json'), 'utf8')); return Array.isArray(s.cameras) && s.cameras.length > 0; } catch { return false; }
}

let starting = null;
/** Start (once); resolves to the status. */
function start(configDir) {
  if (server || status.state === 'external') return Promise.resolve(status);
  starting ??= (async () => {
    const version = bundleVersion();
    if (!fs.existsSync(bundle)) { status = { state: 'missing', port: PORT, version }; return status; }
    if (!(await portFree(PORT))) {
      status = (await whoIsThere(PORT)) === 'bridge'
        ? { state: 'external', port: PORT, version }
        : { state: 'busy', port: PORT, version };
      return status;
    }
    try {
      fs.mkdirSync(configDir, { recursive: true });
      // the Companion feedback ports move aside when taken: in the bridge they listen from the
      // constructor on, and a taken port there would end the main process
      const ports = { ws: await freeOr(COMPANION.ws), http: await freeOr(COMPANION.http) };
      const { BridgeServer } = require(bundle);
      const s = new BridgeServer(PORT, ports, { persist: true, configDir });
      // errors of the listening sockets (port taken in the meantime …) become a status, not a crash
      const fail = (e) => { status = { state: 'failed', port: PORT, version, message: e && e.message ? e.message : String(e), configDir }; };
      s.httpServer?.on('error', fail);
      s.companion?.httpServer?.on('error', () => {});
      s.companion?.wss?.on('error', () => {});
      s.start();
      server = s;
      status = { state: 'running', port: PORT, version, configDir };
    } catch (e) {
      status = { state: 'failed', port: PORT, version, message: e && e.message ? e.message : String(e), configDir };
    }
    return status;
  })().finally(() => { starting = null; });
  return starting;
}

function stop() {
  try { server?.stop(); } catch { /* closing anyway */ }
  server = null;
  if (status.state === 'running') status = { ...status, state: 'off' };
}

/**
 * IPC for the page (preload: lzsDesktop.cameraBridge) and the start at launch when cameras exist.
 * @param {import('electron').IpcMain} ipcMain
 * @param {import('electron').App} app
 */
function setupCameraBridge(ipcMain, app) {
  const configDir = path.join(app.getPath('userData'), 'camera-bridge');
  ipcMain.handle('lzs:camera-bridge-status', () => status);
  ipcMain.handle('lzs:camera-bridge-start', () => start(configDir));
  if (hasCameras(configDir)) void start(configDir);
  app.on('will-quit', stop);
}

module.exports = { setupCameraBridge, start, stop, status: () => status };
