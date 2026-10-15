# Deploys & Google credentials (outbound)

Everything about talking **to** Google from this checkout: deploying, and getting bearer tokens for GCP/Firebase REST or admin calls. (The inbound `api` bearer secret is a different, unrelated token — see CLAUDE-API.md.)

## `.env` — which project, which account

`.env` (gitignored, 1:1 with checkout — no dev/test/prod split) carries:

- `THIS_PROJECT_ID_ON_GOOGLE_HOSTING` — the Google Cloud project this checkout deploys to.
- `THIS_PROJECT_REGION_ON_GOOGLE_HOSTING` — the immutable Firestore location; the functions build bakes it into `functions/src/region.ts` (see CLAUDE-STACK.md → Region).
- `EMAIL_OF_GOOGLE_HOSTING_ACCOUNT` — picks the cred file at `~/.if/creds/google.<email>.json` for both `cmd-auth.mjs` (when no positional arg) and `cmd-deploy.mjs`.

If missing, write them manually.

## Deploying — `npm run deploy*` (the wrapper handles auth itself)

Deploys go through `npm run deploy:<target>` — names are self-explanatory (`deploy`, `deploy:hosting`, `deploy:functions`, `deploy:rules`, `deploy:indexes`).

The wrapper (`cmd-deploy.mjs`) reads the OAuth refresh token from `~/.if/creds/google.<EMAIL_OF_GOOGLE_HOSTING_ACCOUNT>.json`, materialises a temporary `.adc.json`, points `GOOGLE_APPLICATION_CREDENTIALS` at it, and runs `firebase deploy` for you. **You don't need to fetch a token first** — the wrapper does it. Don't pre-call `cmd-auth.mjs --token` before deploying; it's pointless and can mask issues.

**Don't deploy by:** calling `firebase deploy` directly (no creds in scope), curl-ing googleapis REST endpoints, or shelling around the wrapper. Always `npm run deploy*`.

`firebase deploy` and `firebase emulators:*` flow through the auth-blocking hook fine; only the *login* sub-commands are blocked. Build is wired into `firebase.json`'s hosting `predeploy` so it runs automatically when hosting is in scope.

**Open tabs after a hosting deploy** pick up the new build on their next route change, not immediately: `src/version.ts` polls `/version.json` (stamped by the build, served `Cache-Control: no-store` via `firebase.json`) and reloads only at a navigation, so in-progress edits survive. Cloud Functions switch over the instant they deploy, so a stale tab can talk to a new function for a while — keep `api`/callable changes backward-compatible for one release when the client depends on them. Don't move `version.json` into `public/` (gitignored `*.json` there) or give it a long cache; the check depends on it being current.

**Multi-account deploy:** `EMAIL_OF_GOOGLE_HOSTING_ACCOUNT=alice@x.com npm run deploy:functions` picks up `~/.if/creds/google.alice@x.com.json` for that one run.

Do NOT deploy unless the user explicitly asks.

## Google API calls — `cmd-auth.mjs`

For ANY GCP or Firebase REST/admin call from this project — listing projects, reading Firestore, calling Cloud Functions admin APIs, reading logs, anything that needs a Google bearer token — get the token via `cmd-auth.mjs`. The canonical pattern, verbatim:

```sh
TOKEN=$(node cmd-auth.mjs --token)
curl -s -H "Authorization: Bearer $TOKEN" \
  https://cloudresourcemanager.googleapis.com/v1/projects | jq .
```

`cmd-auth.mjs --token` probes / refreshes / re-grants as needed (logs to stderr) and prints the access_token to stdout. Non-zero exit on failure so callers can error-check.

**When listing projects**, filter out projects pending deletion (`lifecycleState != "ACTIVE"`) and Apps Script-managed projects (project IDs prefixed with `sys-`, or `parent.type == "firebaseAppScript"`). They clutter results and are never deploy targets. A jq filter like `.projects[] | select(.lifecycleState == "ACTIVE" and (.projectId | startswith("sys-") | not))` is usually enough.

**Cred storage:** all OAuth creds live at `~/.if/creds/google.<email>.json` — out-of-tree, one file per Google account, chmod 600. Never in the project. There is no "default" file; the account always comes from either a positional arg or `EMAIL_OF_GOOGLE_HOSTING_ACCOUNT` in `.env`.

