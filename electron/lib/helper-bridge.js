'use strict';
// Phase 2 — spawns the Swift hoverhelper as a child process, reads its NDJSON
// stdout stream line-by-line, and re-emits typed events. Also sends "capture"
// on demand and resolves with the next `captured` event.
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const readline = require('readline');
const log = require('./log');
const { helperPath } = require('./config');

class HelperBridge extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.ready = false;
    this.lastStatus = null;
    this._captureWaiters = [];
    this._restartTimer = null;
  }

  start() {
    if (this.proc) return;
    const bin = helperPath();
    log.info('helper-bridge: spawning', bin);
    // --interval 120ms polling; --json NDJSON stream.
    this.proc = spawn(bin, ['--json', '--interval', '120'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Swallow async pipe errors (EPIPE when the helper has exited) so writing
    // "capture"/"quit" can never crash the main process.
    this.proc.stdin.on('error', () => {});

    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on('line', (line) => this._onLine(line));

    readline.createInterface({ input: this.proc.stderr }).on('line', (l) => {
      log.debug('helper stderr:', l);
    });

    this.proc.on('exit', (code, signal) => {
      log.warn('helper exited', { code, signal });
      this.proc = null;
      this.ready = false;
      this.emit('exit', { code, signal });
      // Auto-restart unless we asked it to quit.
      if (!this._quitting) this._scheduleRestart();
    });

    this.proc.on('error', (err) => {
      log.error('helper spawn error', err.message);
      this.emit('helper-error', err);
    });
  }

  _scheduleRestart() {
    if (this._restartTimer) return;
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      log.info('helper-bridge: restarting helper');
      this.start();
    }, 1500);
  }

  _onLine(line) {
    if (!line.trim()) return;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch (e) {
      log.warn('helper: non-JSON line', line.slice(0, 200));
      return;
    }
    switch (ev.kind) {
      case 'status':
        this.lastStatus = ev;
        if (ev.permissionGranted === false) this.emit('permission-denied', ev);
        if (ev.message === 'hoverhelper ready') this.ready = true;
        this.emit('status', ev);
        break;
      case 'hover':
        this.emit('hover', ev);
        break;
      case 'clear':
        this.emit('clear', ev);
        break;
      case 'captured':
        this._resolveCapture(ev);
        this.emit('captured', ev);
        break;
      default:
        log.debug('helper: unknown event kind', ev.kind);
    }
  }

  _resolveCapture(ev) {
    const waiters = this._captureWaiters;
    this._captureWaiters = [];
    for (const w of waiters) {
      clearTimeout(w.timer);
      w.resolve(ev);
    }
  }

  /**
   * Ask the helper to re-sample the surrounding conversation for the last
   * hovered message. Resolves with { hovered, context, app } or rejects on
   * timeout.
   */
  captureContext(timeoutMs = 2500) {
    return new Promise((resolve, reject) => {
      if (!this.proc || !this.proc.stdin.writable) {
        return reject(new Error('helper not running'));
      }
      const timer = setTimeout(() => {
        this._captureWaiters = this._captureWaiters.filter((w) => w.timer !== timer);
        reject(new Error('capture timed out'));
      }, timeoutMs);
      this._captureWaiters.push({ resolve, timer });
      this.proc.stdin.write('capture\n');
    });
  }

  stop() {
    this._quitting = true;
    if (this.proc) {
      try { this.proc.stdin.write('quit\n'); } catch {}
      const p = this.proc;
      setTimeout(() => { try { p.kill('SIGTERM'); } catch {} }, 300);
      this.proc = null;
    }
  }
}

module.exports = new HelperBridge();
