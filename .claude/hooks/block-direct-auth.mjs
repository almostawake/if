#!/usr/bin/env node
//
// PreToolUse hook for Bash. Blocks direct invocations of firebase /
// firebase-tools / gcloud login commands so they don't shadow this
// template's auth flow (cmd-auth.mjs writing to .env.auth.json).
//
// Allowed: firebase emulators:*, gcloud auth list / print-access-token /
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
    "Blocked: this template manages Google OAuth via cmd-auth.mjs " +
    "(project-local cred at .env.auth.json). Run 'node cmd-auth.mjs' " +
    "instead. firebase emulators commands are unaffected."
  );
  process.exit(2);
}
