'use strict';
const path = require('path');
const {
  app, BrowserWindow, Tray, Menu, ipcMain, screen, clipboard, Notification, nativeImage, shell, dialog,
} = require('electron');

const log = require('./lib/log');
const bridge = require('./lib/helper-bridge');
const ollama = require('./lib/ollama');
const auth = require('./lib/auth');
const drive = require('./lib/drive');
const { getSettings, updateSettings } = require('./lib/config');

// Menu-bar-only app: no dock icon.
if (process.platform === 'darwin' && app.dock) app.dock.hide();
app.setName('SaveMyPrompt');

// Never let a stray async error show Electron's raw crash dialog — log it and,
// if it's user-actionable, show a friendly message instead.
process.on('uncaughtException', (err) => {
  log.error('uncaughtException:', err && (err.stack || err.message));
  try { dialog.showErrorBox('SaveMyPrompt', (err && err.message) || String(err)); } catch {}
});
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection:', reason && (reason.stack || reason.message || reason));
});

let tray = null;
let buttonWin = null;
let previewWin = null;
let panelWin = null;
let lastHover = null;      // { hovered, anchor, app }
let buttonHideTimer = null;

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

const COMMON = {
  frame: false,
  transparent: true,
  resizable: false,
  hasShadow: false,
  skipTaskbar: true,
  // Deliver the first click even when the window isn't focused — otherwise the
  // collapsed tab needs a click to activate + a second click to actually open.
  acceptFirstMouse: true,
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
  },
};

function createButtonWindow() {
  buttonWin = new BrowserWindow({
    ...COMMON,
    width: 46,
    height: 46,
    show: false,
    focusable: false,
    alwaysOnTop: true,
  });
  buttonWin.setAlwaysOnTop(true, 'screen-saver');
  buttonWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  buttonWin.loadFile(path.join(__dirname, 'renderer', 'save-button', 'index.html'));
  buttonWin.on('closed', () => (buttonWin = null));
}

let previewReady = null;
function createPreviewWindow() {
  previewWin = new BrowserWindow({
    ...COMMON,
    width: 460,
    height: 640,
    show: false,
    focusable: true,
    alwaysOnTop: true,
  });
  previewWin.setAlwaysOnTop(true, 'screen-saver');
  previewWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  previewReady = new Promise((resolve) =>
    previewWin.webContents.once('did-finish-load', resolve));
  previewWin.loadFile(path.join(__dirname, 'renderer', 'preview', 'index.html'));
  previewWin.on('closed', () => { previewWin = null; previewReady = null; });
}

function createPanelWindow() {
  panelWin = new BrowserWindow({
    ...COMMON,
    width: 46,
    height: 140,
    show: false,
    focusable: true,
    alwaysOnTop: true,
  });
  panelWin.setAlwaysOnTop(true, 'floating');
  panelWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  panelWin.loadFile(path.join(__dirname, 'renderer', 'panel', 'index.html'));
  panelWin.on('closed', () => (panelWin = null));
  // Auto-collapse when the user clicks away (only if currently expanded, and not
  // immediately after expanding, to avoid a focus race).
  panelWin.on('blur', () => {
    const [w] = panelWin.getSize();
    if (w > 200 && Date.now() - panelExpandedAt > 350) setPanelState('collapsed', false);
  });
  setPanelState('collapsed', false);
}

let panelExpandedAt = 0;

const PANEL_SIZES = {
  collapsed: { w: 46, h: 132 },
  hint: { w: 170, h: 132 },
  expanded: { w: 384, h: 648 },
};

function setPanelState(state, showFocus = true) {
  if (!panelWin) return;
  const size = PANEL_SIZES[state] || PANEL_SIZES.collapsed;
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const wa = display.workArea;
  const x = wa.x + wa.width - size.w;
  const y = wa.y + Math.round((wa.height - size.h) / 2);
  panelWin.setBounds({ x, y, width: size.w, height: size.h });
  if (state === 'expanded') {
    panelExpandedAt = Date.now();
    if (!panelWin.isVisible()) panelWin.showInactive();
    if (showFocus) panelWin.focus();
  } else {
    if (!panelWin.isVisible()) panelWin.showInactive();
  }
  send(panelWin, 'panel:state', state);
}

