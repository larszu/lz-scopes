// Desktop shell: starts the bridge (server/index.mjs) inside the main process on a
// free local port and shows the UI from it. CommonJS on purpose – the packaged
// package.json is forced to `type: commonjs` (see electron-builder.js).
const { app, BrowserWindow, desktopCapturer, ipcMain, screen, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Own profile (localStorage, single-instance lock) for automated tests: LZS_USER_DATA.
if (process.env.LZS_USER_DATA) app.setPath('userData', process.env.LZS_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow = null;
let origin = '';

async function createWindow() {
  const { startBridge, ffmpegCandidates } = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'index.mjs')).href);
  // Fixed port 4192 when free, so Bitfocus Companion finds the control API. Not 4190:
  // that is on the Fetch "bad ports" list (sieve), Chrome and Node's fetch refuse it.
  // (LZS_PORT, LZS_HOST, LZS_CONTROL_TOKEN override); otherwise any free port.
  const dist = path.join(__dirname, '..', 'dist');
  const host = process.env.LZS_HOST || '127.0.0.1';
  let port;
  try { ({ port } = await startBridge({ port: Number(process.env.LZS_PORT) || 4192, host, dist })); }
  catch { ({ port } = await startBridge({ port: 0, host, dist })); }
  origin = `http://127.0.0.1:${port}`;
  console.log(`bridge ${origin}, ffmpeg: ${ffmpegCandidates()[0] ?? 'missing'}`);

  const ses = session.defaultSession;
  // Camera and screen capture only for our own page.
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(wc.getURL().startsWith(origin) && ['media', 'display-capture', 'fullscreen'].includes(permission)));
  ses.setDisplayMediaRequestHandler((_req, cb) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => cb({ video: sources[0] })).catch(() => cb({}));
  }, { useSystemPicker: true });

  mainWindow = new BrowserWindow({
    width: 1512, height: 900, minWidth: 900, minHeight: 560,
    title: 'LZ Scopes', backgroundColor: '#0b0c0e', autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  ipcMain.handle('lzs:displays', () => screen.getAllDisplays().map((d) => ({
    id: d.id, label: d.label, bounds: d.bounds, primary: d.id === screen.getPrimaryDisplay().id,
  })));
  ipcMain.handle('lzs:capture-sources', async () => {
    const list = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
    return list.map((s) => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() }));
  });
  // Web Bluetooth (Opple Light Master, #11): without this handler Electron cancels every
  // requestDevice(). The page filters by name, so take the first device the scan finds;
  // cancel after 20 s. UNTESTED: no Light Master was available.
  let btTimer = null;
  mainWindow.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    if (devices.length) { clearTimeout(btTimer); btTimer = null; callback(devices[0].deviceId); return; }
    if (!btTimer) btTimer = setTimeout(() => { btTimer = null; callback(''); }, 20000);
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origin) && url.includes('view=')) {
      // Scope/picture output on a chosen screen, fullscreen if asked.
      const q = new URL(url).searchParams;
      const d = screen.getAllDisplays().find((x) => String(x.id) === q.get('display'));
      const b = (d ?? screen.getDisplayMatching(mainWindow.getBounds())).bounds;
      const fs = q.get('fs') === '1' && !!d;
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          x: b.x + (fs ? 0 : 60), y: b.y + (fs ? 0 : 60), width: fs ? b.width : 1280, height: fs ? b.height : 720,
          fullscreen: fs, frame: !fs, backgroundColor: '#000000', autoHideMenuBar: true, title: 'LZ Scopes – Ausgabe',
          webPreferences: { contextIsolation: true, sandbox: true },
        },
      };
    }
    if (url.startsWith(origin) && url.includes('out=')) {
      // Pattern output: open on another display if there is one, e.g. the projector.
      const here = screen.getDisplayMatching(mainWindow.getBounds());
      const other = screen.getAllDisplays().find((d) => d.id !== here.id);
      const b = (other ?? here).workArea;
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          x: b.x + 40, y: b.y + 40, width: Math.min(1280, b.width - 80), height: Math.min(720, b.height - 80),
          backgroundColor: '#000000', autoHideMenuBar: true, title: 'LZ Scopes – Ausgabe', fullscreenable: true,
          webPreferences: { contextIsolation: true, sandbox: true },
        },
      };
    }
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(origin)) { e.preventDefault(); shell.openExternal(url); } });
  await mainWindow.loadURL(origin);
}

app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
// About box: the NDI SDK licence asks for the trademark notice here (docs/research/geraete-eingaenge.md)
app.setAboutPanelOptions({ applicationName: 'LZ Scopes', copyright: `© ${new Date().getFullYear()} Lars Zumpe`, credits: 'NDI® is a registered trademark of Vizrt NDI AB. https://ndi.video/' });

app.whenReady().then(createWindow).catch((e) => {
  const { dialog } = require('electron');
  dialog.showErrorBox('LZ Scopes', `Start fehlgeschlagen:\n${e && e.stack ? e.stack : e}`);
  app.quit();
});
app.on('window-all-closed', () => app.quit());
