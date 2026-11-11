// The desktop app. Electron runs the same server as `npm start`, inside its
// own process, and shows the page in its own window. Everything it keeps
// (database, logs, thumbnails, YouTube sign-in, the window's own storage)
// lives in %LOCALAPPDATA%\Badminton Video; FFmpeg comes with the installer.
// The Python tools' scripts do too; the big rest of them is set up from Settings.

import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkAction, windowKey } from './links.js';

const NAME = 'Badminton Video';
// 8791 is `npm start`'s, so the installed app and a development copy can run side by side.
const PORT = app.isPackaged ? 8792 : 8793;
// A development copy says so: the page shows a yellow mark and "(dev)" in its title (GET /api/version `dev`).
if (!app.isPackaged) process.env.BADMINTON_VIDEO_DEV = '1';

if (process.env.LOCALAPPDATA) app.setPath('userData', join(process.env.LOCALAPPDATA, app.isPackaged ? NAME : `${NAME} (development)`));
const dataDir = process.env.BADMINTON_VIDEO_DATA || join(app.getPath('userData'), 'data');

const bundled = join(process.resourcesPath, 'ffmpeg');
if (app.isPackaged && existsSync(bundled)) process.env.BADMINTON_VIDEO_FFMPEG = bundled;
if (app.isPackaged) {
  process.env.BADMINTON_VIDEO_SCRIPTS = join(process.resourcesPath, 'analysis');
  process.env.BADMINTON_VIDEO_TOOLS = join(app.getPath('userData'), 'analysis');
}

let win = null;

/** The first port from `port` that nothing else listens on (localStorage is per port, so it stays put when free). */
function freePort(port, tries = 20) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => (tries > 1 ? freePort(port + 1, tries - 1).then(resolve, reject) : reject(new Error(`No free port from ${port}`))));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(port)));
  });
}

function openWindow(address, listJobs) {
  const origin = new URL(address).origin;
  // The installed app takes its icon from the .exe; a development copy uses the yellow one.
  const icon = fileURLToPath(new URL('../build/icon-dev.png', import.meta.url));
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: app.isPackaged ? NAME : `${NAME} (dev)`,
    icon: !app.isPackaged && existsSync(icon) ? icon : undefined,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    const action = linkAction(url, origin);
    if (action === 'browser') shell.openExternal(url);
    return { action: action === 'app' ? 'allow' : 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const action = linkAction(url, origin);
    if (action === 'app') return;
    event.preventDefault();
    if (action === 'browser') shell.openExternal(url);
  });
  win.webContents.on('before-input-event', (event, input) => {
    const key = windowKey(input);
    if (key === 'reload') win.webContents.reload();
    else if (key === 'devtools') win.webContents.toggleDevTools();
    if (key) event.preventDefault();
  });
  // Jobs live in this process: closing the window ends them, so ask first.
  win.on('close', (event) => {
    const running = listJobs().filter((j) => j.status === 'running' || j.status === 'queued');
    if (!running.length) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      title: NAME,
      buttons: ['Keep working', 'Close and stop them'],
      defaultId: 0,
      cancelId: 0,
      message: `${running.length} job${running.length === 1 ? ' is' : 's are'} still running`,
      detail: `Closing the app stops ${running.length === 1 ? 'it' : 'them'}:\n${running.map((j) => j.label || j.key).join('\n')}`,
    });
    if (choice === 0) event.preventDefault();
  });
  win.on('closed', () => { win = null; });
  win.loadURL(address);
}

async function start() {
  Menu.setApplicationMenu(null);
  const { startServer } = await import('../server.js');
  const { listJobs } = await import('../lib/jobs.js');
  const port = await freePort(PORT);
  startServer({
    dataDir,
    port,
    restart: () => {
      app.relaunch();
      app.exit(0);
    },
    onListening: (address) => openWindow(address, listJobs),
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(start).catch((err) => {
    dialog.showErrorBox(NAME, `The app couldn’t start:\n${err.stack ?? err.message}`);
    app.exit(1);
  });
}
