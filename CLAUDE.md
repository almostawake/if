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

### 1. Admin sign-in — the **only** gated surface — Email Link + `users` whitelist

The template has **two groups**, and only one of them signs in:

- **End users at `/`** (and any other non-`/admin/*` route): **anonymous**. No sign-in, no Firestore writes from them. Whatever feature the template-user builds lives here. Don't gate `/` and don't add a login flow there unless explicitly asked — public-by-default is the template's chosen shape.
- **Signed-in users at `/admin/*`**: sign in via **Firebase Auth Email Link**, gated by the `users` collection in Firestore (doc id = lowercased email). Flow: enter email → magic link by email → click → signed in iff `request.auth.token.email.lower()` exists in `/users/{email}`. Magic-link only — no passwords, no OAuth.

`/admin` is the management surface for the app itself (today: the user whitelist; later: scopes, integrations, etc.). End users never visit it. There is no separate "admin" tier — anyone in `users` can sign in to `/admin` and edit the list (users manage users). The doc id is email, not Firebase uid, because email is the only stable identifier we have at invite time (the uid doesn't exist until first sign-in).

**Bootstrap:** the project owner's email must exist in `/users/{lowercased-email}` before first sign-in. The emulator auto-seeds the owner via `cmd-seed-user.mjs` on `npm run start:emulators`; prod needs a one-time manual seed at first deploy. If the list is ever emptied (everyone removes everyone), recovery requires out-of-band access (Firebase Console / Admin SDK).

**Don't add Google OAuth, password auth, or other sign-in providers without asking.** Email Link is the chosen pattern: zero passwords, no consent-screen setup, easy to administrate. Point users here if they ask for "logins".

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

**When listing projects**, filter out projects pending deletion (`lifecycleState != "ACTIVE"`) and Apps Script-managed projects (project IDs prefixed with `sys-`, or `parent.type == "firebaseAppScript"`). They clutter results and are never deploy targets. A jq filter like `.projects[] | select(.lifecycleState == "ACTIVE" and (.projectId | startswith("sys-") | not))` is usually enough.

**Hard rules — these are the failure modes that bite LLMs in fresh sessions:**
- **Never** read `.env.auth.json` directly to pluck out an access_token. The stored token is usually expired; the file is meant to be consumed via `cmd-auth.mjs`.
- **Never** roll your own refresh — no manual `POST` to `oauth2.googleapis.com/token`, no hand-written exchange of refresh_token for access_token. `cmd-auth.mjs` is the one place that does that, and it writes the refreshed tokens back atomically.
- **Never** suggest `gcloud auth login`, `firebase login`, or `firebase-tools login` — they manage a separate auth state that this template ignores, they're blocked by `.claude/hook-block-direct-auth.mjs`, and the user would be re-authenticating something this project doesn't read.
- If `cmd-auth.mjs --token` itself fails (network error, browser timeout on a fresh consent), surface the error — don't try to bypass it.

**Multi-account:** pass the email as a positional arg — `node cmd-auth.mjs alice@x.com --token` — picks up `.env.auth.alice@x.com.json`. Add a new account with `npm run auth -- alice@x.com`. Probe-only check: `npm run auth:status` (or `node cmd-auth.mjs alice@x.com --status`).

**Daily re-consent prompts** on a Workspace account aren't a refresh-token revocation — they're Google Cloud session control (the `cloud-platform` scope is governed by it). Refresh returns `invalid_grant` with `error_subtype: invalid_rapt`; `cmd-auth.mjs` labels the case so you can tell which is which. There's no in-code fix (RAPT can't be satisfied without a fresh user grant from a first-party tool). Permanent cure: admin.google.com → Security → Access and data control → Google Cloud session control → set "Session never expires" (or extend) on your account/OU.

### 3. Deploy — `npm run deploy*` (the wrapper handles the auth shim itself)

Deploys go through `npm run deploy:<target>` — names are self-explanatory (`deploy`, `deploy:hosting`, `deploy:functions`, `deploy:rules`, `deploy:indexes`).

