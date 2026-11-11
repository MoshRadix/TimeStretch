const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mto', {
  openAudio: () => ipcRenderer.invoke('audio:open'),
  restoreAudio: () => ipcRenderer.invoke('audio:restore'),
  readAudioChunk: (filePath, offset, length) => ipcRenderer.invoke('audio:read-chunk', { filePath, offset, length }),
  generateWaveform: (filePath, duration) => ipcRenderer.invoke('waveform:generate', { filePath, duration }),
  savePlaybackPosition: (position) => ipcRenderer.send('playback:position', position),
  getShortcuts: () => ipcRenderer.invoke('settings:get'),
  saveShortcuts: (shortcuts) => ipcRenderer.invoke('settings:save', shortcuts),
  onGlobalAction: (callback) => { const handler = (_event, action) => callback(action); ipcRenderer.on('global-action', handler); return () => ipcRenderer.removeListener('global-action', handler); },
  setPlaybackActive: (active) => ipcRenderer.send('playback:active', active),
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  openDeveloperProfile: () => ipcRenderer.invoke('app:open-developer-profile'),
  getUpdateState: () => ipcRenderer.invoke('updates:get-state'),
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  onUpdateStatus: (callback) => { const handler = (_event, update) => callback(update); ipcRenderer.on('updates:status', handler); return () => ipcRenderer.removeListener('updates:status', handler); }
});
