const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('radarApp', {
  resize: (h) => ipcRenderer.send('resize', h),
  openDashboard: () => ipcRenderer.send('dashboard'),
  menu: () => ipcRenderer.send('menu'),
  badge: (c) => ipcRenderer.send('badge', c),
});
