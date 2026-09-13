# Purpose

I'm not sure yet, but when we get a feel for it, update these docs and remove this comment! ;)

# Orientation

A small web app on Firebase: React client (Vite SPA) + Cloud Functions + Firestore. What the app does *today* lives in **docs/PROJECT.md** — read it at the start of any feature work, and keep it current (see "Before committing").

Three surfaces:

- **`/`** — the sign-in screen, and the only ungated route. Enter a mobile, enter the SMS code, land on `/users`. There is no anonymous/public surface in this app: everything else is behind the gate.
- **The signed-in surface** — everything you sign in for, served at root-level URLs (`/users` today). `src/router.tsx` is the whole URL map: routes nested under `AppLayout` are gated by that one layout. **New pages go in `AppLayout`'s `children` in `src/router.tsx`** — that is what makes them gated; a route added at the top level of that array is wide open. Gated by the `users` collection: SMS-code sign-in, no passwords, no email, no OAuth.
- **`api` Cloud Function** — the single inbound HTTP endpoint for external callers (webhooks, server-to-server), gated by its own bearer secret in `functions/.env`.

## Environments

- **You run inside the Claude Code desktop app.** There is no VS Code and no `code` CLI on these machines — never suggest opening files in an editor; show content in the conversation or point at the file path. "Open the app" means the browser (local dev server by default).
- **Local dev** = Firebase emulators + Vite dev server: `npm run start:emulators` / `npm run start:client` — never raw `firebase` commands. The owner's whitelist entry is auto-seeded and the magic sign-in link is auto-followed in DEV; no manual fetching in the happy path.
- **Hosted** = one Google Cloud project per checkout, identified by `.env` (gitignored): `THIS_PROJECT_ID_ON_GOOGLE_HOSTING`, `THIS_PROJECT_REGION_ON_GOOGLE_HOSTING`, `EMAIL_OF_GOOGLE_HOSTING_ACCOUNT`. Deploys go through `npm run deploy*` only — the wrapper handles credentials itself. **Never deploy unless the user explicitly asks.**

## Topic docs — read before working in an area

| Doing what | Read first |
|---|---|
| Any feature work | **docs/PROJECT.md** — what exists now |
| Choosing tech / adding a capability | **docs/CLAUDE-STACK.md** — stick to this stack, it's pre-provisioned |
| Writing any client code | **docs/CLAUDE-REACT.md** — React conventions and drift guide |
| Firestore data / schemas | **docs/CLAUDE-STACK.md** § Data model conventions |
| Any inbound HTTP endpoint (webhook, server-to-server) | **docs/CLAUDE-API.md** |
| Running the app on this machine — any request to start, stop, restart, or check it, however worded ("run it up", "shut it down", "is it running?", "the servers", "local", "here") — plus seeding data and driving the app in a browser | **docs/CLAUDE-EMULATORS.md** |
| Sign-in, SMS cost/abuse, whitelist | **docs/CLAUDE-AUTH.md** — read before touching a stored number: everything hinges on E.164 matching the `phone_number` claim exactly |
| Deploying, Google API tokens, credentials | **docs/CLAUDE-DEPLOY.md** |

## Non-technical audience

The user is a non-developer — a business analyst, project manager, or team lead building small personal-automation tools with Claude Code. Assume they do not know OAuth, serverless, or Firestore modelling; keep jargon to a minimum and offer to explain. When they ask for specific technology, clarify the functional requirement first rather than taking the technical direction at face value.

## Hard rules

- Google access tokens come from `node cmd-auth.mjs --token` only. Never read `~/.if/creds/*` files directly, never hand-roll a token refresh, never `gcloud auth login` / `firebase login` (hook-blocked). Details: docs/CLAUDE-DEPLOY.md.
- Don't add sign-in providers (OAuth, passwords, email-link, Firebase Anonymous auth) without asking — SMS + whitelist is deliberate (docs/CLAUDE-AUTH.md). Point users to docs/CLAUDE-AUTH.md if they ask for "logins".
- Don't add a route outside `AppLayout`'s children in `src/router.tsx` without asking. Outside that layout means outside the auth gate, and the app has no public surface by design.
- Two unrelated bearer tokens exist: the **outbound** Google OAuth token (above) and the **inbound** `api` bouncer secret (`CODE_THAT_OTHER_SERVICES_NEED_TO_GET_PAST_OUR_BOUNCER` in `functions/.env`). Different files, different lifetimes — never mix them.
- Don't deploy unless the user explicitly asks.
- The Google project comes pre-provisioned: billing linked, key IAM pre-granted, and these APIs enabled (all `*.googleapis.com`): `firebase`, `firestore`, `storage`, `firebasestorage`, `identitytoolkit`, `firebasehosting`, `cloudfunctions`, `cloudbuild`, `run`, `artifactregistry`, `eventarc`, `pubsub`, `cloudscheduler`, `aiplatform` (Vertex AI → Gemini), `speech` (Speech-to-Text), `gmail`, `calendar-json`, `apikeys`, `cloudbilling`. Never tell the user to enable one of these or upgrade billing. **Pre-provisioned services are the DEFAULT for their capability** — when a task needs something this list covers, use the enabled service; never substitute an outside provider or hunt for a personal credential. The canonical case is AI: any LLM call goes through **Vertex AI (Gemini via aiplatform, OAuth/ADC)** — not the Gemini direct API (generativelanguage + API key), and not Anthropic/OpenAI (no such credentials exist; "no API key found" means use Vertex, not improvise). Anything not listed needs enabling first — how: docs/CLAUDE-STACK.md § "Google APIs already enabled".

## User requirements

- If the user asks for something that will break the architecture or create debt, suggest alternatives from docs/CLAUDE-STACK.md first.
- If new patterns are needed, select on the basis of best-practice from senior devs and **prefer small, LLM-friendly / LLM-reliable architectures — collapse over split when in doubt**. The whole point of this project is to pick a stack that LLMs produce correct code for on the first try.

## Before committing

- Run `npm run check` before completing any code-centric task/conversation (`tsc` + `eslint`). Don't commit without it passing. `npm run format` (Prettier) keeps style uniform — run it on files you touched.
- If behaviour changed, update **docs/PROJECT.md** — and any affected docs/CLAUDE-*.md — in the same commit.
- Ask before committing. Other changes may have occurred — summarise all changes in the commit message.

## Test UI changes

- Test significant UI changes before completing your turn. Use screenshots to verify layout/alignment.
- Drive the browser via **chrome-devtools MCP only** (configured at user scope). Conventions live in your personal `~/.claude/CLAUDE.md`.
- Make → verify → fix → verify — this tight loop catches bugs that code review alone misses.

## General

- Stop early on dead ends — if automation hits a blocking dialog or fails 2-3 times, pivot approach or ask. Don't retry the same thing.
- Don't apply band-aids. Always ask "is there a better way to do this, even if it requires a bit of refactoring".