function send(win, channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

// ---------------------------------------------------------------------------
// Save button positioning (Phase 3)
// ---------------------------------------------------------------------------

function showButtonAt(anchor) {
  if (!buttonWin) createButtonWindow();
  clearTimeout(buttonHideTimer);
  const size = 46;
  // Just outside the top-right corner of the message bubble.
  const x = Math.round(anchor.x - 8);
  const y = Math.round(anchor.y - 8);
  buttonWin.setBounds({ x, y, width: size, height: size });
  if (!buttonWin.isVisible()) buttonWin.showInactive();
  send(buttonWin, 'button:show', { anchor });
}

function hideButtonSoon() {
  send(buttonWin, 'button:hide');
  clearTimeout(buttonHideTimer);
  buttonHideTimer = setTimeout(() => {
    if (buttonWin && buttonWin.isVisible()) buttonWin.hide();
  }, 220);
}

// ---------------------------------------------------------------------------
// Helper bridge wiring (Phase 2/3)
// ---------------------------------------------------------------------------

function wireBridge() {
  bridge.on('status', (ev) => {
    log.debug('helper status:', ev.message);
    if (ev.permissionGranted === false) {
      notifyOnce('accessibility',
        'Accessibility permission needed',
        'Enable SaveMyPrompt in System Settings ▸ Privacy & Security ▸ Accessibility, then it will start detecting messages.');
    }
  });

  bridge.on('hover', (ev) => {
    // No floating button — just remember the last message the user hovered so
    // the panel's "Collect prompt" button knows what to grab.
    lastHover = { hovered: ev.hovered, anchor: ev.anchor, app: ev.app };
    send(panelWin, 'panel:can-collect', { text: (ev.hovered && ev.hovered.text) || '' });
    ollama.warm();
  });

  // Intentionally keep lastHover after 'clear' so the user can move the cursor
  // off the message and over to the panel to collect it.

  bridge.start();
}

// ---------------------------------------------------------------------------
// The save flow (Phase 4/5): button click -> capture -> Ollama -> preview
// ---------------------------------------------------------------------------

async function openPreviewFlow() {
  if (buttonWin) buttonWin.hide();
  if (!previewWin) createPreviewWindow();

  // 1. Re-sample full surrounding context from the helper.
  let capture;
  try {
    capture = await bridge.captureContext();
  } catch (e) {
    log.warn('capture failed, falling back to last hover', e.message);
    capture = lastHover
      ? { hovered: lastHover.hovered, context: [lastHover.hovered], app: lastHover.app }
      : null;
  }
  if (!capture || !capture.hovered) {
    dialog.showErrorBox('Nothing to save', 'Could not read the message under the cursor.');
    return { ok: false };
  }

  // Diagnostic: log exactly what was captured so we can see mis-grabs.
  log.info('CAPTURE hovered:', JSON.stringify({
    author: capture.hovered.author,
    role: capture.hovered.role,
    dom: (capture.hovered.domClass || []).slice(0, 5),
    len: (capture.hovered.text || '').length,
    head: (capture.hovered.text || '').slice(0, 200),
    tail: (capture.hovered.text || '').slice(-80),
  }));
  log.info('CAPTURE context(' + (capture.context || []).length + '):',
    JSON.stringify((capture.context || []).map((m) => ({
      a: m.author, len: (m.text || '').length, head: (m.text || '').slice(0, 70),
    }))));

  showPreview();
  if (previewReady) await previewReady; // don't send before the renderer loads
  send(previewWin, 'preview:capture', {
    hovered: capture.hovered,
    context: capture.context,
    app: capture.app,
  });

  // 2. Guard: signed in + Ollama up.
  if (!auth.isSignedIn()) {
    send(previewWin, 'preview:notice', {
      level: 'warn',
      text: 'Not signed in to Google Drive — you can still edit, but sign in before saving.',
    });
  }
  const ostatus = await ollama.status();
  if (!ostatus.ok) {
    send(previewWin, 'preview:error', {
      text: `Ollama isn't reachable at ${getSettings().ollamaUrl}. Start it with "ollama serve" and pull the model "${getSettings().ollamaModel}".`,
    });
    return { ok: true };
  }

  // 3. Fetch taxonomy (best-effort) + run the model.
  let taxonomy = { folders: [], tags: [] };
  try { if (auth.isSignedIn()) taxonomy = await drive.getTaxonomy(); }
  catch (e) { log.warn('taxonomy fetch failed', e.message); }

  try {
    const result = await ollama.process({
      hovered: capture.hovered,
      context: capture.context,
      taxonomy,
    });
    send(previewWin, 'preview:result', { result, taxonomy });
  } catch (e) {
    log.error('ollama process failed', e.message);
    send(previewWin, 'preview:error', { text: 'Ollama failed: ' + e.message });
  }
  return { ok: true };
}

function showPreview() {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const wa = display.workArea;
  const [w, h] = previewWin.getSize();
  previewWin.setBounds({
    x: wa.x + Math.round((wa.width - w) / 2),
    y: wa.y + Math.round((wa.height - h) / 2),
    width: w, height: h,
  });
  previewWin.show();
  previewWin.focus();
}

// ---------------------------------------------------------------------------
// Tray + first-run
// ---------------------------------------------------------------------------

function trayIconImage() {
  const p = path.join(__dirname, 'assets', 'trayTemplate.png');
  const img = nativeImage.createFromPath(p);
  if (!img.isEmpty()) { img.setTemplateImage(true); return img; }
  // Fallback: a tiny generated dot so the app still runs without the asset.
  return nativeImage.createEmpty();
}

function buildTrayMenu() {
  const s = getSettings();
  const signedIn = auth.isSignedIn();
  const loginItem = app.getLoginItemSettings().openAtLogin;
  return Menu.buildFromTemplate([
    { label: 'Open Library', click: () => setPanelState('expanded') },
    { type: 'separator' },
    signedIn
      ? { label: 'Sign out of Google', click: () => { auth.signOut(); refreshTray(); } }
      : { label: 'Sign in to Google Drive…', click: () => doSignIn() },
    {
      label: 'Check Ollama…',
      click: async () => {
        const st = await ollama.status();
        dialog.showMessageBox({
          message: st.ok ? 'Ollama is running' : 'Ollama is not reachable',
          detail: st.ok
            ? `Models: ${st.models.join(', ') || '(none)'}\nUsing: ${s.ollamaModel}`
            : `${st.error}\n\nStart it with "ollama serve" and run "ollama pull ${s.ollamaModel}".`,
        });
      },
    },
    {
      label: 'Accessibility permission…',
      click: () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'),
    },
    { type: 'separator' },
    {
      label: 'Launch at login',
      type: 'checkbox',
      checked: loginItem,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: 'Quit SaveMyPrompt', click: () => app.quit() },
  ]);
}

function refreshTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  tray = new Tray(trayIconImage());
  tray.setToolTip('SaveMyPrompt');
  tray.on('click', () => {
    // Toggle the panel expanded/collapsed on left click.
    const [w] = panelWin ? panelWin.getSize() : [46];
    setPanelState(w > 200 ? 'collapsed' : 'expanded');
  });
  refreshTray();
}

