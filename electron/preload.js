'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Channels the main process may push to renderers.
const RX = new Set([
  'button:show', 'button:hide',
  'preview:capture', 'preview:result', 'preview:error', 'preview:notice',
  'panel:state', 'panel:refresh',
]);

contextBridge.exposeInMainWorld('smp', {
  // ---- renderer -> main (request/response) ----
  openPreview: () => ipcRenderer.invoke('smp:open-preview'),
  closePreview: () => ipcRenderer.invoke('smp:close-preview'),
  hideButton: () => ipcRenderer.send('smp:hide-button'),
  setPanelState: (state) => ipcRenderer.invoke('smp:panel-state', state),

  save: (payload) => ipcRenderer.invoke('smp:save', payload),
  pickOutputFile: () => ipcRenderer.invoke('smp:pick-output'),
  taxonomy: () => ipcRenderer.invoke('smp:taxonomy'),
  listFolders: () => ipcRenderer.invoke('smp:list-folders'),
  listPrompts: (folderId) => ipcRenderer.invoke('smp:list-prompts', folderId),
  promptContent: (id) => ipcRenderer.invoke('smp:prompt-content', id),
  search: (q) => ipcRenderer.invoke('smp:search', q),
  copyPrompt: (id) => ipcRenderer.invoke('smp:copy', id),

  authStatus: () => ipcRenderer.invoke('smp:auth-status'),
  signIn: () => ipcRenderer.invoke('smp:sign-in'),
  signOut: () => ipcRenderer.invoke('smp:sign-out'),
  ollamaStatus: () => ipcRenderer.invoke('smp:ollama-status'),
  helperStatus: () => ipcRenderer.invoke('smp:helper-status'),
  settings: (patch) => ipcRenderer.invoke('smp:settings', patch),

  // ---- main -> renderer (events) ----
  on: (channel, cb) => {
    if (!RX.has(channel)) return () => {};
    const listener = (_e, data) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
