# Purpose

This firebase/gcp project was set up from a template at github.com/almostawake/if 
Its primary purpose is to fast track small automation solutions for non-developers

The project is also home for the main scripts used for one-time osx install of dev apps like git/gh/chrome and per-project setup (including provisioning and deployment).
These live in scripts/ refer to the md there if you're asked to edit ANY scripts

# Ways of Working

Read the relevant topic file before working in its area:
- **docs/CLAUDE-STACK.md** — target tech stack and architecture, stick to these technologies, they are all pre-provisioned
- **docs/CLAUDE-SVELTE.md** — Svelte 5 rune conventions. Read before writing any Svelte code.

## How this template runs end-to-end

Three commands span the install → project → deploy lifecycle. Read this before debugging anything that crosses the script boundary.

1. **Bootstrap (once per machine)** — `curl -fsSL https://almostawake.com/i | bash` runs `aa/i`. Installs git + gh into `~/.if/`, clones this repo to `~/.if/staging`, then execs `scripts/install-dependencies` which installs node + java + claude code + chrome and writes a marker block to `~/.zshrc` (PATH, `PROJECT_DIR=$HOME/Projects`, the `setup-project` alias).

2. **Per-project setup (once per project)** — the `setup-project` alias runs `scripts/setup-project` from `~/.if/staging`. OAuth-signs the user into Google via a local perl HTTP server (stores tokens in `~/.if/creds/<email>.json` per the contract there); creates / picks a GCP project (`PID`); provisions ~21 APIs + Firestore (sydney) + Storage + Email Link auth; clones this template into `$PROJECT_DIR/<PID>`; writes `.env` (`PROJECT_ID`, `ACCOUNT_EMAIL`) and `client/.env.production` (Firebase web config — fetched via `webApps.getConfig`); seeds the user's email into `allowedEmails`; builds + deploys.

3. **Deploys (any time after)** — `node scripts/deploy.mjs` from the project root. Reads `.env` for `PROJECT_ID` + `ACCOUNT_EMAIL`, gets a fresh access_token from `~/.if/creds/<email>.json` (refreshing in place via the stored refresh_token if expired — never re-prompts OAuth just because of expiry), runs `npm run build:all`, then pushes hosting + firestore.rules via the Firebase REST APIs. See § Deploying for the why.

**The cred contract:** `~/.if/creds/<email>.json` is the source of truth for tokens. `setup-project` writes it post-OAuth; `deploy.mjs` reads it and refreshes-in-place. Full schema + refresh rules: `~/.if/creds/CLAUDE.md`. `gcloud auth print-access-token` is only a fallback when the cred file is missing.

## Non-technical Audience

The target user is a non-developer — a business analyst, project manager, or team lead building small personal-automation tools with Claude Code. Assume they do not know OAuth, serverless, or Firestore modelling; keep jargon to a minimum and offer to explain. When they ask for specific technology, clarify the functional requirement first rather than taking the technical direction at face value.

## Auth default

The template ships with **Firebase Auth Email Link sign-in** + an `allowedEmails` whitelist in Firestore. Flow: user enters email → gets a magic link by email → clicks it → signed in. They're only let through if their lowercased email exists in `/allowedEmails/{email}`. The project owner's email is seeded by `setup-project` so they can use the app on day one; they then add/remove others from the in-app users page.

Don't add Google OAuth, password auth, or other providers without asking. Email Link + whitelist is the chosen pattern: zero passwords, no consent-screen setup, easy to administrate. Point users here if they ask for "logins".

**On the Firebase Web "API key" (`AIzaSy…`) in `client/.env.production`:** it's a misnamed *public project identifier*, not a credential — see [Firebase docs](https://firebase.google.com/docs/projects/api-keys). Safe to ship in the bundle. Real auth is Firebase Auth ID tokens + Firestore security rules. `setup-project` writes this file post-clone via the Firebase Management API; never commit it (gitignored).

## User requirements
- If the user asks for something that will break the architecture or create debt, suggest alternatives from docs/CLAUDE-STACK.md first.
- If new patterns are needed, select on the basis of best-practice from senior devs and **prefer LLM-friendly / LLM-reliable technologies**. The whole point of this project is to pick a stack that LLMs produce correct code for on the first try.

## Before committing
- Run `npm run check` before completing any code-centric task/conversation. This runs `svelte-check` + `tsc` + `eslint`.
- Don't commit without passing check.
- Ask before committing.
- When committing, consider other changes may have occurred — summarise all changes in the commit message.

## Test UI changes
- Test significant UI changes before completing your turn. Use screenshots to verify layout/alignment.
- Use the Claude browser extension (NOT Puppeteer or Selenium). If it's not working, retry once, then stop and ask the user to resolve.
- Make → verify → fix → verify — this tight loop catches bugs that code review alone misses.

## Firebase emulators & dev server
- Always use npm scripts, never direct `firebase` commands:
  - Start emulators: `npm run start:emulators` — logs go to `/tmp/firebase-emulator.log`
  - Start client: `npm run start:client` (SvelteKit dev server, port 5173)
