// Automatic update of the Linux AppImage (electron-updater, feed latest-linux.yml of the GitHub
// release). Only the AppImage can replace itself; the deb is updated by the user (apt/dpkg),
// macOS (ad-hoc signed, Squirrel.Mac refuses it) and Windows keep the manual download.
// Checks once after start, downloads in the background, installs on quit, and says so in a
// system notification. Off in tests (LZS_USER_DATA) and with LZS_NO_UPDATE=1.
const { app, Notification } = require('electron');
const { text } = require('./i18n.cjs');

/** Whether this process may update itself. */
function updateAllowed(env = process.env, platform = process.platform, packaged = app?.isPackaged) {
  return platform === 'linux' && !!env.APPIMAGE && !!packaged && !env.LZS_USER_DATA && env.LZS_NO_UPDATE !== '1';
}

function setupUpdater() {
  if (!updateAllowed()) return false;
  let autoUpdater;
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { console.warn(`updater: ${e.message}`); return false; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (e) => console.warn(`updater: ${e && e.message ? e.message : e}`));
  autoUpdater.on('update-downloaded', (info) => {
    if (Notification.isSupported()) new Notification({ title: text('updateReady', info.version), body: text('updateReadyBody') }).show();
  });
  autoUpdater.checkForUpdates().catch((e) => console.warn(`updater: ${e.message}`));
  return true;
}

module.exports = { setupUpdater, updateAllowed };
