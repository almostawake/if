# Purpose

Fast-track small automation solutions for non-developers.

# Ways of Working

Read the relevant topic file before working in its area:
- **docs/CLAUDE-STACK.md** — target tech stack and architecture, stick to these technologies, they are all pre-provisioned
- **docs/CLAUDE-SVELTE.md** — Svelte 5 rune conventions. Read before writing any Svelte code.
- **docs/CLAUDE-API.md** — inbound HTTP API conventions. Read before adding any HTTP endpoint (webhook, server-to-server, etc.).

## Non-technical Audience

The target user is a non-developer — a business analyst, project manager, or team lead building small personal-automation tools with Claude Code. Assume they do not know OAuth, serverless, or Firestore modelling; keep jargon to a minimum and offer to explain. When they ask for specific technology, clarify the functional requirement first rather than taking the technical direction at face value.

## Auth & deploy

Three independent auth flows live in this project. Don't conflate them — each fails differently when you do.

### 1. End-user app sign-in — Email Link + `allowedEmails` whitelist

The template ships with **Firebase Auth Email Link sign-in** + an `allowedEmails` whitelist in Firestore. Flow: user enters email → gets a magic link by email → clicks it → signed in. They're only let through if their lowercased email exists in `/allowedEmails/{email}`. The project owner's email must be seeded there before first login; from then on they add/remove others from the in-app users page.

Don't add Google OAuth, password auth, or other providers without asking. Email Link + whitelist is the chosen pattern: zero passwords, no consent-screen setup, easy to administrate. Point users here if they ask for "logins".

**On the Firebase Web "API key" (`AIzaSy…`) in `client/.env`:** it's a misnamed *public project identifier*, not a credential — see [Firebase docs](https://firebase.google.com/docs/projects/api-keys). Safe to ship in the bundle. Real auth is Firebase Auth ID tokens + Firestore security rules. The file holds project-specific Firebase Web config (`VITE_FIREBASE_*`); seed it from your project's Firebase console (or the bootstrap of your choice) before deploying. Gitignored — never commit.

**`signInWithRedirect` gotcha (if you ever add a redirect-based provider):** breaks in Chrome under third-party cookie restrictions. Fix in the prod Firebase config: `authDomain = window.location.host` (same-origin redirect) + call `getRedirectResult(auth)` on init. Otherwise users land back on the login screen after selecting their account.

### 2. Owner/admin Google OAuth — `cmd-auth.mjs` → `.env.auth*.json`

For ANY GCP or Firebase REST/admin call from this project — listing projects, reading Firestore, calling Cloud Functions admin APIs, reading logs, anything that needs a Google bearer token — get the token via `cmd-auth.mjs`. The canonical pattern, verbatim:

```sh
TOKEN=$(node cmd-auth.mjs --token)
curl -s -H "Authorization: Bearer $TOKEN" \
  https://cloudresourcemanager.googleapis.com/v1/projects | jq .
```

`cmd-auth.mjs --token` probes / refreshes / re-grants as needed (logs to stderr) and prints the access_token to stdout. Non-zero exit on failure so callers can error-check.

**Hard rules — these are the failure modes that bite LLMs in fresh sessions:**
- **Never** read `.env.auth.json` directly to pluck out an access_token. The stored token is usually expired; the file is meant to be consumed via `cmd-auth.mjs`.
- **Never** roll your own refresh — no manual `POST` to `oauth2.googleapis.com/token`, no hand-written exchange of refresh_token for access_token. `cmd-auth.mjs` is the one place that does that, and it writes the refreshed tokens back atomically.
- **Never** suggest `gcloud auth login`, `firebase login`, or `firebase-tools login` — they manage a separate auth state that this template ignores, they're blocked by `.claude/hooks/block-direct-auth.mjs`, and the user would be re-authenticating something this project doesn't read.
- If `cmd-auth.mjs --token` itself fails (network error, browser timeout on a fresh consent), surface the error — don't try to bypass it.

**Multi-account:** pass the email as a positional arg — `node cmd-auth.mjs alice@x.com --token` — picks up `.env.auth.alice@x.com.json`. Add a new account with `npm run auth -- alice@x.com`. Probe-only check: `npm run auth:status` (or `node cmd-auth.mjs alice@x.com --status`).

### 3. Deploy — `npm run deploy*` (the wrapper handles the auth shim itself)

Deploys go through `npm run deploy:<target>` — names are self-explanatory (`deploy`, `deploy:hosting`, `deploy:functions`, `deploy:rules`, `deploy:indexes`).

The wrapper (`cmd-deploy.mjs`) reads the OAuth refresh token from `.env.auth*.json`, materialises a temporary `.adc.json`, points `GOOGLE_APPLICATION_CREDENTIALS` at it, and runs `firebase deploy` for you. **You don't need to fetch a token first** — the wrapper does it. Don't pre-call `cmd-auth.mjs --token` before deploying; it's pointless and can mask issues.

**Don't deploy by:** calling `firebase deploy` directly (no creds in scope), curl-ing googleapis REST endpoints, or shelling around the wrapper. Always `npm run deploy*`.

`firebase deploy` and `firebase emulators:*` flow through the hook fine; only the *login* sub-commands are blocked. Build is wired into `firebase.json`'s hosting `predeploy` so it runs automatically when hosting is in scope.

**Multi-account deploy:** `ACCOUNT_EMAIL=alice@x.com npm run deploy:functions` picks up `.env.auth.alice@x.com.json`.

**`.env`** carries `THIS_PROJECT_ID_ON_GOOGLE_HOSTING` (gitignored, 1:1 with checkout — no dev/test/prod split for this template's audience). If missing, write it manually.

Do NOT deploy unless the user explicitly asks.

### 4. Inbound HTTP API — bouncer secret (separate from everything above)

External callers (webhooks, server-to-server, cron pings) hit the `api` Cloud Function with `Authorization: Bearer <secret>`. The secret is `CODE_THAT_OTHER_SERVICES_NEED_TO_GET_PAST_OUR_BOUNCER` in `functions/.env` (gitignored; see `functions/.env.example` for the template).

This bearer is **completely separate** from the OAuth bearer in flow 2. Don't mix them up: flow 2's token authenticates **outbound** calls from this project to Google APIs; the bouncer authenticates **inbound** HTTP requests from external services to this project's `api` function. They live in different files, have different lifetimes, and rotate independently.

See **docs/CLAUDE-API.md** for the full convention before adding any inbound endpoint (one Express app, one `onRequest`, no second HTTP function).

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

## Data model conventions
- Every Firestore-backed type must have a `@collection` JSDoc tag with its full path (e.g. `@collection users/{uid}/transactions`). Update when renaming/moving collections.
- When creating a new Firestore collection, add the type to `src/lib/types/` with the `@collection` tag.

## General
- Stop early on dead ends — if automation hits a blocking dialog or fails 2-3 times, pivot approach or ask. Don't retry the same thing.
- Don't apply band-aids. Always ask "is there a better way to do this, even if it requires a bit of refactoring".