- On first browser interaction in a conversation, check if emulators (port 4000) and dev server (port 5173) are running. Start any that are down — in parallel, in the background.
- Check: `lsof -i :4000 >/dev/null 2>&1 && echo "running"` / `lsof -i :5173 >/dev/null 2>&1 && echo "running"`
- **Stop emulators:** `lsof -ti :4400 | xargs kill` (kills the hub, which gracefully shuts down all child emulators)
- **Stop dev server:** `lsof -ti :5173 | xargs kill`
- **Verify shutdown:** confirm all emulator ports are free before reporting success:
  `lsof -i :4000 -i :4400 -i :9099 -i :5001 -i :8080 -i :9199 >/dev/null 2>&1 || echo "all stopped"`
- The local project ID is `demo-not-required` — this is a Firebase emulator convention, not a real project. Do NOT try to `firebase use` it.
- Free local emulation is a deliberate constraint of this project. Do NOT suggest anything that requires a live Firebase project to develop against.
- Do NOT deploy unless the user explicitly asks.

### Emulator autonomy
You have full autonomy over emulator state. Don't hesitate to create users, log in/out, clear data, or load data — whatever is fastest to verify your work.

**Golden rule:** always use the app's own functions for every step — login, import, delete, etc. Never write directly to Firestore unless deliberately testing an edge case (e.g. simulating a stale schema). The app's flows create necessary parent docs, stamp schema versions, and maintain data integrity. Bypassing them causes subtle bugs (phantom docs, missing parent collections, stale caches).

**Auth helpers** (use via `javascript_tool`):
```js
const { getFirebase } = await import('/src/lib/firebase/init.ts');
const { auth } = getFirebase();
auth.currentUser   // → User | null
await auth.signOut();
```
Sign in goes through the app's email-link flow against the auth emulator's fake-link handler. Don't bypass it.

**Two ways to reset data:**

1. **Reset a user's data** — call the app's own delete/clear functions (e.g. via `javascript_tool` against an exported store action). The `users/{uid}` parent doc stays intact. Reload, then load new data.

2. **Full clean slate** — stop emulators, delete persisted state, restart. Avoids stale browser auth tokens that cause silent write failures.
   - Stop emulators: `lsof -ti :4400 | xargs kill`
   - Delete persisted state: `rm -rf emulator-data/`
   - Start emulators: `npm run start:emulators`
   - Reload the page and **log in first** (creates the `users/{uid}` parent doc)
   - Then load data

   Do NOT use the emulator's DELETE REST endpoints to wipe auth/Firestore — they clear server state but leave stale auth tokens in the browser, causing the next `setDoc` to silently fail.

**Native dialogs** (`alert`, `confirm`, `prompt`) block the browser extension — inject test data programmatically via `javascript_tool` instead.

**Loading data programmatically:** copy the file to `client/static/` (SvelteKit serves it at root), `fetch('/file.json')` via `javascript_tool`, then clean up the copy. Always reload the page after importing so the app's startup hooks create parent docs and pick up new state. `client/static/*.json` should be gitignored to prevent accidentally committing test data.

```js
const { getFirebase } = await import('/src/lib/firebase/init.ts');
const { auth } = getFirebase();
const uid = auth.currentUser.uid;
const res = await fetch('/myfile.json');           // any file under client/static/
const data = await res.json();
// then call the app's own import function — never write directly to Firestore.
```

**Test fixtures:** project-level test data lives in `client/test/fixtures/` (checked-in) once a project starts accumulating any. Copy to `client/static/` to use, clean up after.

## Deploying

- **Use `node scripts/deploy.mjs` for ALL deploys.** Do NOT run `firebase deploy`, `firebase-tools`, or any other deploy path — they fail under our auth model (gcloud's shared OAuth client can't grant the Firebase scope, and Cloud Identity Free orgs disable service-account keys). `scripts/deploy.mjs` calls the underlying REST APIs directly with the access token we already have. Header comment in the script has the full reasoning.
- The script reads **`PROJECT_ID`** and **`ACCOUNT_EMAIL`** from a root **`.env`** (gitignored — written per-machine by `setup-project`). Deliberate 1:1 mapping between checkout and target project — no dev/test/prod split for this template's audience.
- If `.env` is missing or you need to retarget, write it manually: `PROJECT_ID=<gcp-project-id>` and `ACCOUNT_EMAIL=<gcloud-account-email>`. The script falls back to `gcloud auth print-access-token --account=$ACCOUNT_EMAIL` for the token.
- The script **builds first** (`npm run build:all`), then pushes — no separate build step needed.

## Data model conventions
- Every Firestore-backed type must have a `@collection` JSDoc tag with its full path (e.g. `@collection users/{uid}/transactions`). Update when renaming/moving collections.
- When creating a new Firestore collection, add the type to `src/lib/types/` with the `@collection` tag.

## General
- Stop early on dead ends — if automation hits a blocking dialog or fails 2-3 times, pivot approach or ask. Don't retry the same thing.
- Don't apply band-aids. Always ask "is there a better way to do this, even if it requires a bit of refactoring".
