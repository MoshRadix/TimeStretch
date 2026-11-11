const { app, BrowserWindow, dialog, globalShortcut, ipcMain, protocol, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { Readable } = require('node:stream');
const path = require('node:path');
const execFileAsync = promisify(execFile);

let mainWindow;
let lastAudioPath = null;
let selectedAudioId = null;
let savedPosition = 0;
let playbackWrite = Promise.resolve();
let playbackActive = false;
let updateDownloaded = false;
let installingUpdate = false;
let updateState = { status: 'idle' };
let updateChecksStarted = false;
let updateCheckPromise = null;
const defaults = { playPause: 'Alt+Space', seekBackward: 'Alt+Left', seekForward: 'Alt+Right', speedDown: 'Alt+Down', speedUp: 'Alt+Up', pitchDown: 'Ctrl+Alt+Left', pitchUp: 'Ctrl+Alt+Right' };
let shortcuts = { ...defaults };

function audioUrl() {
  selectedAudioId = randomUUID();
  return `mto-audio://selected/${selectedAudioId}`;
}

protocol.registerSchemesAsPrivileged([{ scheme: 'mto-audio', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function playbackPath() { return path.join(app.getPath('userData'), 'last-playback.json'); }
async function loadPlaybackState() {
  try {
    const saved = JSON.parse(await fs.readFile(playbackPath(), 'utf8'));
    if (typeof saved.path === 'string') lastAudioPath = saved.path;
    if (Number.isFinite(saved.position) && saved.position >= 0) savedPosition = saved.position;
  } catch { lastAudioPath = null; savedPosition = 0; }
}
function savePlaybackState(position = savedPosition) {
  if (!lastAudioPath) return;
  savedPosition = Number.isFinite(position) ? Math.max(0, position) : 0;
  const snapshot = JSON.stringify({ path: lastAudioPath, position: savedPosition });
  playbackWrite = playbackWrite.then(() => fs.writeFile(playbackPath(), snapshot, 'utf8')).catch((error) => console.error('Could not save playback position:', error));
}
async function loadSettings() {
  try {
    const saved = JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
    const previous = saved.shortcuts || {};
    if (!previous.seekBackward && previous.pitchDown === 'Alt+Left') previous.pitchDown = defaults.pitchDown;
    if (!previous.seekForward && previous.pitchUp === 'Alt+Right') previous.pitchUp = defaults.pitchUp;
    shortcuts = { ...defaults, ...previous };
  } catch { shortcuts = { ...defaults }; }
}
function registerShortcuts(next = shortcuts) {
  globalShortcut.unregisterAll();
  shortcuts = { ...defaults, ...next };
  const actions = { playPause: 'toggle-play', seekBackward: 'seek-backward', seekForward: 'seek-forward', speedDown: 'speed-down', speedUp: 'speed-up', pitchDown: 'pitch-down', pitchUp: 'pitch-up' };
  for (const [key, accelerator] of Object.entries(shortcuts)) {
    try { if (accelerator) globalShortcut.register(accelerator, () => mainWindow?.webContents.send('global-action', actions[key])); } catch {}
  }
}
function setUpdateState(status, details = {}) {
  updateState = { status, ...details };
  mainWindow?.webContents.send('updates:status', updateState);
}
function installUpdateWhenIdle() {
  if (!app.isPackaged || !updateDownloaded || playbackActive || installingUpdate) return;
  installingUpdate = true;
  setUpdateState('installing');
  autoUpdater.quitAndInstall(true, true);
}
function checkForUpdates() {
  if (!app.isPackaged || updateDownloaded) return Promise.resolve(updateState);
  if (updateCheckPromise) return updateCheckPromise;
  updateCheckPromise = autoUpdater.checkForUpdates()
    .catch((error) => {
      console.error('Could not check for application updates:', error);
      setUpdateState('error');
      throw error;
    })
    .finally(() => { updateCheckPromise = null; });
  return updateCheckPromise;
}
function initializeAutoUpdates() {
  if (!app.isPackaged || updateChecksStarted) return;
  updateChecksStarted = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => setUpdateState('checking'));
  autoUpdater.on('update-available', (info) => setUpdateState('downloading', { version: info.version, percent: 0 }));
  autoUpdater.on('update-not-available', (info) => setUpdateState('up-to-date', { version: info.version }));
  autoUpdater.on('download-progress', (progress) => setUpdateState('downloading', { percent: Math.floor(progress.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    updateDownloaded = true;
    setUpdateState('downloaded', { version: info.version });
    installUpdateWhenIdle();
  });
  autoUpdater.on('error', (error) => {
    console.error('Could not update the application:', error);
    setUpdateState('error');
  });
  checkForUpdates().catch(() => {});
  const updateCheckTimer = setInterval(() => checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
  updateCheckTimer.unref();
}
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1440, height: 980, minWidth: 1040, minHeight: 720, backgroundColor: '#0c1014', title: 'M0SH TimeStretch', icon: path.join(__dirname, app.isPackaged ? '../web-dist/mto-icon.png' : '../public/mto-icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    autoplayPolicy: 'no-user-gesture-required' });
  if (!app.isPackaged) mainWindow.loadURL('http://127.0.0.1:5173');
  else mainWindow.loadFile(path.join(__dirname, '../web-dist/index.html'));
}
ipcMain.handle('audio:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { title: 'Open audio', properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['mp3', 'wav'] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  lastAudioPath = filePath; savedPosition = 0; savePlaybackState(0);
  const stat = await fs.stat(filePath);
  return { name: path.basename(filePath), path: filePath, url: audioUrl(), size: stat.size, mtimeMs: stat.mtimeMs };
});
ipcMain.handle('audio:restore', async () => {
  if (!lastAudioPath) return null;
  try {
    const filePath = lastAudioPath;
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return null;
    return { name: path.basename(filePath), path: filePath, url: audioUrl(), size: stat.size, mtimeMs: stat.mtimeMs, position: savedPosition };
  } catch { lastAudioPath = null; savedPosition = 0; return null; }
});
ipcMain.handle('audio:read-chunk', async (_event, { filePath, offset, length }) => {
  if (filePath !== lastAudioPath) throw new Error('Audio file is no longer selected');
  const start = Math.max(0, Number(offset) || 0);
  const requested = Math.min(8 * 1024 * 1024, Math.max(1, Number(length) || 1));
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(requested);
    const { bytesRead } = await handle.read(buffer, 0, requested, start);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead);
  } finally { await handle.close(); }
});
ipcMain.handle('waveform:generate', async (_event, { filePath, duration }) => {
  if (process.platform !== 'win32' || filePath !== lastAudioPath || !Number.isFinite(duration) || duration <= 0) return null;
  const generatorPath = app.isPackaged
    ? path.join(process.resourcesPath, 'audiowaveform', 'audiowaveform.exe')
    : path.join(app.getAppPath(), 'resources', 'audiowaveform.exe');
  const outputPath = path.join(app.getPath('temp'), `mto-waveform-${randomUUID()}.json`);
  try {
    await fs.access(generatorPath);
    const pixelsPerSecond = Math.min(1024, Math.max(1, Math.ceil(2048 / duration)));
    await execFileAsync(generatorPath, [
      '--quiet', '--input-filename', filePath,
      '--output-filename', outputPath, '--output-format', 'json',
      '--pixels-per-second', String(pixelsPerSecond), '--bits', '16',
    ], { windowsHide: true, timeout: 180_000, maxBuffer: 1024 * 1024 });
    const waveform = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    if (!Array.isArray(waveform.data) || !Number.isInteger(waveform.length) || waveform.length < 1 || waveform.data.length < waveform.length * 2) return null;
    const peaks = new Float32Array(512);
    const bits = Number(waveform.bits);
    if (bits !== 8 && bits !== 16) return null;
    const sampleScale = 2 ** (bits - 1);
    for (let i = 0; i < waveform.length; i++) {
      const min = Number(waveform.data[i * 2]);
      const max = Number(waveform.data[i * 2 + 1]);
      if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
      const peak = Math.min(1, Math.max(Math.abs(min), Math.abs(max)) / sampleScale);
      const firstBin = Math.floor(i * peaks.length / waveform.length);
      const lastBin = Math.min(peaks.length - 1, Math.ceil((i + 1) * peaks.length / waveform.length) - 1);
      for (let bin = firstBin; bin <= lastBin; bin++) peaks[bin] = Math.max(peaks[bin], peak);
    }
    return Array.from(peaks);
  } catch (error) {
    console.warn('audiowaveform could not generate a waveform:', error.message);
    return null;
  } finally {
    await fs.rm(outputPath, { force: true }).catch(() => {});
  }
});
ipcMain.on('playback:position', (_event, position) => { savePlaybackState(position); });
ipcMain.handle('settings:get', async () => { await loadSettings(); return shortcuts; });
ipcMain.handle('settings:save', async (_event, value) => {
  shortcuts = { ...defaults, ...value };
  await fs.writeFile(settingsPath(), JSON.stringify({ shortcuts }, null, 2), 'utf8');
  registerShortcuts(shortcuts);
  return shortcuts;
});
ipcMain.on('playback:active', (_event, active) => {
  if (typeof active !== 'boolean') return;
  playbackActive = active;
  if (!playbackActive) installUpdateWhenIdle();
});
ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('app:open-developer-profile', () => shell.openExternal('https://github.com/MoshRadix'));
ipcMain.handle('updates:get-state', () => updateState);
ipcMain.handle('updates:check', async () => {
  if (!app.isPackaged) {
    setUpdateState('unavailable');
    return updateState;
  }
  await checkForUpdates();
  return updateState;
});
app.whenReady().then(async () => {
  protocol.handle('mto-audio', async (request) => {
    try {
      const requestId = new URL(request.url).pathname.slice(1);
      if (!lastAudioPath || !selectedAudioId || requestId !== selectedAudioId) return new Response(null, { status: 404 });
      const filePath = lastAudioPath;
      const stat = await fs.stat(filePath);
      const range = request.headers.get('range');
      let start = 0; let end = stat.size - 1; let status = 200;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
        if (!match || (!match[1] && !match[2])) {
          return new Response(null, { status: 416, headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${stat.size}` } });
        }
        if (match[1]) {
          start = Number(match[1]);
          end = match[2] ? Number(match[2]) : end;
        } else {
          const suffixLength = Number(match[2]);
          if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
            return new Response(null, { status: 416, headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${stat.size}` } });
          }
          start = Math.max(0, stat.size - suffixLength);
        }
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= stat.size || start > end) {
          return new Response(null, { status: 416, headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${stat.size}` } });
        }
        end = Math.min(end, stat.size - 1);
        status = 206;
      }
      const stream = createReadStream(filePath, { start, end });
      const headers = {
        'Content-Type': path.extname(filePath).toLowerCase() === '.wav' ? 'audio/wav' : 'audio/mpeg',
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Length': String(end - start + 1)
      };
      if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
      return new Response(Readable.toWeb(stream), { status, headers });
    } catch (error) {
      console.error('Could not stream selected audio:', error);
      return new Response(null, { status: error.code === 'ENOENT' ? 404 : 500 });
    }
  });
  await Promise.all([loadSettings(), loadPlaybackState()]); createWindow(); registerShortcuts(); initializeAutoUpdates(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
let waitingForPlaybackSave = false;
app.on('before-quit', (event) => {
  if (waitingForPlaybackSave) return;
  waitingForPlaybackSave = true;
  event.preventDefault();
  playbackWrite.finally(() => app.quit());
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
