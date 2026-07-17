# Purpose

I'm not sure yet, but when we get a feel for it, update these docs and remove this comment! ;)

# Orientation

A small web app on Firebase: SvelteKit client (SPA) + Cloud Functions + Firestore. What the app does *today* lives in **docs/PROJECT.md** — read it at the start of any feature work, and keep it current (see "Before committing").

Three surfaces:

- **`/`** — the public app. Visitors are anonymous: no sign-in, no Firestore writes. New features go here unless the user says otherwise. Don't gate `/` or add a login flow there unless explicitly asked.
- **`/admin/*`** — the gated management surface (today: the sign-in whitelist). Email-link sign-in, gated by the `users` collection. No passwords, no OAuth.
- **`api` Cloud Function** — the single inbound HTTP endpoint for external callers (webhooks, server-to-server), gated by its own bearer secret in `functions/.env`.

## Environments

- **Local dev** = Firebase emulators + Vite dev server: `npm run start:emulators` / `npm run start:client` — never raw `firebase` commands. The owner's whitelist entry is auto-seeded and the magic sign-in link is auto-followed in DEV; no manual fetching in the happy path.
- **Hosted** = one Google Cloud project per checkout, identified by `.env` (gitignored): `THIS_PROJECT_ID_ON_GOOGLE_HOSTING`, `THIS_PROJECT_REGION_ON_GOOGLE_HOSTING`, `EMAIL_OF_GOOGLE_HOSTING_ACCOUNT`. Deploys go through `npm run deploy*` only — the wrapper handles credentials itself. **Never deploy unless the user explicitly asks.**

## Topic docs — read before working in an area

| Doing what | Read first |
|---|---|
| Any feature work | **docs/PROJECT.md** — what exists now |
| Choosing tech / adding a capability | **docs/CLAUDE-STACK.md** — stick to this stack, it's pre-provisioned |
| Writing any Svelte code | **docs/CLAUDE-SVELTE.md** — Svelte 5 rune conventions |
| Firestore data / schemas | **docs/CLAUDE-STACK.md** § Data model conventions |
| Any inbound HTTP endpoint (webhook, server-to-server) | **docs/CLAUDE-API.md** |
| Running the app on this machine — any request to start, stop, restart, or check it, however worded ("run it up", "shut it down", "is it running?", "the servers", "local", "here") — plus seeding data and driving the app in a browser | **docs/CLAUDE-EMULATORS.md** |
| Sign-in, magic-link URLs/domains, whitelist | **docs/CLAUDE-AUTH.md** — the one place that says which knob controls the magic-link host (spoiler: not `authDomain`) |
| Deploying, Google API tokens, credentials | **docs/CLAUDE-DEPLOY.md** |

## Non-technical audience

The user is a non-developer — a business analyst, project manager, or team lead building small personal-automation tools with Claude Code. Assume they do not know OAuth, serverless, or Firestore modelling; keep jargon to a minimum and offer to explain. When they ask for specific technology, clarify the functional requirement first rather than taking the technical direction at face value.

## Hard rules

- Google access tokens come from `node cmd-auth.mjs --token` only. Never read `~/.if/creds/*` files directly, never hand-roll a token refresh, never `gcloud auth login` / `firebase login` (hook-blocked). Details: docs/CLAUDE-DEPLOY.md.
- Don't add sign-in providers (OAuth, passwords, Firebase Anonymous auth) without asking — email-link + whitelist is deliberate, and anonymous visitors having no data path is too (docs/CLAUDE-AUTH.md). Point users to docs/CLAUDE-AUTH.md if they ask for "logins".
- Two unrelated bearer tokens exist: the **outbound** Google OAuth token (above) and the **inbound** `api` bouncer secret (`CODE_THAT_OTHER_SERVICES_NEED_TO_GET_PAST_OUR_BOUNCER` in `functions/.env`). Different files, different lifetimes — never mix them.
- Don't deploy unless the user explicitly asks.
- The Google project comes pre-provisioned: billing linked, key IAM pre-granted, and these APIs enabled (all `*.googleapis.com`): `firebase`, `firestore`, `storage`, `firebasestorage`, `identitytoolkit`, `firebasehosting`, `cloudfunctions`, `cloudbuild`, `run`, `artifactregistry`, `eventarc`, `pubsub`, `cloudscheduler`, `aiplatform` (Vertex AI → Gemini), `gmail`, `calendar-json`, `apikeys`, `cloudbilling`. Never tell the user to enable one of these or upgrade billing. Anything not listed needs enabling first — how: docs/CLAUDE-STACK.md § "Google APIs already enabled".

## User requirements

- If the user asks for something that will break the architecture or create debt, suggest alternatives from docs/CLAUDE-STACK.md first.
- If new patterns are needed, select on the basis of best-practice from senior devs and **prefer small, LLM-friendly / LLM-reliable architectures — collapse over split when in doubt**. The whole point of this project is to pick a stack that LLMs produce correct code for on the first try.

## Before committing

- Run `npm run check` before completing any code-centric task/conversation (`svelte-check` + `eslint`). Don't commit without it passing.
- If behaviour changed, update **docs/PROJECT.md** — and any affected docs/CLAUDE-*.md — in the same commit.
- Ask before committing. Other changes may have occurred — summarise all changes in the commit message.

## Test UI changes

- Test significant UI changes before completing your turn. Use screenshots to verify layout/alignment.
- Drive the browser via **chrome-devtools MCP only** (configured at user scope). Conventions live in your personal `~/.claude/CLAUDE.md`.
- Make → verify → fix → verify — this tight loop catches bugs that code review alone misses.

## General

- Stop early on dead ends — if automation hits a blocking dialog or fails 2-3 times, pivot approach or ask. Don't retry the same thing.
- Don't apply band-aids. Always ask "is there a better way to do this, even if it requires a bit of refactoring".
