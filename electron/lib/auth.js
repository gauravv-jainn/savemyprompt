'use strict';
// Phase 6 — Google OAuth for a Desktop-app client using the loopback flow.
// The team lead creates one OAuth client (Desktop) in Google Cloud Console,
// enables the Drive API, adds teammates as test users, and ships credentials.json.
// Each teammate signs in once; the refresh token is stored in userData.
const http = require('http');
const { URL } = require('url');
const { shell } = require('electron');
const { google } = require('googleapis');
const { loadCredentials, loadTokens, saveTokens, clearTokens, getSettings } = require('./config');
const log = require('./log');

let oAuthClient = null;

function makeClient(redirectUri) {
  const creds = loadCredentials();
  if (!creds) {
    throw new Error(
      'Missing credentials.json — download an OAuth "Desktop app" client from Google Cloud Console and place it next to the app (or in userData).'
    );
  }
  return new google.auth.OAuth2(creds.client_id, creds.client_secret, redirectUri);
}

/** Returns an authorized client if we already have stored tokens, else null. */
function existingClient() {
  if (oAuthClient) return oAuthClient;
  const tokens = loadTokens();
  if (!tokens) return null;
  const client = makeClient('http://127.0.0.1'); // redirect unused for refresh
  client.setCredentials(tokens);
  client.on('tokens', (t) => {
    const merged = { ...loadTokens(), ...t };
    saveTokens(merged);
    log.info('auth: refreshed + persisted tokens');
  });
  oAuthClient = client;
  return client;
}

/** Interactive sign-in via the loopback flow. Resolves with an authed client. */
function signIn() {
  return new Promise((resolve, reject) => {
    // Validate credentials up front so a missing file rejects cleanly instead
    // of throwing later inside the server-listen callback (uncaught → crash).
    if (!loadCredentials()) {
      return reject(new Error(
        'Missing credentials.json — create an OAuth "Desktop app" client in Google Cloud Console (with the Drive API enabled) and save it as electron/credentials.json. See credentials.sample.json.'
      ));
    }
    let server;
    const scope = getSettings().driveScope;

    server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, `http://127.0.0.1`);
        if (!url.searchParams.has('code') && !url.searchParams.has('error')) {
          res.writeHead(404); res.end(); return;
        }
        const err = url.searchParams.get('error');
        if (err) {
          res.end('Sign-in failed: ' + err);
          server.close();
          return reject(new Error(err));
        }
        const code = url.searchParams.get('code');
        const address = server.address();
        const redirectUri = `http://127.0.0.1:${address.port}`;
        const client = makeClient(redirectUri);
        const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });
        client.setCredentials(tokens);
        saveTokens(tokens);
        client.on('tokens', (t) => saveTokens({ ...loadTokens(), ...t }));
        oAuthClient = client;

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(SUCCESS_HTML);
        server.close();
        log.info('auth: sign-in complete');
        resolve(client);
      } catch (e) {
        log.error('auth: token exchange failed', e.message);
        try { res.end('Error: ' + e.message); } catch {}
        try { server.close(); } catch {}
        reject(e);
      }
    });

    server.listen(0, '127.0.0.1', () => {
      try {
        const port = server.address().port;
        const redirectUri = `http://127.0.0.1:${port}`;
        const client = makeClient(redirectUri);
        const authUrl = client.generateAuthUrl({
          access_type: 'offline',
          prompt: 'consent',
          scope,
        });
        log.info('auth: opening browser for consent');
        shell.openExternal(authUrl);
      } catch (e) {
        try { server.close(); } catch {}
        reject(e);
      }
    });

    server.on('error', reject);
  });
}

function signOut() {
  clearTokens();
  oAuthClient = null;
}

function isSignedIn() {
  return !!loadTokens();
}

module.exports = { existingClient, signIn, signOut, isSignedIn };

const SUCCESS_HTML = `<!doctype html><html><head><meta charset="utf-8">
<title>SaveMyPrompt</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#1e1e1e;color:#eee;
display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{text-align:center}.g{background:linear-gradient(135deg,#f5c542,#2bb6a8);
-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:700;font-size:22px}</style>
</head><body><div class="card"><div class="g">savemyprompt.ai</div>
<p>You're signed in. You can close this tab and return to the app.</p></div></body></html>`;
