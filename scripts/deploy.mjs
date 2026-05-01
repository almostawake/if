#!/usr/bin/env node
//
// Firebase Hosting + Firestore Rules deploy via REST.
//
// THE deploy script for this template — see CLAUDE.md § Deploying.
//
// Why REST instead of `firebase deploy`:
//   firebase-tools requires its own scope set on the OAuth token. We
//   authenticate via gcloud's shared OAuth client, which won't grant the
//   firebase scope (Google restricts it). Service-account keys would also
//   work, but Cloud Identity Free orgs ship with key creation disabled at
//   the org level. Both wrappers fail. This script calls the underlying
//   REST APIs directly using whatever access token we already have —
//   exactly what firebase-tools and SA-auth ultimately do anyway.
//
// Usage:
//   node scripts/deploy.mjs           # everything from .env + defaults
//
// Inputs (in priority order):
//   PROJECT_ID            from .env (required)  — the GCP/Firebase project id
//   ACCOUNT_EMAIL         .env / env (optional) — which Google account to deploy as
//   GOOGLE_ACCESS_TOKEN   env var (optional)    — explicit token (used by setup-project's first-deploy)
//   PROJECT_SITE          .env / env (optional) — Firebase Hosting site (default: PROJECT_ID)
//   PUBLIC_DIR            .env / env (optional) — built static dir   (default: client/build)
//   RULES_FILE            .env / env (optional) — firestore rules    (default: firestore.rules)
//
// Token resolution (in order; first hit wins):
//   1. GOOGLE_ACCESS_TOKEN env var        — explicit override.
//   2. ~/.if/creds/<ACCOUNT_EMAIL>.json   — the if-tooling cred store written by
//                                           setup-project's OAuth flow. We read the
//                                           access_token, probe userinfo, and
//                                           refresh via refresh_token if the probe
//                                           401s. New tokens are written back
//                                           atomically. Per ~/.if/creds/CLAUDE.md:
//                                           NEVER re-prompt for OAuth just because
//                                           access_token expired.
//   3. gcloud auth print-access-token --account=$ACCOUNT_EMAIL  — dev-machine
//                                           fallback when the if cred store
//                                           isn't populated.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