The wrapper (`cmd-deploy.mjs`) reads the OAuth refresh token from `.env.auth*.json`, materialises a temporary `.adc.json`, points `GOOGLE_APPLICATION_CREDENTIALS` at it, and runs `firebase deploy` for you. **You don't need to fetch a token first** — the wrapper does it. Don't pre-call `cmd-auth.mjs --token` before deploying; it's pointless and can mask issues.

**Don't deploy by:** calling `firebase deploy` directly (no creds in scope), curl-ing googleapis REST endpoints, or shelling around the wrapper. Always `npm run deploy*`.

`firebase deploy` and `firebase emulators:*` flow through the hook fine; only the *login* sub-commands are blocked. Build is wired into `firebase.json`'s hosting `predeploy` so it runs automatically when hosting is in scope.

**Multi-account deploy:** `ACCOUNT_EMAIL=alice@x.com npm run deploy:functions` picks up `.env.auth.alice@x.com.json`.

**`.env`** carries `THIS_PROJECT_ID_ON_GOOGLE_HOSTING` and `THIS_PROJECT_REGION_ON_GOOGLE_HOSTING` (gitignored, 1:1 with checkout — no dev/test/prod split for this template's audience). If missing, write them manually. The region is the immutable Firestore location; the functions build bakes it into `functions/src/region.ts` (see CLAUDE-STACK.md → Region).

Do NOT deploy unless the user explicitly asks.

### 4. Inbound HTTP API — bouncer secret (separate from everything above)

External callers (webhooks, server-to-server, cron pings) hit the `api` Cloud Function with `Authorization: Bearer <secret>`. The secret is `CODE_THAT_OTHER_SERVICES_NEED_TO_GET_PAST_OUR_BOUNCER` in `functions/.env` (gitignored; see `functions/.env.example` for the template).

This bearer is **completely separate** from the OAuth bearer in flow 2. Don't mix them up: flow 2's token authenticates **outbound** calls from this project to Google APIs; the bouncer authenticates **inbound** HTTP requests from external services to this project's `api` function. They live in different files, have different lifetimes, and rotate independently.

See **docs/CLAUDE-API.md** for the full convention before adding any inbound endpoint (one Express app, one `onRequest`, no second HTTP function).

## User requirements
- If the user asks for something that will break the architecture or create debt, suggest alternatives from docs/CLAUDE-STACK.md first.
- If new patterns are needed, select on the basis of best-practice from senior devs and **prefer small, LLM-friendly / LLM-reliable architectures — collapse over split when in doubt**. The whole point of this project is to pick a stack that LLMs produce correct code for on the first try.

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
- The `users` whitelist is auto-seeded on `npm run start:emulators` (see CLAUDE-EMULATORS.md). Magic sign-in link is auto-followed in DEV. No manual fetching needed in the happy path.
- Don't deploy unless the user explicitly asks.

## Data model conventions
- All Firestore-backed schemas live in **`functions/src/common/`** — single source of truth, shared with the client via the `$common` alias (configured in `client/svelte.config.js`). Files there must stay browser-safe (zod + pure TS only, no `firebase-admin` / Node-only imports).
- One PascalCase file per type (e.g. `User.ts`). Each file exports a zod schema and a `z.infer`-derived type — never declare a bare `interface` here. Multiple related types may share a file, each with its own `@collection` tag.
- Every Firestore-backed type carries a `@collection` JSDoc tag with its full path (e.g. `@collection users/{email}` or `@collection users/{uid}/transactions`). Update the tag when renaming/moving collections.
- Validate at I/O boundaries: parse incoming Firestore snapshots and outgoing writes with the schema (`userSchema.parse(...)`) so a drifting wire shape fails loudly instead of silently corrupting state.
- Imports: `import { userSchema, type User } from '$common/User'` (client) or `'../common/User'` (functions, relative).

## General
- Stop early on dead ends — if automation hits a blocking dialog or fails 2-3 times, pivot approach or ask. Don't retry the same thing.
- Don't apply band-aids. Always ask "is there a better way to do this, even if it requires a bit of refactoring".
