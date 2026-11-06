const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ytbla', {
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  settings: () => ipcRenderer.sendSync('get-settings'),
  saveSettings: (patch) => ipcRenderer.send('save-settings', patch),
  setPickerOpen: (open) => ipcRenderer.send('picker-open', open),
});
