// Minimal bridge to the main process: list this computer's screens for the output windows.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lzsDesktop', {
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
  /** Release a folder to the bridge's watch-folder input (native dialog); → { name, url } or null. */
  watchFolder: () => ipcRenderer.invoke('lzs:watch-folder'),
});
