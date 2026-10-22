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
//   1. Resolve account → ~/.if/creds/google.<email>.json.
//   2. Read cred file. Missing → grant flow.
//   3. Probe stored access_token against userinfo. 200 → done.
//   4. On 401/403 → POST refresh_token. 200 → atomic write-back, done.
//   5. On 400 invalid_grant → grant flow.
//   6. Other refresh failures → throw (network, 5xx, etc.).
//
// Library:  import { ensureValidToken, googleFetch } from './cmd-auth.mjs'
//             ensureValidToken()                       — resolves account (above)
//             ensureValidToken({ account: '<email>' }) — explicit
//             googleFetch(url, init?, { account?, project? })
//                 fetch() with BOTH headers a Google REST call needs
//                 (bearer token + x-goog-user-project). Use this for every
//                 Google API call; see "Quota project" below.
// CLI:      node cmd-auth.mjs                         resolves account (above)
//           node cmd-auth.mjs <email>                 per-account
//           node cmd-auth.mjs [<email>] --status      probe-only
//           node cmd-auth.mjs [<email>] --force       force fresh grant
//           node cmd-auth.mjs [<email>] --token       print access_token
//                                                     (token ONLY — see
//                                                     --headers for curl)
//           node cmd-auth.mjs [<email>] --headers     print the two request
//                                                     headers, one per line:
//                                                     curl -H @<(node cmd-auth.mjs --headers) URL
//           node cmd-auth.mjs [<email>] --project=<id> quota project for
//                                                     --headers; also written
//                                                     into ADC
//           node cmd-auth.mjs --discover              first-time sign-in
//                                                     (no account known up
//                                                     front; reads email
//                                                     from userinfo, writes
//                                                     ~/.if/creds/google.
//                                                     <email>.json, prints
//                                                     the discovered email
//                                                     to stdout)
//           node cmd-auth.mjs [...] --incognito        open consent in an
//                                                     incognito window (no
//                                                     saved Google sessions;
//                                                     combine with --force
//                                                     or --discover)
//           node cmd-auth.mjs --update                refresh the central
//                                                     copy at ~/.if/cmd-auth.mjs
//                                                     from GitHub main
//
// Quota project (x-goog-user-project) — READ THIS before any REST call:
//           The cred is a plain user sign-in, not a project credential.
//           Google therefore needs to be told which project each API call
//           is metered against. A bearer token alone CANNOT carry that;
//           it goes in a per-request header:
//               x-goog-user-project: <project id>
//           Without it the Firebase management, Hosting, Identity Toolkit
//           (Auth admin), Service Usage, Cloud Functions, Logging and most
//           other *.googleapis.com management APIs fail with
//               403 PERMISSION_DENIED / reason SERVICE_DISABLED
//               "consumer": "projects/32555940559"
//           32555940559 is Google's own gcloud OAuth client project, NOT
//           yours — that error means the header is missing, never that the
//           API is disabled. The Firestore data API and Cloud Storage
//           object API happen to work without the header, which is why a
//           session gets one good result and then a baffling 403 on the
//           next call. On *.googleapis.com cloud APIs the header is harmless
//           where it isn't needed, so ALWAYS send it: googleFetch() and
//           --headers do. (Known exception: the OAuth userinfo endpoint
//           rejects it — that is not a cloud API; probe() uses plain fetch.)
//           Project resolution: { project } / --project=<id> → (googleFetch
//           only) the /projects/<id>/ segment of the URL → THIS_PROJECT_ID_ON
//           _GOOGLE_HOSTING in the .env beside this file (the project's, not
//           the shell's cwd). None → hard error, never a silent omission.
//
// One copy per machine: this file also lives at ~/.if/cmd-auth.mjs (n
//           keeps it fresh; --update refreshes it by hand). A project copy
//           of this file delegates to that central copy when it is present
//           and at least as new (VERSION below), passing its own folder as
//           the project root so .env lookups still hit the project. So
//           every checkout runs the same code regardless of when it was
//           cloned. Set IF_CMD_AUTH_LOCAL=1 to force the local copy.
//
// Storage:  ~/.if/creds/google.<email>.json   (chmod 600, dir 700)
//           Outside the project tree on purpose — same Google account is
//           reused across multiple projects; nothing project-scoped here.
//           At module load, any project-local .env.auth*.json files
//           (the historic pre-migration location) are silently removed
//           from PROJECT_ROOT — those creds are no longer read and lying
//           around in the tree only invites confusion.
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
// every Firebase + GCP REST API this project uses.

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

// Bump when behaviour changes. A project copy only delegates to the central
// copy when the central VERSION is >= its own (string compare on the date).
export const VERSION = '2026-10-22';
const RAW_URL = 'https://raw.githubusercontent.com/almostawake/if/main/cmd-auth.mjs';