async function doSignIn() {
  try {
    await auth.signIn();
    await drive.ensureRoot();
    refreshTray();
    send(panelWin, 'panel:refresh');
    new Notification({ title: 'SaveMyPrompt', body: 'Signed in to Google Drive.' }).show();
  } catch (e) {
    dialog.showErrorBox('Google sign-in failed', e.message);
  }
}

function mimeFor(fp) {
  const ext = path.extname(fp).toLowerCase();
  return {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
    '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  }[ext] || 'application/octet-stream';
}

const notified = new Set();
function notifyOnce(key, title, body) {
  if (notified.has(key)) return;
  notified.add(key);
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

async function firstRunChecks() {
  const st = await ollama.status();
  if (!st.ok) {
    notifyOnce('ollama', "Ollama isn't running",
      `Start it with "ollama serve" and pull "${getSettings().ollamaModel}". SaveMyPrompt needs it to clean up prompts.`);
  }
  if (!auth.isSignedIn()) {
    notifyOnce('signin', 'Connect Google Drive',
      'Open the menu bar icon and choose “Sign in to Google Drive” to enable saving.');
  }
}

// ---------------------------------------------------------------------------
// IPC (Phase 2 surface, filled through Phase 7)
// ---------------------------------------------------------------------------

function wireIpc() {
  ipcMain.handle('smp:open-preview', () => openPreviewFlow());
  ipcMain.handle('smp:collect', () => openPreviewFlow());
  ipcMain.handle('smp:has-hover', () => ({ ok: !!lastHover, text: lastHover && lastHover.hovered && lastHover.hovered.text }));
  ipcMain.handle('smp:close-preview', () => { if (previewWin) previewWin.hide(); });

  ipcMain.handle('smp:panel-state', (_e, state) => setPanelState(state));

  ipcMain.handle('smp:save', async (_e, payload) => {
    if (!auth.isSignedIn()) throw new Error('not signed in to Google');
    const res = await drive.savePrompt(payload);
    send(panelWin, 'panel:refresh');
    if (previewWin) previewWin.hide();
    return res;
  });

  ipcMain.handle('smp:pick-output', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Attach output file',
      properties: ['openFile'],
      message: 'Attach a generated image or other output to save alongside this prompt.',
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const fp = r.filePaths[0];
    const data = require('fs').readFileSync(fp);
    return { name: path.basename(fp), mimeType: mimeFor(fp), data: data.toString('base64') };
  });

  ipcMain.handle('smp:taxonomy', () => drive.getTaxonomy());
  ipcMain.handle('smp:list-folders', () => drive.listFolders());
  ipcMain.handle('smp:list-prompts', (_e, folderId) => drive.listPrompts(folderId));
  ipcMain.handle('smp:prompt-content', (_e, id) => drive.getContent(id));
  ipcMain.handle('smp:search', (_e, q) => drive.search(q));

  ipcMain.handle('smp:copy', async (_e, id) => {
    const { prompt } = await drive.getContent(id);
    clipboard.writeText(prompt);
    return { ok: true };
  });

  ipcMain.handle('smp:auth-status', () => ({ signedIn: auth.isSignedIn() }));
  ipcMain.handle('smp:sign-in', async () => { await doSignIn(); return { signedIn: auth.isSignedIn() }; });
  ipcMain.handle('smp:sign-out', () => { auth.signOut(); refreshTray(); return { signedIn: false }; });
  ipcMain.handle('smp:ollama-status', () => ollama.status());
  ipcMain.handle('smp:helper-status', () => bridge.lastStatus || { message: 'starting' });
  ipcMain.handle('smp:settings', (_e, patch) => (patch ? updateSettings(patch) : getSettings()));
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    // Launch at login by default on first run (user can toggle it off in the tray).
    const s = getSettings();
    if (!s._loginConfigured) {
      app.setLoginItemSettings({ openAtLogin: true });
      updateSettings({ _loginConfigured: true });
    }
    wireIpc();
    createTray();
    createPanelWindow();
    wireBridge();
    firstRunChecks();
    log.info('SaveMyPrompt ready');
  });
}

app.on('window-all-closed', (e) => {
  // Menu bar app stays alive with no windows.
});

app.on('before-quit', () => bridge.stop());
