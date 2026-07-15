'use strict';
// Minimal timestamped logger. Writes to stderr so it never corrupts any stdout
// JSON stream, and mirrors to a rotating file under userData for teammates to
// send when something misbehaves.
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

let stream = null;
function file() {
  if (stream) return stream;
  try {
    const p = path.join(app.getPath('userData'), 'savemyprompt.log');
    stream = fs.createWriteStream(p, { flags: 'a' });
  } catch {}
  return stream;
}

function line(level, args) {
  const ts = new Date().toISOString();
  const msg = args
    .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
    .join(' ');
  const out = `${ts} [${level}] ${msg}`;
  process.stderr.write(out + '\n');
  const f = file();
  if (f) f.write(out + '\n');
}

function safeStringify(a) {
  try { return JSON.stringify(a); } catch { return String(a); }
}

module.exports = {
  info: (...a) => line('info', a),
  warn: (...a) => line('warn', a),
  error: (...a) => line('error', a),
  debug: (...a) => { if (process.env.SMP_DEV) line('debug', a); },
};
