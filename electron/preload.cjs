// Minimal bridge to the main process: list this computer's screens for the output windows.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lzsDesktop', {
  displays: () => ipcRenderer.invoke('lzs:displays'),
  /** Windows and screens for capture (Resolve, Lightroom, Capture One …) with thumbnails. */
  captureSources: () => ipcRenderer.invoke('lzs:capture-sources'),
});
