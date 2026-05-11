# Purpose

Fast-track small automation solutions for non-developers.

# Ways of Working

Read the relevant topic file before working in its area:
- **docs/CLAUDE-STACK.md** — target tech stack and architecture, stick to these technologies, they are all pre-provisioned
- **docs/CLAUDE-SVELTE.md** — Svelte 5 rune conventions. Read before writing any Svelte code.
- **docs/CLAUDE-API.md** — inbound HTTP API conventions. Read before adding any HTTP endpoint (webhook, server-to-server, etc.).
- **docs/CLAUDE-EMULATORS.md** — Firebase emulator & dev-server operations. Read before starting/stopping emulators, seeding data, or driving the app in a browser.

## Non-technical Audience

The target user is a non-developer — a business analyst, project manager, or team lead building small personal-automation tools with Claude Code. Assume they do not know OAuth, serverless, or Firestore modelling; keep jargon to a minimum and offer to explain. When they ask for specific technology, clarify the functional requirement first rather than taking the technical direction at face value.

## Auth & deploy

Three independent auth flows live in this project. Don't conflate them — each fails differently when you do.

### 1. Admin sign-in — the **only** gated surface — Email Link + `allowedAdmins`

The template has **two user groups**, and only one of them signs in:

- **End users at `/`** (and any other non-`/admin/*` route): **anonymous**. No sign-in, no Firestore writes from them. Whatever feature the template-user builds lives here. Don't gate `/` and don't add a login flow there unless explicitly asked — public-by-default is the template's chosen shape.
- **Admins at `/admin/*`**: sign in via **Firebase Auth Email Link**, gated by an `allowedAdmins` whitelist in Firestore. Flow: enter email → magic link by email → click → signed in iff `request.auth.token.email.lower()` exists in `/allowedAdmins/{email}`. Magic-link only — no passwords, no OAuth.

The `/admin` surface is for managing the app itself (today: the admin whitelist; later: scopes, integrations, etc.). End users never visit it.

**Bootstrap:** the project owner's email must exist in `/allowedAdmins/{lowercased-email}` before first sign-in. Seed once at first deploy (or in the emulator — see "Admin whitelist seed" below). Once one admin is in, they add others from `/admin` itself; the Firestore rule lets any admin read/write the list (admins manage admins). If the list is ever emptied, recovery requires out-of-band access (Firebase Console / Admin SDK).

**Don't conflate `allowedAdmins` with end-user state.** `allowedAdmins` gates a UI surface; it isn't a user record. If a feature later needs per-end-user state, that's a separate `/users/{uid}` collection keyed by Firebase Auth uid — distinct from `allowedAdmins`.

**Don't add Google OAuth, password auth, or other sign-in providers for admins without asking.** Email Link is the chosen pattern: zero passwords, no consent-screen setup, easy to administrate. Point users here if they ask for "logins".

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
- **Never** suggest `gcloud auth login`, `firebase login`, or `firebase-tools login` — they manage a separate auth state that this template ignores, they're blocked by `.claude/hook-block-direct-auth.mjs`, and the user would be re-authenticating something this project doesn't read.
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
- Drive the browser via **chrome-devtools MCP only** (configured at user scope; installed by `aa/n` for new users). Conventions live in your personal `~/.claude/CLAUDE.md`.
- Make → verify → fix → verify — this tight loop catches bugs that code review alone misses.

## Firebase emulators & dev server
See **docs/CLAUDE-EMULATORS.md**. Highlights:
- Always use `npm run start:emulators` / `npm run start:client` — never `firebase` commands directly.
- On first emulator interaction in a session, **verify the project owner from `.env.auth.json` is in `allowedAdmins`**; seed if missing (ask first).
- Don't deploy unless the user explicitly asks.

## Data model conventions
- Every Firestore-backed type must have a `@collection` JSDoc tag with its full path (e.g. `@collection users/{uid}/transactions`). Update when renaming/moving collections.
- When creating a new Firestore collection, add the type to `src/lib/types/` with the `@collection` tag.

## General
- Stop early on dead ends — if automation hits a blocking dialog or fails 2-3 times, pivot approach or ask. Don't retry the same thing.
- Don't apply band-aids. Always ask "is there a better way to do this, even if it requires a bit of refactoring".
