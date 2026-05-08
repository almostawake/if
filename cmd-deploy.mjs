#!/usr/bin/env node
//
// cmd-deploy.mjs — thin wrapper around `firebase deploy`.
//
// Invoked by the npm `deploy*` scripts (see package.json). Args after
// the script name flow through to firebase-tools, so:
//   npm run deploy:functions   →  firebase deploy --only functions
//   npm run deploy -- --debug  →  firebase deploy --debug
//
// Auth model: firebase-tools runs in ADC mode. We synthesize a one-off
// .adc.json from the project's stored OAuth refresh token (written by
// cmd-auth.mjs at .env.auth.json or .env.auth.<email>.json), point
// GOOGLE_APPLICATION_CREDENTIALS at it, and let firebase-tools refresh
// as needed. Cleaned up in the finally block.
//
// Why ADC instead of `firebase login`: gcloud's shared OAuth client
// (which we re-use to dodge the per-project Firebase scope grant) can't
// satisfy firebase-tools' own scope check on `firebase login` tokens.
// ADC sidesteps that — firebase-tools trusts ADC creds and lets the
// underlying APIs decide. cloud-platform scope covers everything.
//
// Inputs (.env or process.env):
//   THIS_PROJECT_ID_ON_GOOGLE_HOSTING  required — the GCP/Firebase project id
//   ACCOUNT_EMAIL                      optional — picks .env.auth.<email>.json
//                                      (defaults to .env.auth.json)

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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

const project = process.env.THIS_PROJECT_ID_ON_GOOGLE_HOSTING;
if (!project) {
  console.error('error: THIS_PROJECT_ID_ON_GOOGLE_HOSTING not set (expected in .env)');
  process.exit(2);
}

// File resolution: prefer .env.auth.<ACCOUNT_EMAIL>.json when the
// per-account file exists; otherwise fall back to the default
// .env.auth.json. n's first-deploy writes ACCOUNT_EMAIL but only the
// default cred file (no per-account rename), so the fallback is what
// makes that flow work without special-casing.
const account = process.env.ACCOUNT_EMAIL;
const perAccount = account ? `.env.auth.${account}.json` : null;
const defaultFile = '.env.auth.json';
const authFile =
  perAccount && fs.existsSync(perAccount) ? perAccount :
  fs.existsSync(defaultFile) ? defaultFile :
  null;
if (!authFile) {
  const hint = account ? ` -- ${account}` : '';
  console.error(`error: no .env.auth*.json found — run \`npm run auth${hint}\` first`);
  process.exit(2);
}

const auth = JSON.parse(fs.readFileSync(authFile, 'utf8'));
const adcPath = path.resolve('.adc.json');
fs.writeFileSync(
  adcPath,
  JSON.stringify({
    type: 'authorized_user',
    client_id: auth.client_id,
    client_secret: auth.client_secret,
    refresh_token: auth.tokens.refresh_token,
  }),
  { mode: 0o600 }
);

const passthrough = process.argv.slice(2);
const args = ['firebase', 'deploy', '--project', project, ...passthrough];
console.log(`deploy: project=${project} auth=${authFile} → npx ${args.join(' ')}`);

let exitCode = 0;
try {
  const result = spawnSync('npx', args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      GOOGLE_APPLICATION_CREDENTIALS: adcPath,
      GOOGLE_CLOUD_QUOTA_PROJECT: project,
    },
  });
  exitCode = result.status ?? 1;
} finally {
  try { fs.unlinkSync(adcPath); } catch { /* already gone */ }
}
process.exit(exitCode);
