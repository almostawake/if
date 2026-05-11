#!/usr/bin/env node
// Backgrounded by `npm run start:emulators`. Waits for the Firestore
// emulator to come up, reads the project owner's email from
// .env.auth.json, and seeds `/allowedAdmins/{email}` if missing. Idempotent.
//
// Why: a fresh `emulator-data/` has an empty `allowedAdmins` collection,
// so the /admin email-link sign-in silently bounces until something
// seeds the owner. Doing it on every emulator start removes the
// dependency on the LLM remembering to run a manual probe.
//
// Pure Node — no `jq`, no `curl`. Uses the admin-bypass header
// (`Authorization: Bearer owner`) to skip security rules.

import { existsSync, readFileSync } from 'node:fs';

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
    log(`${email} already on allowedAdmins`);
    return;
  }
  await seed(email);
  log(`seeded ${email} on allowedAdmins`);
}

function readOwnerEmail() {
  if (!existsSync('.env.auth.json')) {
    log('.env.auth.json missing — skipping seed (run `npm run auth` first)');
    return null;
  }
  try {
    const { email } = JSON.parse(readFileSync('.env.auth.json', 'utf8'));
    if (!email) {
      log('.env.auth.json has no `email` field — skipping seed');
      return null;
    }
    return email;
  } catch (e) {
    log(`.env.auth.json unreadable: ${e.message} — skipping seed`);
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
  const url = `${FIRESTORE}/v1/projects/${PROJECT_ID}/databases/(default)/documents/allowedAdmins/${encodeURIComponent(email)}`;
  const res = await fetch(url, { headers: { Authorization: 'Bearer owner' } });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(`probe returned unexpected status ${res.status}`);
}

async function seed(email) {
  const url = `${FIRESTORE}/v1/projects/${PROJECT_ID}/databases/(default)/documents/allowedAdmins?documentId=${encodeURIComponent(email)}`;
  const body = {
    fields: {
      email: { stringValue: email },
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
  process.stderr.write(`[seed-admin] ${msg}\n`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => log(`failed: ${e.message}`));
