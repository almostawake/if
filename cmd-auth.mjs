#!/usr/bin/env node
//
// cmd-auth.mjs — ensure a valid Google OAuth access_token.
//
// Single entry point for token validity. Callers don't have to know
// whether a probe, a refresh, or a fresh consent flow is required.
//
// One file per account (no "default" file). Without a positional arg,
// the account is resolved from EMAIL_OF_GOOGLE_HOSTING_ACCOUNT in the
// project's .env (this checkout's deploy account), falling back to
// IF_DEFAULT_GOOGLE_USER in ~/.if/.env (the machine-wide default). Pass
// an explicit email as the first positional arg to act on another.
//
// Behavior (per account):
//   1. Resolve account → ~/.if/creds/.env.auth.<email>.json.
//   2. Read cred file. Missing → grant flow.
//   3. Probe stored access_token against userinfo. 200 → done.
//   4. On 401/403 → POST refresh_token. 200 → atomic write-back, done.
//   5. On 400 invalid_grant → grant flow.
//   6. Other refresh failures → throw (network, 5xx, etc.).
//
// Library:  import { ensureValidToken } from './cmd-auth.mjs'
//             ensureValidToken()                       — resolves account (above)
//             ensureValidToken({ account: '<email>' }) — explicit
// CLI:      node cmd-auth.mjs                         resolves account (above)
//           node cmd-auth.mjs <email>                 per-account
//           node cmd-auth.mjs [<email>] --status      probe-only
//           node cmd-auth.mjs [<email>] --force       force fresh grant
//           node cmd-auth.mjs [<email>] --token       print access_token
//           node cmd-auth.mjs [<email>] --project=<id> also write ADC
//           node cmd-auth.mjs --discover              first-time sign-in
//                                                     (no account known up
//                                                     front; reads email
//                                                     from userinfo, writes
//                                                     ~/.if/creds/.env.auth
//                                                     .<email>.json, prints
//                                                     the discovered email
//                                                     to stdout)
//
// Storage:  ~/.if/creds/.env.auth.<email>.json   (chmod 600, dir 700)
//           Outside the project tree on purpose — same Google account is
//           reused across multiple projects; nothing project-scoped here.
//
// ADC side-effect: when a project is resolved (--project=<id> flag, or
//           THIS_PROJECT_ID_ON_GOOGLE_HOSTING in the project's .env), every
//           successful auth path also writes an ADC file at
//           ~/.config/gcloud/application_default_credentials.json
//           (CLOUDSDK_CONFIG / Windows %APPDATA% honored). This lets code
//           that reads ADC directly — without depending on cmd-auth.mjs —
//           refresh tokens against the cred stored in ~/.if/creds.
//           --token (print-only) and --status (read-only) never write ADC and
//           need no project. The bare auth path, however, exists to set up ADC,
//           so with no project resolved it FAILS (exit 2) rather than silently
//           leaving a stale/missing ADC behind.
//
// Account binding: the OAuth URL carries login_hint=<email> (Google
// pre-selects that account; chooser still shows when needed). Post-grant
// we verify userinfo.email matches the requested account
// (case-insensitive). Mismatch = hard error, no file written.
//
// Timeouts: HTTP calls = 25s. Browser consent = 5min on every flow.
//
// OAuth client: gcloud's public installed-app (client_id 32555940559).
// Identical client to `gcloud auth login`. cloud-platform scope covers
// every Firebase + GCP REST API this template uses.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CLIENT_ID = '32555940559.apps.googleusercontent.com';
const CLIENT_SECRET = 'ZmssLNjJy2998hD4CTg2ejr2';
const SCOPE = 'openid email https://www.googleapis.com/auth/cloud-platform';

const HTTP_TIMEOUT_MS = 25_000;
const BROWSER_TIMEOUT_MS = 300_000;

const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const CREDS_DIR = path.join(os.homedir(), '.if', 'creds');
// Central, machine-wide if config (project parent, default account).
// Same file aa/n seeds + sources; we read it as the account fallback.
const IF_ENV = path.join(os.homedir(), '.if', '.env');
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/auth';

