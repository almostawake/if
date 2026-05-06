# welcome to if

you're in.

`if` (impatient futurist) is a starter template for personal automation tools — sveltekit + firebase + cloud functions + gemini.

## start

1. copy this folder to your projects dir (remove `.git` if you want a fresh history).
2. seed `.env` (see `.env.example`) with `PROJECT_ID=<gcp-project-id>`.
3. seed `client/.env` with the Firebase Web config (`VITE_FIREBASE_*` keys) from your Firebase console.
4. `node cmd-auth.mjs` once — Google OAuth consent in the browser. Writes `.env.auth.json`.
5. `npm run install:all` to install dependencies.
6. `npm run start:emulators` + `npm run start:client` for local dev (ports 4000 + 5173).
7. `node cmd-deploy.mjs` to ship.

## prerequisites

- a gmail account with billing enabled
- an existing GCP project with Firebase, Firestore, Storage, Auth, and Cloud Functions provisioned

bootstrap tooling that sets all that up automatically lives in `../aa-migrate` (separate, in flux).

## what lives in this repo

- `client/` — the sveltekit dashboard
- `functions/` — cloud functions
- `cmd-auth.mjs` — Google OAuth (probe / refresh / fresh consent)
- `cmd-deploy.mjs` — Firebase Hosting + Firestore Rules deploy via REST
- `CLAUDE.md`, `docs/CLAUDE-*.md` — agent instructions for Claude Code
- `.claude/` — agent settings + hooks
