#!/usr/bin/env node
// Backgrounded by `npm run start:emulators`. Waits for the Firestore
// emulator to come up, reads the project owner's email from
// .env.auth.json, and seeds `/users/{email}` if missing. Idempotent.
//
// Why: a fresh `emulator-data/` has an empty `users` collection, so
// the /admin email-link sign-in silently bounces until something
// seeds the owner. Doing it on every emulator start removes the
// dependency on the LLM remembering to run a manual probe.
//
// Pure Node — no `jq`, no `curl`. Uses the emulator's admin-bypass
// header (`Authorization: Bearer owner`) to skip security rules.
//
// Schema kept in sync by hand with `functions/src/common/User.ts` (the
// canonical zod schema). This script can't import that file directly —
// it's a standalone .mjs invoked before any TS build — so the field
// shape below is a deliberate duplicate. If you change User.ts, mirror
// the change here (and in aa/n's _seed_users provisioning step).

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve .env.auth.json relative to this script's own location, not
// process.cwd(). npm scripts normally run with cwd at the project root,
// but `npm --prefix`, certain hooks, and some launchers don't — and
// when that happened on a fresh VM, existsSync('.env.auth.json') was
// returning false even though the file was there.
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = join(PROJECT_ROOT, '.env.auth.json');

const PROJECT_ID = 'demo-not-required';
const FIRESTORE = 'http://localhost:8080';
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 500;

async function main() {
  await waitForFirestore();
  const email = readOwnerEmail();
  if (!email) return; // already logged the reason

  const created = await upsertSeed(email);
  log(created ? `seeded ${email} on users` : `re-asserted admin on ${email}`);
}

function readOwnerEmail() {
  if (!existsSync(AUTH_FILE)) {
    log(`${AUTH_FILE} missing — skipping seed (run \`npm run auth\` first)`);
    return null;
  }
  try {
    const { email } = JSON.parse(readFileSync(AUTH_FILE, 'utf8'));
    if (!email) {
      log(`${AUTH_FILE} has no \`email\` field — skipping seed`);
      return null;
    }
    return email;
  } catch (e) {
    log(`${AUTH_FILE} unreadable: ${e.message} — skipping seed`);
    return null;
  }
}

async function waitForFirestore() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(FIRESTORE + '/');
      if (res.status < 500) return;
    } catch {
      // Not up yet.
    }
    await sleep(READY_POLL_MS);
  }
  throw new Error(`Firestore emulator never came up at ${FIRESTORE}`);
}

// Upsert semantics: POST first (creates with addedAt=now); on 409 fall
// back to a PATCH with updateMask=admin so a re-seed re-asserts
// admin=true without trampling uid / lastSignInAt / the original
// addedAt that get written after first sign-in. Returns true if newly
// created, false if an existing row was re-asserted.
async function upsertSeed(email) {
  const createUrl = `${FIRESTORE}/v1/projects/${PROJECT_ID}/databases/(default)/documents/users?documentId=${encodeURIComponent(email)}`;
  const createBody = {
    fields: {
      email: { stringValue: email },
      admin: { booleanValue: true },
      addedAt: { integerValue: String(Date.now()) },
      addedBy: { stringValue: 'bootstrap' },
    },
  };
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify(createBody),
  });
  if (createRes.ok) return true;
  if (createRes.status !== 409) {
    throw new Error(`seed write failed: ${createRes.status} ${await createRes.text()}`);
  }

  const patchUrl = `${FIRESTORE}/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(email)}?updateMask.fieldPaths=admin`;
  const patchRes = await fetch(patchUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: { admin: { booleanValue: true } } }),
  });
  if (!patchRes.ok) {
    throw new Error(`seed re-assert failed: ${patchRes.status} ${await patchRes.text()}`);
  }
  return false;
}

function log(msg) {
  // Tagged stderr — emulator stdout (the actual logs) stays clean.
  process.stderr.write(`[seed-user] ${msg}\n`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => log(`failed: ${e.message}`));