**Multi-account:** pass the email as a positional arg — `node cmd-auth.mjs alice@x.com --token` — uses `~/.if/creds/google.alice@x.com.json`. Add a new account with `npm run auth -- alice@x.com`. Probe-only check: `npm run auth:status` (or `node cmd-auth.mjs alice@x.com --status`).

## Google consent (Gmail / Calendar) — `cmd-consent.mjs`

Separate from the token above. `cmd-auth.mjs` is *who deploys* (Cloud Platform scope, reused across projects, stored in `~/.if/creds`). `cmd-consent.mjs` is *whose mailbox and calendar the app may touch* — one account, project-specific, stored in `functions/.env`. Don't mix them.

- **Grant once:** `npm run consent` (account = `EMAIL_OF_GOOGLE_HOSTING_ACCOUNT`, or pass an email). Browser opens on a throwaway `127.0.0.1` port; click Allow (an account outside the project's Workspace org first sees "Google hasn't verified this app" — Advanced → continue, expected), and the refresh token is written to `functions/.env` as `GOOGLE_HOSTING_CONSENT_REFRESH_TOKEN` + `GOOGLE_HOSTING_CONSENT_EMAIL`. Then `npm run deploy:functions` to ship it. Already stored → the script says so; `--force` re-grants.
- **Check:** `npm run consent:status` refreshes the token and prints the account and granted scopes.
- **Local scripts / curl:** `node cmd-consent.mjs --token` prints an access token for the Gmail and Calendar APIs.
- **In functions:** `consentClient()` / `consentEmail()` from `functions/src/googleConsent.ts`. Add `googleapis` to `functions/package.json` when the first consumer lands.
- **Scopes:** `ADMIN_CONSENTS` in `functions/.env` (default: full Gmail + full Calendar) must match Data access in Cloud Console → Google Auth Platform; change both, then `--force` to re-grant.
- **One-time console setup** (Cloud Console → Google Auth Platform, as the deploy account), recorded in docs/PROJECT.md once done:
  - *Branding:* app name = the project id (easy to track), support email, developer contact.
  - *Clients:* create one client of type **Desktop app**, name it `<project> consent (local script)`, paste its id/secret into `functions/.env`. Nothing else to register — no redirect URIs, no JavaScript origins.
  - *Data access:* register exactly the `ADMIN_CONSENTS` scopes plus `openid` and `.../userinfo.email`.
  - *Audience:* **Internal** when the project sits in a Workspace org and only that org's accounts will ever consent — nothing more to do. **External + "In production"** when an outside account might consent; that needs a home page URL, a privacy-policy URL and an authorised domain on Branding first. Never leave it in **Testing**: Google expires refresh tokens after seven days there.
  - Workspace trust: accounts in the org that owns the project skip the "unverified app" screen and the 100-user cap for the org's own projects ("Trust internal, domain-owned apps", on by default). Outside accounts see the warning (Advanced → continue) and count against the cap; that is accepted — verification is not planned.
- Google refresh tokens don't rotate — nothing writes back after the grant. They die on revoke (myaccount.google.com → Security → third-party access) or six months unused; either way `--status` fails and `--force` fixes it.
- Never add a hosted `/consent` route to do this; the local script is the whole flow.

## Hard rules — the failure modes that bite fresh sessions

- **Never** read a cred file directly to pluck out an access_token. The stored token is usually expired; the file is meant to be consumed via `cmd-auth.mjs`.
- **Never** roll your own refresh — no manual `POST` to `oauth2.googleapis.com/token`, no hand-written exchange of refresh_token for access_token. `cmd-auth.mjs` is the one place that does that, and it writes the refreshed tokens back atomically.
- **Never** suggest `gcloud auth login`, `firebase login`, or `firebase-tools login` — they manage a separate auth state this project ignores, they're blocked by `.claude/hook-block-direct-auth.mjs`, and the user would be re-authenticating something this project doesn't read.
- If `cmd-auth.mjs --token` itself fails (network error, browser timeout on a fresh consent), surface the error — don't try to bypass it.

## Daily re-consent prompts (Workspace accounts)

These aren't a refresh-token revocation — they're Google Cloud session control (the `cloud-platform` scope is governed by it). Refresh returns `invalid_grant` with `error_subtype: invalid_rapt`; `cmd-auth.mjs` labels the case so you can tell which is which. There's no in-code fix (RAPT can't be satisfied without a fresh user grant from a first-party tool). Permanent cure: admin.google.com → Security → Access and data control → Google Cloud session control → set "Session never expires" (or extend) on your account/OU.