// Mirrors gcloud's own ADC discovery: CLOUDSDK_CONFIG wins; else
// %APPDATA%\gcloud on Windows; else ~/.config/gcloud on Unix.
const ADC_PATH = (() => {
  const override = process.env.CLOUDSDK_CONFIG;
  if (override) return path.join(override, 'application_default_credentials.json');
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'gcloud', 'application_default_credentials.json');
  }
  return path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');
})();

// Read a single key from a .env-style file. Same simple parser the
// deploy wrapper uses — values are bare strings, no quoting weirdness.
function readEnvKey(file, key) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  const re = new RegExp(`^${key}\\s*=\\s*(.*)$`);
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(re);
    if (!m) continue;
    let v = m[1].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v || null;
  }
  return null;
}

// Project-local .env (next to this script) and the machine-wide ~/.if/.env.
function envValue(key) { return readEnvKey(path.join(PROJECT_ROOT, '.env'), key); }
function globalValue(key) { return readEnvKey(IF_ENV, key); }

// Resolve the account to use, in precedence order:
//   1. explicit arg (CLI positional / { account });
//   2. EMAIL_OF_GOOGLE_HOSTING_ACCOUNT in the project's .env — the
//      account this checkout deploys as (project-specific, wins over the
//      machine default so multi-account setups deploy correctly);
//   3. IF_DEFAULT_GOOGLE_USER in ~/.if/.env — the machine-wide default.
// Throws when none resolve.
function resolveAccount(arg) {
  if (arg) return arg;
  const env = envValue('EMAIL_OF_GOOGLE_HOSTING_ACCOUNT');
  if (env) return env;
  const fallback = globalValue('IF_DEFAULT_GOOGLE_USER');
  if (fallback) return fallback;
  throw new Error(
    'no account: pass one as the first positional arg ' +
    '(e.g. `node cmd-auth.mjs alice@x.com`), set EMAIL_OF_GOOGLE_HOSTING_ACCOUNT ' +
    'in .env, or IF_DEFAULT_GOOGLE_USER in ~/.if/.env',
  );
}

// Resolve project for ADC quota_project_id. --project=<id> wins, else
// THIS_PROJECT_ID_ON_GOOGLE_HOSTING in .env. Returns null when unknown —
// the caller skips ADC writing in that case.
function resolveProject(arg) {
  if (arg) return arg;
  return envValue('THIS_PROJECT_ID_ON_GOOGLE_HOSTING');
}

function credPath(account) {
  return path.join(CREDS_DIR, `.env.auth.${account}.json`);
}

function readCred(account) {
  const p = credPath(account);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeCred(cred, account) {
  // Ensure the creds dir exists and is locked down. mkdir -p is a no-op
  // when present; chmod each call keeps the dir at 700 even if something
  // else widened it.
  fs.mkdirSync(CREDS_DIR, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(CREDS_DIR, 0o700); } catch { /* not ours / non-fatal */ }
  const p = credPath(account);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cred, null, 2));
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, p);
}

