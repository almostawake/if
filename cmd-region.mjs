#!/usr/bin/env node
//
// cmd-region.mjs — generate functions/src/region.ts from root .env.
//
// Runs as the first step of the functions build (see functions/package.json:
// `build` and `build:watch`), so the Cloud Functions deploy region is baked
// into the compiled code. It CAN'T be passed as an env var: firebase-tools
// runs functions discovery in a subprocess with a fixed, minimal env that
// user values never reach (and the FIREBASE_ prefix is reserved besides).
//
// functions/src/region.ts is gitignored — every build regenerates it, so it's
// always present and current, and nothing fake is ever committed.
//
// Source of truth: THIS_PROJECT_REGION_ON_GOOGLE_HOSTING in root .env — the
// immutable region of the project's Firestore database, recorded there at
// project creation. Same trust model as THIS_PROJECT_ID_ON_GOOGLE_HOSTING:
// .env is the local record of what the project was created as.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve paths relative to this script, not cwd — the functions build runs
// it with cwd set to functions/ (`npm --prefix functions run build`).
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(ROOT, '.env');
const OUT_FILE = path.join(ROOT, 'functions', 'src', 'region.ts');

function readEnvVar(key) {
  let text;
  try {
    text = fs.readFileSync(ENV_FILE, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return undefined;
    throw e;
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || m[1] !== key) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return undefined;
}

const region = readEnvVar('THIS_PROJECT_REGION_ON_GOOGLE_HOSTING');
if (!region) {
  console.error(
    'error: THIS_PROJECT_REGION_ON_GOOGLE_HOSTING not set in .env\n' +
    '       The functions build needs it to set the deploy region. It is the\n' +
    "       immutable region of the project's Firestore database — recorded\n" +
    '       at project creation. If .env is missing it, add it by hand\n' +
    '       (see docs/CLAUDE-STACK.md → Region).',
  );
  process.exit(2);
}

fs.writeFileSync(
  OUT_FILE,
  '// GENERATED — do not edit, gitignored. Written by cmd-region.mjs at the\n' +
  '// start of every functions build, from THIS_PROJECT_REGION_ON_GOOGLE_HOSTING\n' +
  '// in root .env. Baked into source because firebase-tools runs functions\n' +
  '// discovery in a subprocess with a fixed, minimal env — no env-var path in.\n' +
  `export const FUNCTIONS_REGION = ${JSON.stringify(region)};\n`,
);
console.error(`[cmd-region] functions/src/region.ts → ${region}`);
