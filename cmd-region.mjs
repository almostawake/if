#!/usr/bin/env node
//
// cmd-region.mjs — the one place the project's region is read from.
//
// Source of truth: THIS_PROJECT_REGION_ON_GOOGLE_HOSTING in root .env — the
// immutable region of the project's Firestore database, recorded there at
// project creation by n. Same trust model as THIS_PROJECT_ID_ON_GOOGLE_HOSTING:
// .env is the local record of what the project was created as.
//
// Two consumers, one reader, so no literal region can drift:
//
//   1. Run as a script (first step of the functions build — see
//      functions/package.json `build` / `build:watch`): writes
//      functions/src/region.ts so the Cloud Functions deploy region is baked
//      into the compiled code. It CAN'T be passed as an env var: firebase-tools
//      runs functions discovery in a subprocess with a fixed, minimal env that
//      user values never reach (and the FIREBASE_ prefix is reserved besides).
//      region.ts is gitignored — every build regenerates it, so it's always
//      present and current, and nothing fake is ever committed.
//
//   2. Imported (client/vite.config.ts): `projectRegion()` gives the Vite dev
//      proxy the region segment of the Functions emulator URL, which is
//      /<project>/<region>/<function> — the emulator honours the same
//      setGlobalOptions region the deploy does.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Resolve paths relative to this script, not cwd — the functions build runs
// it with cwd set to functions/ (`npm --prefix functions run build`), and Vite
// loads it from client/.
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(ROOT, '.env');
const OUT_FILE = path.join(ROOT, 'functions', 'src', 'region.ts');
const KEY = 'THIS_PROJECT_REGION_ON_GOOGLE_HOSTING';

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

// The project's region, e.g. "australia-southeast1". Throws if root .env
// doesn't carry it — there is deliberately no default: a guessed region
// would put functions (or the dev proxy) somewhere other than the data.
export function projectRegion() {
  const region = readEnvVar(KEY);
  if (!region) {
    throw new Error(
      `${KEY} not set in .env\n` +
      "       It is the immutable region of the project's Firestore database,\n" +
      '       recorded at project creation. If .env is missing it, add it by\n' +
      '       hand (see docs/CLAUDE-STACK.md → Region).',
    );
  }
  return region;
}

// Script mode: generate functions/src/region.ts.
const runAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (runAsScript) {
  let region;
  try {
    region = projectRegion();
  } catch (e) {
    console.error(`error: ${e.message}`);
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
}
