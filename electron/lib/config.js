'use strict';
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// Resolved paths + user-editable settings, all under Electron's userData dir so
// nothing pollutes the repo and each teammate keeps their own tokens.
const userData = app.getPath('userData');
const SETTINGS_PATH = path.join(userData, 'settings.json');
const TOKENS_PATH = path.join(userData, 'tokens.json');
// OAuth client (Desktop app) downloaded from Google Cloud Console.
// Ships next to the app but can be overridden per-user in userData.
const CREDENTIALS_CANDIDATES = [
  path.join(userData, 'credentials.json'),
  path.join(__dirname, '..', 'credentials.json'),
];

const DEFAULTS = {
  // Ollama
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.1:8b',
  // Google Drive
  // If set, all teammates point at ONE shared folder id (recommended for a team
  // library). If null, the app finds/creates "Prompt Library" in My Drive.
  driveRootFolderId: null,
  driveRootFolderName: 'Prompt Library',
  // Full drive scope so a shared team folder is readable/writable by every
  // teammate's instance. Narrow to drive.file only if you don't share a folder.
  driveScope: 'https://www.googleapis.com/auth/drive',
};

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

let settings = { ...DEFAULTS, ...readJson(SETTINGS_PATH, {}) };

function getSettings() {
  return settings;
}

function updateSettings(patch) {
  settings = { ...settings, ...patch };
  writeJson(SETTINGS_PATH, settings);
  return settings;
}

function loadCredentials() {
  for (const p of CREDENTIALS_CANDIDATES) {
    const c = readJson(p, null);
    if (c) {
      // Google downloads wrap the client under `installed` or `web`.
      const node = c.installed || c.web || c;
      if (node && node.client_id) return node;
    }
  }
  return null;
}

function loadTokens() {
  return readJson(TOKENS_PATH, null);
}

function saveTokens(tokens) {
  writeJson(TOKENS_PATH, tokens);
}

function clearTokens() {
  try { fs.unlinkSync(TOKENS_PATH); } catch {}
}

// Path to the bundled Swift helper. In dev it's electron/resources/hoverhelper;
// in a packaged app electron-builder puts it in process.resourcesPath.
function helperPath() {
  const packaged = path.join(process.resourcesPath || '', 'hoverhelper');
  if (fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', 'resources', 'hoverhelper');
}

module.exports = {
  userData,
  SETTINGS_PATH,
  getSettings,
  updateSettings,
  loadCredentials,
  loadTokens,
  saveTokens,
  clearTokens,
  helperPath,
};