// Write an ADC file at the gcloud-conventional location. The OAuth client
// ID we use (32555940559) differs from `gcloud auth application-default
// login`'s client (764086051850), but both are public Google clients and
// google-auth-libs just refresh whatever client_id/secret/refresh_token
// trio the file carries — they don't pin to a specific client.
function writeAdc(cred, project) {
  const adc = {
    type: 'authorized_user',
    client_id: cred.client_id,
    client_secret: cred.client_secret,
    refresh_token: cred.tokens.refresh_token,
    quota_project_id: project,
    universe_domain: 'googleapis.com',
    account: cred.email,
  };
  fs.mkdirSync(path.dirname(ADC_PATH), { recursive: true });
  const tmp = `${ADC_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(adc, null, 2));
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, ADC_PATH);
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
      // Distinguish Workspace session-control reauth (invalid_rapt /
      // rapt_required) from a real refresh_token revocation. Both
      // demand a fresh grant (RAPT can't be satisfied from code), but
      // the cause is different and the cure is different — RAPT is
      // fixed at the Workspace admin level, not by re-signing in.
      let subtype = '';
      try { subtype = JSON.parse(text).error_subtype || ''; } catch { /* not JSON */ }
      const err = new Error(/rapt/.test(subtype)
        ? `Workspace session expired (${subtype})`
        : 'refresh_token revoked (invalid_grant)');
      err.code = 'INVALID_GRANT';
      err.subtype = subtype;
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
  // `open -a APP --args URL`. The `--args` flag is load-bearing — without
  // it, `open -a APP URL` doesn't pass URL via argv to a bash-in-bundle
  // (argc=0 inside the script), macOS falls through to the default URL
  // handler (Safari on a fresh macOS user), and the OAuth opens in the
  // wrong app. With `--args`, the bash receives URL as $1, forwards via
  // "$@" into Chrome with --user-data-dir=Chrome-Claude. LaunchServices
  // also stamps the launcher's bundle id on the chain so the Dock shows
  // a single "Chrome with Claude Code" icon. See aa/CLAUDE.md for the
  // saga — d425944 (open -a without --args, broken) and 5248ca3 (direct
  // exec, works but loses Dock attribution) are both regressions of
  // this form.
  const launcherApp = path.join(
    process.env.HOME || '',
    'Applications/Chrome with Claude Code.app'
  );
  if (fs.existsSync(launcherApp)) {
    console.error(`   (opening in Chrome with Claude Code)`);
    spawn('open', ['-a', launcherApp, '--args', url], { detached: true, stdio: 'ignore' }).unref();
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

async function grant({ timeoutMs, account }) {
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

        // login_hint is a hint, not a constraint — user can still pick a
        // different account in the chooser. Reject mismatches loudly so
        // we don't write the wrong account's tokens to the wrong file.
        // (Discovery mode passes account=null and skips this check —
        // whatever the user picks IS the account.)
        if (account && email.toLowerCase() !== account.toLowerCase()) {
          res.writeHead(200, { 'Content-Type': 'text/html', Connection: 'close' });
          res.end(ERROR_HTML(`Signed in as ${email}, not ${account}`));
          cleanup();
          reject(new Error(`account mismatch: requested ${account}, got ${email}`));
          return;
        }

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
        prompt: 'consent',
      });
      if (account) params.set('login_hint', account);
      const url = `${AUTH_URL}?${params}`;
      const secs = Math.floor(timeoutMs / 1000);
      const who = account ? ` as ${account}` : '';
      console.error(`⋯  opening browser for sign-in${who} (${secs}s timeout)`);
      console.error(`   if it doesn't open, click: ${url}`);
      openBrowser(url);
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`browser consent timed out after ${secs}s`));
      }, timeoutMs);
    });
  });
}