const SELF = fileURLToPath(import.meta.url);
const CENTRAL = path.join(os.homedir(), '.if', 'cmd-auth.mjs');
// The folder whose .env we read. A delegating project copy sets
// IF_PROJECT_ROOT to its own folder before importing the central copy.
const PROJECT_ROOT = process.env.IF_PROJECT_ROOT || path.dirname(SELF);
const CREDS_DIR = path.join(os.homedir(), '.if', 'creds');

// Delegation: when this is a project copy and a central copy exists that is
// at least as new, load the central copy and route every export through it.
// `impl` stays null when we ARE the central copy, when none exists, when
// it is older, or when IF_CMD_AUTH_LOCAL is set.
let impl = null;
{
  const same = (a, b) => { try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return false; } };
  if (!process.env.IF_CMD_AUTH_LOCAL && fs.existsSync(CENTRAL) && !same(SELF, CENTRAL)) {
    process.env.IF_PROJECT_ROOT = PROJECT_ROOT;
    try {
      const m = await import(pathToFileURL(CENTRAL).href);
      if (typeof m.runCli === 'function' && typeof m.VERSION === 'string' && m.VERSION >= VERSION) impl = m;
    } catch (e) {
      console.error(`   (central ${CENTRAL} failed to load — using local copy: ${e.message})`);
    }
  }
}
// Central, machine-wide if config (project parent, default account).
// We read it as the account fallback.
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
  return path.join(CREDS_DIR, `google.${account}.json`);
}

// Silently delete any historic project-local cred files. They're no
// longer read by anything; if their refresh tokens are still valid the
// equivalent now lives at ~/.if/creds/google.<email>.json. If not,
// `npm run auth` re-grants. Runs once at module load.
function scrubLegacyCreds() {
  let entries;
  try { entries = fs.readdirSync(PROJECT_ROOT); }
  catch { return; }
  for (const name of entries) {
    if (name === '.env.auth.json' || /^\.env\.auth\..+\.json$/.test(name)) {
      try { fs.unlinkSync(path.join(PROJECT_ROOT, name)); } catch { /* best-effort */ }
    }
  }
}
scrubLegacyCreds();

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

function openBrowser(url, { incognito = false } = {}) {
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
  // this form. --incognito rides along in "$@" and Chrome honours it even
  // when Chrome-Claude is already running (the singleton opens a fresh
  // incognito window). Only the launcher path supports it: `open URL` to
  // the default browser has no way to ask for incognito.
  const launcherApp = path.join(
    process.env.HOME || '',
    'Applications/Chrome with Claude Code.app'
  );
  if (fs.existsSync(launcherApp)) {
    console.error(`   (opening in Chrome with Claude Code${incognito ? ', incognito' : ''})`);
    const chromeArgs = incognito ? ['--incognito', url] : [url];
    spawn('open', ['-a', launcherApp, '--args', ...chromeArgs], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  console.error(`   (launcher not found at ${launcherApp} — using default browser${incognito ? '; --incognito ignored' : ''})`);
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

async function grant({ timeoutMs, account, incognito = false }) {
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
      openBrowser(url, { incognito });
      timer = setTimeout(() => {
        cleanup();
        reject(new Error(`browser consent timed out after ${secs}s`));
      }, timeoutMs);
    });
  });
}

// Returns a fresh, valid access_token. Side effects: may write the cred
// file at ~/.if/creds/google.<email>.json, and (when `project` is
// resolved via arg or .env) also writes/refreshes ADC at the gcloud
// conventional location so non-cmd-auth-aware code can refresh tokens
// against the same cred. Throws when no valid path forward exists
// (network down, user dismissed, etc.) or when neither `account` nor
// EMAIL_OF_GOOGLE_HOSTING_ACCOUNT in .env identifies an account.
export function ensureValidToken(opts = {}) {
  return impl ? impl.ensureValidToken(opts) : _ensureValidToken(opts);
}

async function _ensureValidToken({ force = false, account, project, incognito = false } = {}) {
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

  const { email, tokens } = await grant({ timeoutMs: BROWSER_TIMEOUT_MS, account: resolved, incognito });
  const newCred = { email, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, tokens };
  writeCred(newCred, resolved);
  if (resolvedProject) writeAdc(newCred, resolvedProject);
  console.error(`✓  signed in as ${email}`);
  return tokens.access_token;
}

