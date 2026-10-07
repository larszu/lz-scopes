// Minimal bridge to the main process: list this computer's screens for the output windows.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lzsDesktop', {
  /** app.getLocale() (#94): the UI language when the user has not chosen one. */
  locale: (() => { try { return String(ipcRenderer.sendSync('lzs:locale') || ''); } catch { return ''; } })(),
  displays: () => ipcRenderer.invoke('lzs:displays'),
  /** Windows and screens for capture (Resolve, Lightroom, Capture One …) with thumbnails. */
  captureSources: () => ipcRenderer.invoke('lzs:capture-sources'),
  /** System display profile and DDC/CI (#17); every call returns { ok, value | error }. */
  displayProfile: {
    support: () => ipcRenderer.invoke('lzs:profile-support'),
    list: () => ipcRenderer.invoke('lzs:profile-list'),
    set: (id, profile) => ipcRenderer.invoke('lzs:profile-set', id, profile),
    restore: (id) => ipcRenderer.invoke('lzs:profile-restore', id),
    ddc: (id, code, value) => ipcRenderer.invoke('lzs:ddc-set', id, code, value),
  },
  /** Web Bluetooth device list (Opple Light Master, #11): scan results, pick one, pre-select a remembered id. */
  bluetooth: {
    onDevices: (cb) => { const f = (_e, m) => cb(m); ipcRenderer.on('lzs:bt-devices', f); return () => ipcRenderer.removeListener('lzs:bt-devices', f); },
    select: (id) => ipcRenderer.invoke('lzs:bt-select', id),
    prefer: (id) => ipcRenderer.invoke('lzs:bt-prefer', id),
  },
  /** Release a folder to the bridge's watch-folder input (native dialog); → { name, url } or null. */
  watchFolder: () => ipcRenderer.invoke('lzs:watch-folder'),
  /** Native application menu (#53): set the model, receive the chosen command ids. */
  menu: {
    set: (model) => ipcRenderer.send('lzs:menu-set', model),
    onCommand: (cb) => { const f = (_e, id) => cb(String(id)); ipcRenderer.on('lzs:menu', f); return () => ipcRenderer.removeListener('lzs:menu', f); },
  },
});