// Returns a fresh, valid access_token. Side effects: may write the cred
// file at ~/.if/creds/.env.auth.<email>.json, and (when `project` is
// resolved via arg or .env) also writes/refreshes ADC at the gcloud
// conventional location so non-cmd-auth-aware code can refresh tokens
// against the same cred. Throws when no valid path forward exists
// (network down, user dismissed, etc.) or when neither `account` nor
// EMAIL_OF_GOOGLE_HOSTING_ACCOUNT in .env identifies an account.
export async function ensureValidToken({ force = false, account, project } = {}) {
  const resolved = resolveAccount(account);
  const resolvedProject = resolveProject(project);
  const credFile = credPath(resolved);
  const isFirstTime = !fs.existsSync(credFile);

  if (!force && !isFirstTime) {
    const cred = readCred(resolved);
    const stored = cred?.tokens?.access_token;
    if (stored) {
      const probeRes = await probe(stored);
      if (probeRes.ok) {
        if (resolvedProject) writeAdc(cred, resolvedProject);
        return stored;
      }
      if (probeRes.status !== 401 && probeRes.status !== 403) {
        const text = await probeRes.text();
        throw new Error(`unexpected ${probeRes.status} probing access_token: ${text.slice(0, 300)}`);
      }
      // 401/403 → fall through to refresh.
    }

    if (cred?.tokens?.refresh_token) {
      try {
        const newTokens = await refresh(cred);
        const updated = { ...cred, tokens: newTokens };
        writeCred(updated, resolved);
        if (resolvedProject) writeAdc(updated, resolvedProject);
        return newTokens.access_token;
      } catch (e) {
        if (e.code !== 'INVALID_GRANT') throw e;
        if (/rapt/.test(e.subtype || '')) {
          console.error(`⋯  Workspace session expired (${e.subtype}) — fresh sign-in required.`);
          console.error('   to stop daily prompts: admin.google.com → Security → Google Cloud session control');
        } else {
          console.error('⋯  refresh_token revoked — starting fresh sign-in…');
        }
      }
    }
  }

  const { email, tokens } = await grant({ timeoutMs: BROWSER_TIMEOUT_MS, account: resolved });
  const newCred = { email, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, tokens };
  writeCred(newCred, resolved);
  if (resolvedProject) writeAdc(newCred, resolvedProject);
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
  const discover = args.includes('--discover');
  // --project=<id> for ADC writing. Empty value treated as not-set so
  // `--project=` doesn't poison ADC with an empty quota_project_id.
  const projectFlag = args.find(a => a.startsWith('--project='));
  const projectArg = projectFlag ? projectFlag.slice('--project='.length) || null : null;
  // First non-flag arg = explicit account; else fall back to EMAIL_OF_GOOGLE_HOSTING_ACCOUNT in .env.
  const arg = args.find(a => !a.startsWith('--'));

  // Discovery mode: no account known up front. Run the OAuth flow, read
  // userinfo.email, write the cred file using that email, print the email
  // to stdout. Used by aa/n for first-time sign-in where the account is
  // whatever the user chooses in the browser. Mutex with everything else.
  if (discover) {
    if (arg) {
      console.error('error: --discover does not take a positional account');
      process.exit(2);
    }
    if (status || force) {
      console.error('error: --discover is mutex with --status and --force');
      process.exit(2);
    }
    try {
      const { email, tokens } = await grant({ timeoutMs: BROWSER_TIMEOUT_MS, account: null });
      const newCred = { email, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, tokens };
      writeCred(newCred, email);
      const resolvedProject = resolveProject(projectArg);
      if (resolvedProject) writeAdc(newCred, resolvedProject);
      console.error(`✓  signed in as ${email}`);
      console.log(email);
      process.exit(0);
    } catch (e) {
      console.error(`error: ${e.message}`);
      process.exit(2);
    }
  }

  let account;
  try {
    account = resolveAccount(arg);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(2);
  }
  const credLabel = credPath(account);

  if (status) {
    const cred = readCred(account);
    if (!cred) {
      console.log(`no cred file at ${credLabel} — sign-in required`);
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

  // The bare auth path exists to set up ADC. Without a resolved project,
  // writeAdc is skipped and we'd exit 0 having silently left any stale/broken
  // ADC in place — the caller then thinks auth is ready and fails later with a
  // confusing 403 / undefined quota_project_id. Fail loudly instead. --token
  // (print-only) and --status (read-only) legitimately need no project and are
  // already handled above, so this only gates the ADC-writing path.
  if (!wantsToken && !resolveProject(projectArg)) {
    console.error(
      'error: no project resolved — refusing to auth without writing ADC.\n' +
      '       pass --project=<id>, or set THIS_PROJECT_ID_ON_GOOGLE_HOSTING in the project .env.\n' +
      '       (use --token to just print an access token without touching ADC.)',
    );
    process.exit(2);
  }

  try {
    const token = await ensureValidToken({ force, account, project: projectArg });
    if (wantsToken) console.log(token);
    process.exit(0);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(2);
  }
}