// The /projects/<id>/ segment most Google REST URLs carry. Project ids are
// lowercase letters, digits and hyphens; project numbers are digits.
function projectFromUrl(url) {
  const m = String(url).match(/\/projects\/([a-z0-9][a-z0-9-]*)(?=[/:?#]|$)/);
  return m ? m[1] : null;
}

// Resolve the quota project for a request, or throw. Order: explicit → the
// /projects/<id>/ in the URL (the call names its own project; metering a
// call to project A against project B's .env would be wrong) → project .env
// (for URLs with no project segment: listing projects, billing accounts).
// Never returns null: a missing quota project is the single most common
// cause of a confusing 403, so fail here, loudly.
function requireQuotaProject(project, url) {
  const p = project || (url ? projectFromUrl(url) : null) || resolveProject(null);
  if (p) return p;
  throw new Error(
    'no quota project: pass { project } / --project=<id>, set ' +
    'THIS_PROJECT_ID_ON_GOOGLE_HOSTING in .env, or call a URL that contains /projects/<id>/',
  );
}

// The two headers every Google REST call needs. Resolves account + project
// the same way the CLI does; throws when either is unknown.
async function authHeaders({ account, project, url } = {}) {
  const quota = requireQuotaProject(project, url);
  const token = await _ensureValidToken({ account, project: project || null });
  return { Authorization: `Bearer ${token}`, 'x-goog-user-project': quota };
}

// fetch() for Google REST APIs. Adds the bearer token and the quota-project
// header (an x-goog-user-project the caller already set wins). Same
// signature as fetch plus an options bag; returns the Response untouched.
export function googleFetch(url, init = {}, opts = {}) {
  return impl ? impl.googleFetch(url, init, opts) : _googleFetch(url, init, opts);
}

async function _googleFetch(url, init = {}, { account, project, timeoutMs } = {}) {
  const headers = new Headers(init.headers || {});
  const auth = await authHeaders({ account, project, url });
  headers.set('Authorization', auth.Authorization);
  if (!headers.has('x-goog-user-project')) headers.set('x-goog-user-project', auth['x-goog-user-project']);
  return fetchWithTimeout(url, { ...init, headers }, timeoutMs);
}

// --update: refresh the central copy from GitHub main. No auth needed.
async function updateCentral() {
  const res = await fetchWithTimeout(RAW_URL);
  if (!res.ok) throw new Error(`fetch ${RAW_URL} failed (${res.status})`);
  const text = await res.text();
  const m = text.match(/^export const VERSION = '([^']+)'/m);
  if (!m) throw new Error('downloaded file has no VERSION line — refusing to install it');
  fs.mkdirSync(path.dirname(CENTRAL), { recursive: true });
  const tmp = `${CENTRAL}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, CENTRAL);
  console.error(`✓  ${CENTRAL} is now VERSION ${m[1]}`);
}

// CLI. Exported so a project copy can hand its argv to the central copy.
export function runCli(args) {
  return impl ? impl.runCli(args) : _runCli(args);
}

async function _runCli(args) {
  const force = args.includes('--force');
  const status = args.includes('--status');
  const wantsToken = args.includes('--token');
  const wantsHeaders = args.includes('--headers');
  const discover = args.includes('--discover');
  // --incognito: open the consent page in an incognito window so no saved
  // Google session is offered. Only matters when a browser grant actually
  // happens (--force, --discover, or no usable cred) — a silent refresh
  // never opens a browser, so on its own the flag is a no-op.
  const incognito = args.includes('--incognito');

  if (args.includes('--update')) {
    try { await updateCentral(); process.exit(0); }
    catch (e) { console.error(`error: ${e.message}`); process.exit(2); }
  }
  // --project=<id> for ADC writing. Empty value treated as not-set so
  // `--project=` doesn't poison ADC with an empty quota_project_id.
  const projectFlag = args.find(a => a.startsWith('--project='));
  const projectArg = projectFlag ? projectFlag.slice('--project='.length) || null : null;
  // First non-flag arg = explicit account; else fall back to EMAIL_OF_GOOGLE_HOSTING_ACCOUNT in .env.
  const arg = args.find(a => !a.startsWith('--'));

  // Discovery mode: no account known up front. Run the OAuth flow, read
  // userinfo.email, write the cred file using that email, print the email
  // to stdout. Used for first-time sign-in where the account is
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
      const { email, tokens } = await grant({ timeoutMs: BROWSER_TIMEOUT_MS, account: null, incognito });
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
    const viaCentral = process.env.IF_PROJECT_ROOT && PROJECT_ROOT !== path.dirname(SELF);
    console.error(`   (cmd-auth ${VERSION}${viaCentral ? ` via ${CENTRAL}` : ''}, project root ${PROJECT_ROOT})`);
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

  // --headers: both request headers, one per line, for curl -H @file.
  if (wantsHeaders) {
    try {
      const h = await authHeaders({ account, project: projectArg });
      for (const [k, v] of Object.entries(h)) console.log(`${k}: ${v}`);
      process.exit(0);
    } catch (e) {
      console.error(`error: ${e.message}`);
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
    const token = await _ensureValidToken({ force, account, project: projectArg, incognito });
    if (wantsToken) {
      console.log(token);
      if (!resolveProject(projectArg)) {
        console.error('   note: a token alone is not enough for most Google management APIs —');
        console.error('         add `x-goog-user-project: <project id>` to each request, or use --headers.');
      }
    }
    process.exit(0);
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(2);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await runCli(process.argv.slice(2));
