#!/usr/bin/env node
//
// cmd-auth.mjs — ensure a valid Google OAuth access_token in .env.auth.json.
//
// Single entry point for token validity. Callers don't have to know
// whether a probe, a refresh, or a fresh consent flow is required.
//
// Behavior:
//   1. Read .env.auth.json. Missing → grant flow.
//   2. Probe stored access_token against userinfo. 200 → done.
//   3. On 401/403 → POST refresh_token. 200 → atomic write-back, done.
//   4. On 400 invalid_grant → grant flow.
//   5. Other refresh failures → throw (network, 5xx, etc.).
//
// Library:  import { ensureValidToken } from './cmd-auth.mjs'
// CLI:      node cmd-auth.mjs            ensure valid (probe → refresh → grant)
//           node cmd-auth.mjs --status   probe-only, never opens browser
//           node cmd-auth.mjs --force    skip checks, force fresh grant
//           node cmd-auth.mjs --token    after ensuring valid, print access_token to stdout
//
// Storage:  <project>/.env.auth.json (chmod 600, gitignored). Sorts
// adjacent to .env in directory listings.
//
// Timeouts: HTTP calls = 25s. Browser consent = 60s on first-time, 25s
// thereafter (a stuck flow fails fast; a re-run is cheap).
//
// OAuth client: gcloud's public installed-app (client_id 32555940559).
// Identical client to `gcloud auth login`. cloud-platform scope covers
// every Firebase + GCP REST API this template uses.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CLIENT_ID = '32555940559.apps.googleusercontent.com';
const CLIENT_SECRET = 'ZmssLNjJy2998hD4CTg2ejr2';
const SCOPE = 'openid email https://www.googleapis.com/auth/cloud-platform';

const HTTP_TIMEOUT_MS = 25_000;
const BROWSER_TIMEOUT_FIRST_MS = 120_000;
const BROWSER_TIMEOUT_REPEAT_MS = 120_000;

const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const CRED_PATH = path.join(PROJECT_ROOT, '.env.auth.json');
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/auth';

function readCred() {
  if (!fs.existsSync(CRED_PATH)) return null;
  return JSON.parse(fs.readFileSync(CRED_PATH, 'utf8'));
}

function writeCred(cred) {
  const tmp = `${CRED_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cred, null, 2));
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, CRED_PATH);
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = HTTP_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function probe(accessToken) {
  return fetchWithTimeout(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

async function refresh(cred) {
  const res = await fetchWithTimeout(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cred.client_id,
      client_secret: cred.client_secret,
      refresh_token: cred.tokens.refresh_token,
      grant_type: 'refresh_token'
    })
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 400 && /invalid_grant/.test(text)) {
      const err = new Error('refresh_token revoked (invalid_grant)');
      err.code = 'INVALID_GRANT';
      throw err;
    }
    throw new Error(`refresh failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const tokens = JSON.parse(text);
  // Google sometimes omits a fresh refresh_token in the response — keep the existing one.
  if (!tokens.refresh_token) tokens.refresh_token = cred.tokens.refresh_token;
  return tokens;
}

