// Desktop shell: starts the bridge (server/index.mjs) inside the main process on a
// free local port and shows the UI from it. CommonJS on purpose – the packaged
// package.json is forced to `type: commonjs` (see electron-builder.js).
const { app, BrowserWindow, desktopCapturer, ipcMain, screen, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

if (!app.requestSingleInstanceLock()) app.quit();

let mainWindow = null;
let origin = '';

async function createWindow() {
  const { startBridge, ffmpegCandidates } = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'index.mjs')).href);
  const { port } = await startBridge({ port: 0, host: '127.0.0.1', dist: path.join(__dirname, '..', 'dist') });
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
app.whenReady().then(createWindow).catch((e) => {
  const { dialog } = require('electron');
  dialog.showErrorBox('LZ Scopes', `Start fehlgeschlagen:\n${e && e.stack ? e.stack : e}`);
  app.quit();
});
app.on('window-all-closed', () => app.quit());
