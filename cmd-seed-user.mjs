#!/usr/bin/env node
// Backgrounded by `npm run start:emulators`. Waits for the Firestore
// emulator to come up, reads the project owner's email from .env
// (EMAIL_OF_GOOGLE_HOSTING_ACCOUNT), and seeds `/users/{email}` if missing. Idempotent.
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
// the change here.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve .env relative to this script's own location, not process.cwd().
// npm scripts normally run with cwd at the project root, but `npm --prefix`,
// certain hooks, and some launchers don't.
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = join(PROJECT_ROOT, '.env');

const PROJECT_ID = 'demo-not-required';
const FIRESTORE = 'http://localhost:8080';
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 500;

async function main() {
  await waitForFirestore();
  const email = readOwnerEmail();
  if (!email) return; // already logged the reason

  const present = await isSeeded(email);
  if (present) {
    log(`${email} already on users`);
    return;
  }
  await seed(email);
  log(`seeded ${email} on users`);
}

function readOwnerEmail() {
  if (!existsSync(ENV_FILE)) {
    log(`${ENV_FILE} missing — skipping seed`);
    return null;
  }
  try {
    const text = readFileSync(ENV_FILE, 'utf8');
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^EMAIL_OF_GOOGLE_HOSTING_ACCOUNT\s*=\s*(.*)$/);
      if (!m) continue;
      let v = m[1].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (v) return v;
    }
    log(`EMAIL_OF_GOOGLE_HOSTING_ACCOUNT not set in ${ENV_FILE} — skipping seed`);
    return null;
  } catch (e) {
    log(`${ENV_FILE} unreadable: ${e.message} — skipping seed`);
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

async function isSeeded(email) {
  const url = `${FIRESTORE}/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(email)}`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer owner' } });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(`probe returned unexpected status ${res.status}`);
}

async function seed(email) {
  const url = `${FIRESTORE}/v1/projects/${PROJECT_ID}/databases/(default)/documents/users?documentId=${encodeURIComponent(email)}`;
  const body = {
    fields: {
      email: { stringValue: email },
      admin: { booleanValue: true },
      addedAt: { integerValue: String(Date.now()) },
      addedBy: { stringValue: 'bootstrap' },
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer owner',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`seed write failed: ${res.status} ${await res.text()}`);
  }
}

function log(msg) {
  // Tagged stderr — emulator stdout (the actual logs) stays clean.
  process.stderr.write(`[seed-user] ${msg}\n`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => log(`failed: ${e.message}`));