function openBrowser(url) {
  // Use macOS `open -a APP URL` to direct the URL to a specific app
  // bundle. Direct spawn of the launcher's executable script worked
  // sometimes, but Chrome's process-singleton can route the URL to
  // whichever Chrome instance grabbed the LaunchServices URL handler
  // first (often regular Chrome, not our Claude profile). `open -a`
  // is the macOS-blessed path that reliably hands the URL to the
  // named app.
  const launcherApp = path.join(
    process.env.HOME || '',
    'Applications/Chrome with Claude Code.app'
  );
  if (fs.existsSync(launcherApp)) {
    console.error(`   (opening in Chrome with Claude Code)`);
    spawn('open', ['-a', launcherApp, url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  console.error(`   (launcher not found at ${launcherApp} — using default browser)`);
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref();
}

const SUCCESS_HTML = (email) => `<!doctype html><meta charset=utf-8><title>Signed in</title>
<style>body{font-family:system-ui,sans-serif;max-width:540px;margin:3em auto;padding:0 1.5em;color:#333;line-height:1.55}h1{color:#0a7;font-size:1.4em}p.s{color:#888;font-size:.9em;margin-top:1.6em}</style>
<h1>✓ Signed in</h1>
<p>Signed in as <b>${email}</b>. Return to your terminal.</p>
<p class=s>You can close this tab.</p>`;

const ERROR_HTML = (msg) => `<!doctype html><meta charset=utf-8><title>Error</title>
<style>body{font-family:system-ui,sans-serif;max-width:540px;margin:3em auto;padding:0 1.5em;color:#333;line-height:1.55}h1{color:#b33;font-size:1.4em}</style>
<h1>✗ ${msg}</h1>
<p>Return to your terminal.</p>`;

async function grant({ timeoutMs }) {
  return new Promise((resolve, reject) => {
    let timer;
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') {
        res.writeHead(404, { Connection: 'close' }).end();
        return;
      }
      const error = u.searchParams.get('error');
      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html', Connection: 'close' });
        res.end(ERROR_HTML(`OAuth error: ${error}`));
        cleanup();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }
      const code = u.searchParams.get('code');
      if (!code) {
        res.writeHead(200, { Connection: 'close' }).end();
        return;
      }
      try {
        const port = server.address().port;
        const tokenRes = await fetchWithTimeout(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code,
            redirect_uri: `http://127.0.0.1:${port}`,
            grant_type: 'authorization_code'
          })
        });
        const text = await tokenRes.text();
        if (!tokenRes.ok) throw new Error(`token exchange failed (${tokenRes.status}): ${text.slice(0, 300)}`);
        const tokens = JSON.parse(text);
        const userinfoRes = await fetchWithTimeout(USERINFO_URL, {
          headers: { Authorization: `Bearer ${tokens.access_token}` }
        });
        const userinfo = await userinfoRes.json();
        const email = userinfo.email || 'unknown';

        res.writeHead(200, { 'Content-Type': 'text/html', Connection: 'close' });
        res.end(SUCCESS_HTML(email));
        cleanup();
        resolve({ email, tokens });
      } catch (e) {
        try {
          res.writeHead(200, { 'Content-Type': 'text/html', Connection: 'close' });
          res.end(ERROR_HTML('Token exchange failed'));
        } catch { /* response may already be sent */ }
        cleanup();
        reject(e);
      }
    });

    function cleanup() {
      if (timer) clearTimeout(timer);
      try { server.close(); } catch { /* already closed */ }
    }

    server.on('error', (e) => { cleanup(); reject(e); });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const params = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: `http://127.0.0.1:${port}`,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'consent'
      });
      const url = `${AUTH_URL}?${params}`;
      const secs = Math.floor(timeoutMs / 1000);
      console.error(`⋯  opening browser for sign-in (${secs}s timeout)`);
      console.error(`   if it doesn't open, click: ${url}`);
      openBrowser(url);
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`browser consent timed out after ${secs}s`));
      }, timeoutMs);
    });
  });
}

// Returns a fresh, valid access_token. Side effect: may write .env.auth.json.
// Throws when no valid path forward exists (network down, user dismissed, etc.).
export async function ensureValidToken({ force = false } = {}) {
  const isFirstTime = !fs.existsSync(CRED_PATH);

  if (!force && !isFirstTime) {
    const cred = readCred();
    const stored = cred?.tokens?.access_token;
    if (stored) {
      const probeRes = await probe(stored);
      if (probeRes.ok) return stored;
      if (probeRes.status !== 401 && probeRes.status !== 403) {
        const text = await probeRes.text();
        throw new Error(`unexpected ${probeRes.status} probing access_token: ${text.slice(0, 300)}`);
      }
      // 401/403 → fall through to refresh.
    }

    if (cred?.tokens?.refresh_token) {
      try {
        const newTokens = await refresh(cred);
        writeCred({ ...cred, tokens: newTokens });
        return newTokens.access_token;
      } catch (e) {
        if (e.code !== 'INVALID_GRANT') throw e;
        console.error('⋯  refresh_token revoked, starting fresh sign-in…');
      }
    }
  }

  const timeoutMs = isFirstTime ? BROWSER_TIMEOUT_FIRST_MS : BROWSER_TIMEOUT_REPEAT_MS;
  const { email, tokens } = await grant({ timeoutMs });
  writeCred({ email, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, tokens });
  console.error(`✓  signed in as ${email}`);
  return tokens.access_token;
}

// CLI mode.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const status = args.includes('--status');
  const wantsToken = args.includes('--token');

  if (status) {
    const cred = readCred();
    if (!cred) {
      console.log('no cred file at .env.auth.json — sign-in required');
      process.exit(1);
    }
    const stored = cred.tokens?.access_token;
    if (!stored) {
      console.log(`cred file present (${cred.email}) but no access_token`);
      process.exit(1);
    }
    try {
      const r = await probe(stored);
      if (r.ok) {
        console.log(`✓ valid — signed in as ${cred.email}`);
        process.exit(0);
      }
      console.log(`✗ access_token expired (${r.status}) for ${cred.email} — refresh available`);
      process.exit(1);
    } catch (e) {
      console.error(`error probing: ${e.message}`);
      process.exit(2);
    }
  }

  try {
    const token = await ensureValidToken({ force });
    if (wantsToken) console.log(token);
    process.exit(0);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(2);
  }
}
