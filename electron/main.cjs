// Desktop shell: starts the bridge (server/index.mjs) inside the main process on a
// free local port and shows the UI from it. CommonJS on purpose – the packaged
// package.json is forced to `type: commonjs` (see electron-builder.js).
const { app, BrowserWindow, desktopCapturer, ipcMain, screen, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { setupDisplayProfiles } = require('./displayProfile.cjs');
const { setAppMenu } = require('./menu.cjs');
const { text, setLang } = require('./i18n.cjs');
const { registerScheme, setupTestVideos } = require('./testVideos.cjs');
const { setupUpdater } = require('./updater.cjs');

// test videos (#52) are played over lzs-media://; schemes must be registered before ready
registerScheme();

// Own profile (localStorage, single-instance lock) for automated tests: LZS_USER_DATA.
if (process.env.LZS_USER_DATA) app.setPath('userData', process.env.LZS_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();
// UI language (#94): the page follows app.getLocale() unless the user chose one in the
// settings. LZS_LANG (de, en, en-US …) pins the locale, e.g. for the E2E tests.
if (process.env.LZS_LANG) app.commandLine.appendSwitch('lang', process.env.LZS_LANG);
// LZS_HIDDEN=1: main window never shown, no Dock icon, no focus taken (automated checks
// that need no pixels, e.g. the native menu in e2e/ui-audit.spec.ts).
const HIDDEN = process.env.LZS_HIDDEN === '1';
// Linux/Wayland: screen and window capture through the xdg-desktop-portal (PipeWire). Chromium
// enables it by default on current versions; the switch keeps it on for older ones and is a
// no-op under X11 (docs/research/linux.md).
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');
  // Web Bluetooth (Opple) is "experimental" on Linux in Chromium (runtime_enabled_features.json5,
  // WebBluetoothCG implementation-status.md: partial, BlueZ 5.41+); enable only that feature.
  // Untested on Linux.
  app.commandLine.appendSwitch('enable-blink-features', 'WebBluetooth');
}
ipcMain.on('lzs:locale', (e) => { e.returnValue = app.getLocale(); });

let mainWindow = null;
let origin = '';

async function createWindow() {
  const { startBridge, ffmpegCandidates, addWatchDir } = await import(pathToFileURL(path.join(__dirname, '..', 'server', 'index.mjs')).href);
  // Fixed port 4192 when free, so Bitfocus Companion finds the control API. Not 4190:
  // that is on the Fetch "bad ports" list (sieve), Chrome and Node's fetch refuse it.
  // (LZS_PORT, LZS_HOST, LZS_CONTROL_TOKEN override); otherwise any free port.
  const dist = path.join(__dirname, '..', 'dist');
  const host = process.env.LZS_HOST || '127.0.0.1';
  let port;
  try { ({ port } = await startBridge({ port: Number(process.env.LZS_PORT) || 4192, host, dist, configDir: app.getPath('userData') })); }
  catch { ({ port } = await startBridge({ port: 0, host, dist, configDir: app.getPath('userData') })); }
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
    // menu bar visible on Windows/Linux (app menu, #53); macOS shows it in the system bar
    title: 'LZ Scopes', backgroundColor: '#0b0c0e', autoHideMenuBar: false, show: !HIDDEN,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  // Application menu (#53): the page sends its menu model, clicks go back as command ids.
  ipcMain.on('lzs:menu-set', (e, model, lang) => {
    if (e.sender !== mainWindow.webContents) return;
    setLang(lang);
    setAppMenu(model, (id) => { if (!mainWindow.isDestroyed()) mainWindow.webContents.send('lzs:menu', id); });
  });
  // Test videos (#52): download, check, cache in userData, play over lzs-media://
  setupTestVideos(() => mainWindow);
  // System display profile / monitor mode (#17): restored on quit and after a crash.
  setupDisplayProfiles(ipcMain, app);
  // feedback report: hardware, OS and GPU – no host name, user name or paths
  ipcMain.handle('lzs:sysinfo', async () => {
    const os = require('node:os');
    const cpus = os.cpus();
    let gpus = [];
    try {
      const g = await app.getGPUInfo('basic');
      gpus = (g?.gpuDevice ?? []).map((d) => ({ vendorId: d.vendorId, deviceId: d.deviceId, active: !!d.active, driver: d.driverVersion ?? null }));
    } catch { /* not available */ }
    const gpu = gpus.find((d) => d.active) ?? gpus[0] ?? null;
    return {
      // macOS 26.0 / Windows 11 Pro 10.0.26100 / Linux 6.8 (Ubuntu …): readable, without the kernel build string
      os: process.platform === 'darwin' ? `macOS ${process.getSystemVersion()}`
        : process.platform === 'win32' ? `${os.version()} ${process.getSystemVersion()}`
          : `Linux ${os.release()} (${os.version()})`,
      arch: os.arch(), cpu: cpus[0]?.model?.trim() ?? '', cores: cpus.length, ramGb: Math.round(os.totalmem() / 2 ** 30),
      runtime: `Electron ${process.versions.electron} · Chromium ${process.versions.chrome} · Node ${process.versions.node}`,
      platform: process.platform, gpu, gpus, gpuFeatures: app.getGPUFeatureStatus(),
      screens: screen.getAllDisplays().map((d) => ({ width: d.size.width, height: d.size.height, scale: d.scaleFactor, hz: d.displayFrequency ?? 0, primary: d.id === screen.getPrimaryDisplay().id })),
    };
  });
  ipcMain.handle('lzs:displays', () => screen.getAllDisplays().map((d) => ({
    id: d.id, label: d.label, bounds: d.bounds, primary: d.id === screen.getPrimaryDisplay().id,
  })));
  // watch folder in the bridge (16-bit TIFF/DPX/EXR exports of Lightroom, Capture One, Resolve)
  ipcMain.handle('lzs:watch-folder', async () => {
    const { dialog } = require('electron');
    const r = await dialog.showOpenDialog(mainWindow, { title: text('watchFolder'), properties: ['openDirectory'] });
    return r.canceled || !r.filePaths[0] ? null : addWatchDir(r.filePaths[0]);
  });
  ipcMain.handle('lzs:capture-sources', async () => {
    const list = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
    return list.map((s) => ({ id: s.id, name: s.name, thumb: s.thumbnail.toDataURL() }));
  });
  // Web Bluetooth (Opple Light Master, #11): without this handler Electron cancels every
  // requestDevice(). Chromium fires the event again whenever the scan finds more devices; the
  // list goes to the page (lzs:bt-devices), where the user picks one (lzs:bt-select). A
  // remembered device can be picked in advance (lzs:bt-prefer): it is taken as soon as the scan
  // sees it. The scan is cancelled after 60 s. Checked with a Light Master 3 (30.09.2026).
  // Chromium cancels requestDevice() at once when the window is not focused.
  let bt = null;
  let btPrefer = null;
  const btSend = (m) => { if (!mainWindow.isDestroyed()) mainWindow.webContents.send('lzs:bt-devices', m); };
  const btFinish = (id) => {
    if (!bt) return false;
    const b = bt; bt = null; clearTimeout(b.timer);
    btSend({ devices: [], scanning: false, done: true });
    b.callback(id || '');
    return true;
  };
  ipcMain.handle('lzs:bt-select', (_e, id) => btFinish(String(id || '')));
  ipcMain.handle('lzs:bt-prefer', (_e, id) => { btPrefer = id ? String(id) : null; });
  mainWindow.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    if (!bt) bt = { callback, found: new Map(), timer: setTimeout(() => { btPrefer = null; btFinish(''); }, 60000) };
    bt.callback = callback;
    for (const d of devices) bt.found.set(d.deviceId, d.deviceName || '');
    if (btPrefer && bt.found.has(btPrefer)) { const id = btPrefer; btPrefer = null; btFinish(id); return; }
    btSend({ devices: [...bt.found].map(([id, name]) => ({ id, name })), scanning: true });
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
          fullscreen: fs, frame: !fs, backgroundColor: '#000000', autoHideMenuBar: true, title: text('output'),
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
          backgroundColor: '#000000', autoHideMenuBar: true, title: text('output'), fullscreenable: true,
          webPreferences: { contextIsolation: true, sandbox: true },
        },
      };
    }
    if (/^(https?:\/\/|mailto:)/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(origin)) { e.preventDefault(); shell.openExternal(url); } });
  await mainWindow.loadURL(origin);
  // Linux AppImage only: update in the background from the GitHub release (latest-linux.yml)
  setupUpdater();
}

app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
// About box: the NDI SDK licence asks for the trademark notice here (docs/research/geraete-eingaenge.md)
app.setAboutPanelOptions({ applicationName: 'LZ Scopes', copyright: `© ${new Date().getFullYear()} Lars Zumpe`, credits: 'NDI® is a registered trademark of Vizrt NDI AB. https://ndi.video/' });

app.whenReady().then(() => { if (HIDDEN && process.platform === 'darwin') app.setActivationPolicy('accessory'); return createWindow(); }).catch((e) => {
  const { dialog } = require('electron');
  dialog.showErrorBox('LZ Scopes', `${text('startFailed')}\n${e && e.stack ? e.stack : e}`);
  app.quit();
});
app.on('window-all-closed', () => app.quit());