// Minimal .env loader: KEY=VALUE per line, # comments, optional surrounding
// quotes. Existing process.env entries win, so callers can override.
function loadDotenv(file = '.env') {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let [, k, v] = m;
    v = v.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadDotenv();

const project = process.env.PROJECT_ID;
if (!project) {
  console.error('error: PROJECT_ID not set (expected in .env at project root)');
  process.exit(2);
}
const site = process.env.PROJECT_SITE || project;
const publicDir = process.env.PUBLIC_DIR || 'client/build';
const rulesFile = process.env.RULES_FILE || 'firestore.rules';

// Read ~/.if/creds/<email>.json, probe the access_token, refresh it if expired,
// write the new tokens back atomically. Returns a fresh access_token, or null
// if the cred file doesn't exist. Throws on hard failures (refresh_token revoked,
// I/O errors), so the caller gets a clear stop rather than silent fallthrough.
async function tokenFromCredFile(email) {
  const credPath = path.join(os.homedir(), '.if', 'creds', `${email}.json`);
  if (!fs.existsSync(credPath)) return null;
  const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  const stored = cred.tokens?.access_token;

  // Cheap validity probe — same endpoint ~/.if/creds/CLAUDE.md recommends.
  if (stored) {
    const probe = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${stored}` }
    });
    if (probe.ok) return stored;
    if (probe.status !== 401 && probe.status !== 403) {
      throw new Error(`unexpected ${probe.status} probing access_token: ${(await probe.text()).slice(0, 300)}`);
    }
    // 401/403 → fall through to refresh.
  }

  const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cred.client_id,
      client_secret: cred.client_secret,
      refresh_token: cred.tokens.refresh_token,
      grant_type: 'refresh_token'
    })
  });
  const refreshText = await refreshRes.text();
  if (!refreshRes.ok) {
    if (refreshRes.status === 400 && /invalid_grant/.test(refreshText)) {
      throw new Error(
        `refresh_token revoked for ${email} (Google returned invalid_grant). ` +
        `Re-run setup-project (or re-OAuth manually) to mint a new one.`
      );
    }
    throw new Error(`token refresh failed (${refreshRes.status}): ${refreshText.slice(0, 300)}`);
  }
  const newTokens = JSON.parse(refreshText);
  // Google sometimes omits a fresh refresh_token in the response — preserve the old one.
  if (!newTokens.refresh_token) newTokens.refresh_token = cred.tokens.refresh_token;

  // Atomic write-back: tmp + chmod + rename, so a crash mid-write can't leave
  // a corrupt cred file.
  const updated = { ...cred, tokens: newTokens };
  const tmp = `${credPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(updated, null, 2));
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, credPath);

  return newTokens.access_token;
}

const accountEmail = process.env.ACCOUNT_EMAIL || '';
let accessToken = process.env.GOOGLE_ACCESS_TOKEN;
let tokenSource = accessToken ? 'env:GOOGLE_ACCESS_TOKEN' : '';

if (!accessToken && accountEmail) {
  try {
    const t = await tokenFromCredFile(accountEmail);
    if (t) { accessToken = t; tokenSource = `~/.if/creds/${accountEmail}.json`; }
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(2);
  }
}

if (!accessToken) {
  // dev-machine fallback: gcloud. Fine on workstations that have gcloud
  // installed and `gcloud auth login`'d the right account.
  const cmd = accountEmail
    ? `gcloud auth print-access-token --account=${accountEmail}`
    : 'gcloud auth print-access-token';
  try {
    accessToken = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    tokenSource = `gcloud${accountEmail ? `:${accountEmail}` : ''}`;
  } catch {
    console.error(`error: no token available for ${accountEmail || '(no ACCOUNT_EMAIL)'}.`);
    console.error('  tried: $GOOGLE_ACCESS_TOKEN, ~/.if/creds/<email>.json, gcloud.');
    if (accountEmail) {
      console.error(`  fix:   re-run setup-project, or \`gcloud auth login ${accountEmail}\`.`);
    } else {
      console.error('  fix:   set ACCOUNT_EMAIL in .env, then re-run.');
    }
    process.exit(2);
  }
}

console.log(`deploy: project=${project} site=${site} publicDir=${publicDir} rules=${rulesFile} token=${tokenSource}`);

// Build first — these projects are tiny and the cost is trivial. Always
// pushing fresh output beats the "I deployed but my changes aren't live"
// trap. Stream the build output through so users see it.
console.log('\n[build] npm run build:all');
try {
  execSync('npm run build:all', { stdio: 'inherit' });
} catch {
  // npm itself prints the error; we just need to bail with a non-zero exit.
  process.exit(1);
}

const auth = { Authorization: `Bearer ${accessToken}`, 'X-Goog-User-Project': project };

async function api(method, url, { body, headers = {}, raw } = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...auth, ...headers, ...(body && !raw ? { 'Content-Type': 'application/json' } : {}) },
    body: raw ? body : body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 600)}`);
  return text ? (text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text) : null;
}

// Walk publicDir, gzip + sha256 each file. Returns Map<webPath, {hash, gz}>.
function gatherFiles(dir, prefix = '') {
  const out = new Map();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const web = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      for (const [k, v] of gatherFiles(full, web)) out.set(k, v);
    } else {
      const raw = fs.readFileSync(full);
      // Hosting requires the *gzip-compressed* representation hashed and uploaded.
      const gz = zlib.gzipSync(raw, { level: 9 });
      const hash = crypto.createHash('sha256').update(gz).digest('hex');
      out.set(web, { hash, gz });
    }
  }
  return out;
}

async function deployHosting() {
  console.log(`\n[hosting] gathering files from ${publicDir}…`);
  const files = gatherFiles(publicDir);
  console.log(`[hosting] ${files.size} files`);

  console.log('[hosting] creating version…');
  const version = await api(
    'POST',
    `https://firebasehosting.googleapis.com/v1beta1/sites/${site}/versions`,
    {
      body: {
        config: {
          // SPA fallback: any unknown path serves /index.html so SvelteKit's
          // client-side router can take over.
          rewrites: [{ glob: '**', path: '/index.html' }]
        }
      }
    }
  );
  const versionName = version.name; // sites/{site}/versions/{id}
  console.log(`[hosting] version: ${versionName}`);

  console.log('[hosting] populateFiles (declares hashes)…');
  const filesMap = {};
  for (const [web, { hash }] of files) filesMap[web] = hash;
  const pop = await api('POST', `https://firebasehosting.googleapis.com/v1beta1/${versionName}:populateFiles`, {
    body: { files: filesMap }
  });
  const required = new Set(pop.uploadRequiredHashes ?? []);
  const uploadUrl = pop.uploadUrl; // base URL; append /<hash> for each upload
  console.log(`[hosting] ${required.size} files need upload`);

  // Upload each required hash.
  let i = 0;
  for (const [web, { hash, gz }] of files) {
    if (!required.has(hash)) continue;
    i++;
    const url = `${uploadUrl}/${hash}`;
    process.stdout.write(`  [${i}/${required.size}] ${web} (${gz.length}b)\r`);
    await api('POST', url, {
      raw: true,
      body: gz,
      headers: { 'Content-Type': 'application/octet-stream' }
    });
  }
  process.stdout.write('\n');

  console.log('[hosting] finalizing version…');
  await api('PATCH', `https://firebasehosting.googleapis.com/v1beta1/${versionName}?update_mask=status`, {
    body: { status: 'FINALIZED' }
  });

  console.log('[hosting] creating release…');
  await api(
    'POST',
    `https://firebasehosting.googleapis.com/v1beta1/sites/${site}/releases?versionName=${versionName}`
  );

  console.log(`[hosting] ✓ deployed: https://${site}.web.app`);
}

async function deployRules() {
  if (!rulesFile) {
    console.log('\n[rules] (skipped — no rulesFile arg)');
    return;
  }
  console.log(`\n[rules] uploading ${rulesFile}…`);
  const src = fs.readFileSync(rulesFile, 'utf8');
  const ruleset = await api('POST', `https://firebaserules.googleapis.com/v1/projects/${project}/rulesets`, {
    body: { source: { files: [{ name: 'firestore.rules', content: src }] } }
  });
  console.log(`[rules] ruleset: ${ruleset.name}`);

  // Update or create the cloud.firestore release pointing at this ruleset.
  const releaseName = `projects/${project}/releases/cloud.firestore`;
  try {
    await api('PATCH', `https://firebaserules.googleapis.com/v1/${releaseName}`, {
      body: { release: { name: releaseName, rulesetName: ruleset.name } }
    });
    console.log('[rules] ✓ release updated');
  } catch (e) {
    if (String(e).includes('404')) {
      await api('POST', `https://firebaserules.googleapis.com/v1/projects/${project}/releases`, {
        body: { name: releaseName, rulesetName: ruleset.name }
      });
      console.log('[rules] ✓ release created');
    } else {
      throw e;
    }
  }
}

await deployHosting();
await deployRules();
console.log('\nAll done.');
