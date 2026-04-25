#!/usr/bin/env node
//
// REST-only Firebase Hosting + Firestore Rules deploy.
//
// Why this exists:
//   firebase-tools requires its own scope set on the OAuth token. We
//   authenticate via gcloud's shared OAuth client, which won't grant the
//   firebase scope (Google restricts it). Service-account keys would also
//   work, but Cloud Identity Free orgs ship with key creation disabled at
//   the org level. Both wrappers fail. This script calls the underlying
//   REST APIs directly using whatever access token we already have —
//   exactly what firebase-tools and SA-auth ultimately do anyway.
//
// Usage: node scripts/deploy-rest.mjs <project> <site> <publicDir> <accessToken> [<rulesFile>]

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const [, , project, site, publicDir, accessToken, rulesFile] = process.argv;
if (!project || !site || !publicDir || !accessToken) {
  console.error('usage: deploy-rest.mjs <project> <site> <publicDir> <accessToken> [<rulesFile>]');
  process.exit(2);
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
