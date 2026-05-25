#!/usr/bin/env node
//
// PreToolUse hook for Bash. Blocks direct invocations of firebase /
// firebase-tools / gcloud login commands so they don't shadow this
// template's auth flow (npm run auth → cmd-auth.mjs → ~/.if/creds/).
//
// Allowed: firebase emulators:*, firebase deploy (called by the
// `npm run deploy*` wrapper), gcloud auth list / print-access-token /
// revoke / etc. — only the *login* sub-commands are blocked.
//
// Stdin contract: JSON with { tool_input: { command: "..." } }.
// Exit codes: 2 = block (stderr surfaced to model); 0 = allow.
//
// Node port of the original .sh for cross-platform support (Windows
// has no bash by default).

import fs from 'node:fs';

const input = fs.readFileSync(0, 'utf8');
const cmd = JSON.parse(input).tool_input?.command || '';

const BLOCKED = /(firebase|firebase-tools)\s+login|gcloud\s+auth\s+(application-default\s+)?login/;

if (BLOCKED.test(cmd)) {
  console.error(
    "Blocked: this template manages Google OAuth itself " +
    "(creds at ~/.if/creds/.env.auth.<email>.json). Run 'npm run auth' " +
    "instead (uses EMAIL_OF_GOOGLE_HOSTING_ACCOUNT from .env), or 'npm run auth -- <email>' " +
    "for a non-default account. firebase emulators and 'npm run deploy*' " +
    "are unaffected."
  );
  process.exit(2);
}
