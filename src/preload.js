const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blocker', {
  state: () => ipcRenderer.invoke('ab:state'),
  setOn: (on) => ipcRenderer.invoke('ab:set-on', !!on),
  setProvider: (id) => ipcRenderer.invoke('ab:set-provider', String(id)),
  test: () => ipcRenderer.invoke('ab:test'),
  openPrivateDns: () => Promise.resolve(null),
  copy: (text) => ipcRenderer.invoke('ab:copy', String(text)),
  open: (url) => ipcRenderer.invoke('ab:open', String(url)),
  update: () => ipcRenderer.invoke('ab:update'),
  onState: (fn) => ipcRenderer.on('ab:state', (_e, s) => fn(s)),
});
