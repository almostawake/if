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
//   node cmd-deploy.mjs           # everything from .env + defaults
//
// Inputs (in priority order):
//   PROJECT_ID            from .env (required)  — the GCP/Firebase project id
//   GOOGLE_ACCESS_TOKEN   env var (optional)    — explicit token (used by setup-project's first-deploy)
//   PROJECT_SITE          .env / env (optional) — Firebase Hosting site (default: PROJECT_ID)
//   PUBLIC_DIR            .env / env (optional) — built static dir   (default: client/build)
//   RULES_FILE            .env / env (optional) — firestore rules    (default: firestore.rules)
//
// Auth: delegates to cmd-auth.mjs (project-local cred at .env.auth.json).
// auth.mjs handles probe / refresh / grant transparently — deploy just
// awaits a valid token and proceeds. If GOOGLE_ACCESS_TOKEN is set,
// auth.mjs is skipped entirely (used by setup-project's first deploy).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { ensureValidToken } from './cmd-auth.mjs';

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

let accessToken = process.env.GOOGLE_ACCESS_TOKEN;
let tokenSource = accessToken ? 'env:GOOGLE_ACCESS_TOKEN' : '';

if (!accessToken) {
  try {
    accessToken = await ensureValidToken();
    tokenSource = '.env.auth.json';
  } catch (e) {
    console.error(`error: ${e.message}`);
    console.error('  fix: run `node cmd-auth.mjs` to authenticate.');
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
