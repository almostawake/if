# Provisioning a fresh GCP + Firebase project

What the if- bootstrapper (`if-new.sh` in truffledog-website, eventually here) needs to do to get a brand-new project from "nothing" to "ready for first deploy". Captures both the API contract and the operational gotchas — propagation lag, async ops, dead ends. Read this before extending the provisioner; the API surface is friendly *only* if you respect the timing.

---

## Architecture decisions (locked)

| Decision | Choice | Note |
|---|---|---|
| Tenancy | **Single-tenant per project** | One Firebase project = one app instance = one team. Multi-user inside, no per-tenant data partitioning. |
| Auth | **Email-link sign-in only** (default) | Validated end-to-end via REST. No OAuth client. No consent screen. No Cloud Console clicks. Beats admin-password as the new default. |
| Authorization | **Firestore `allowedEmails` doc** + Firestore rules | Provisioner seeds with creator's email. App offers a UI to add more. All entries are equal — no admin/user distinction. |
| Auth blocking function | **Off** | Rules-only enforcement is enough for this audience. Don't add `beforeSignIn`. |
| Identity Platform tier | **Free tier (default)** | `identityPlatform:initializeAuth` works without a paid upgrade. |
| Firestore mode | Native | Standard for Firebase. |
| First-deploy bootstrap | Provisioner writes `allowedEmails: [creator_email]` before the app goes live | Creator email is known from the cred file used to authenticate. |

Multi-tenant escalation: not engineered now; if a future user needs it, they get a per-tenant project (recommend) or a per-tenant Firestore prefix (acceptable). Don't pre-build for it.

---

## The happy-path API sequence

Order matters — many calls fail if earlier ones haven't propagated. The whole sequence assumes a refreshed `$ACCESS_TOKEN` for the user's Google account and that user has accepted Google Cloud's main account-level terms (which is universal for anyone who's ever opened Cloud Console).

### 1. Create GCP project

```
POST https://cloudresourcemanager.googleapis.com/v3/projects
Body: {"projectId":"<id>","displayName":"<id>"}
```

Returns a long-running op (`operations/create_project.global.<id>`). Poll `GET /v3/{op}` until `done: true`. Usually ~1s.

Project IDs: 6–30 chars, lowercase letters/digits/dashes, starts with letter, globally unique. Expect collisions; retry with a different ID.

### 2. Link billing

```
PUT https://cloudbilling.googleapis.com/v1/projects/{p}/billingInfo
Body: {"billingAccountName":"billingAccounts/<id>"}
```

Synchronous, returns `billingEnabled: true`. Need an OPEN billing account first — see preflight section.

### 3. Enable APIs (sequential, with polling)

For each of: `firebase.googleapis.com`, `identitytoolkit.googleapis.com`, `firestore.googleapis.com`, plus anything app-specific:

```
POST https://serviceusage.googleapis.com/v1/projects/{p}/services/<api>:enable
Body: {}
```

Returns either an op (`operations/acat.p2-...`) to poll **on the same `serviceusage.googleapis.com` host**, or `operations/noop.DONE_OPERATION` if already enabled. **Always check both shapes** — `noop.DONE_OPERATION` has `done: true` immediately and skips the propagation wait.

**Don't send `X-Goog-User-Project: {p}` on the very first enable** — the project has no enabled APIs yet, so the quota project header points at a project that itself can't service quota. Drop the header for the first call; from the second call onwards (after `serviceusage.googleapis.com` is implicitly enabled by the first response), include it.

After the op reports done, **wait an additional 15–30s before calling that API**. Async propagation is real. Symptom: `Service has not been used in project ... before or it is disabled` even though the state endpoint shows `ENABLED`. This is not a permission issue — it's eventual consistency. Don't add fake retries; just wait, then proceed.

### 4. Add Firebase to the project

```
POST https://firebase.googleapis.com/v1beta1/projects/{p}:addFirebase
Headers: X-Goog-User-Project: {p}
Body: {}
```

Returns 200 with a long-running op or — once Firebase has propagated — an empty `{}` for already-Firebase. Poll until `done: true`.

**The HTML 404 trap.** If you call this too soon after enabling `firebase.googleapis.com`, you get back literal HTML (`<h1>Not Found</h1>`), not a JSON error, with HTTP 404. This is Google's CDN/router responding before Firebase's API host has registered the project. It is *indistinguishable in shape* from a permanent "endpoint doesn't exist" 404. **If you see HTML, wait 30–60s and retry.** Eventually it returns JSON 200 and Firebase is added.

Verify with: `GET https://firebase.googleapis.com/v1beta1/projects/{p}` (with `X-Goog-User-Project: {p}`). If it returns a project record with `resources.hostingSite` and `state: ACTIVE`, Firebase is on.

### 5. Initialize Identity Platform / Firebase Auth

```
POST https://identitytoolkit.googleapis.com/v2/projects/{p}/identityPlatform:initializeAuth
Headers: X-Goog-User-Project: {p}
Body: {}
```

Returns `{}` on success. Creates the project's auth config (without it, every other identitytoolkit admin call returns `CONFIGURATION_NOT_FOUND`).

`PATCH /admin/v2/projects/{p}/config` *will not work* in lieu of this — config has to exist first, and only `initializeAuth` creates it.

### 6. Enable email-link sign-in (auth provider config)

After step 5 the config exists but the email/password provider is **disabled by default** (`signIn` block contains only `hashConfig`). Turn it on with email-link mode:

```
PATCH https://identitytoolkit.googleapis.com/admin/v2/projects/{p}/config
     ?updateMask=signIn.email.enabled,signIn.email.passwordRequired
Headers: X-Goog-User-Project: {p}
Body: {"signIn":{"email":{"enabled":true,"passwordRequired":false}}}
```

`passwordRequired: false` is the magic toggle that flips the email provider into passwordless / link-only mode.

`authorizedDomains` is auto-populated with `{p}.firebaseapp.com` and `{p}.web.app`. The Firebase auth handler at `https://{p}.firebaseapp.com/__/auth/action` is reachable straight away — no additional config.

### 7. Initialize Firestore

```
POST https://firestore.googleapis.com/v1/projects/{p}/databases?databaseId=(default)
Body: {"type":"FIRESTORE_NATIVE","locationId":"<region>"}
```

Region is locked at create time; document the choice. Default to `us-central1` unless the user picks otherwise. Returns a long-running op.

### 8. Seed `allowedEmails` and any starter docs

Standard Firestore writes via the REST API or the Admin SDK. Use the OAuth bearer + `X-Goog-User-Project: {p}`. Seed: `allowedEmails: { entries: [<creator_email>] }` (exact shape decided in app code).

### 9. App-specific deploy steps

Out of scope for the generic provisioner — Hosting / Functions / Cloud Run choices live with the app stack.

---

## Sending a sign-in email (verification + admin testing)

```
POST https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode
Headers: X-Goog-User-Project: {p}
Body: {
  "requestType": "EMAIL_SIGNIN",
  "email": "<user>",
  "continueUrl": "https://{p}.firebaseapp.com/__/auth/action",
  "returnOobLink": true
}
```

`returnOobLink: true` is admin-only — it returns the magic link in the response and *does not send an email*. Use it to test the flow without mailbox noise. Drop the flag in production paths so Firebase actually mails the user.

Auth: works with the same OAuth bearer used everywhere else; no separate Firebase Web API key path needed when calling as admin.

---

## Auth & credentials

### Cred file shape (`~/.if/creds/{email}.json`)

```json
{
  "email": "<user>",
  "client_id": "<gcloud-public-client-id>",
  "client_secret": "<gcloud-public-client-secret>",
  "tokens": {
    "access_token": "...",
    "refresh_token": "...",
    "expires_in": 3599,
    "scope": "openid email https://www.googleapis.com/auth/cloud-platform",
    "token_type": "Bearer",
    "id_token": "..."
  }
}
```

Authoritative contract: `~/.if/creds/CLAUDE.md`. Do **not** prompt the user for OAuth on token expiry — refresh from `refresh_token`. Only fall back to a fresh OAuth flow if refresh returns `invalid_grant` (the refresh token has been revoked).

### Refresh

```
POST https://oauth2.googleapis.com/token
  client_id, client_secret, refresh_token, grant_type=refresh_token
```

Google sometimes omits `refresh_token` from the response; preserve the existing one when merging. Use Perl + `JSON::PP` (ships with macOS, no Xcode CLT) to avoid sed/regex fragility.

### Scopes that matter

`openid email https://www.googleapis.com/auth/cloud-platform` — the cloud-platform scope covers everything in the provisioning sequence including IAM, Firebase Management, Identity Toolkit admin, Firestore admin, Cloud Resource Manager, Cloud Billing.

### `X-Goog-User-Project` rules of thumb

- **Drop it** on the very first `serviceusage.googleapis.com:enable` against a fresh project (chicken-and-egg — the project has no quota yet).
- **Include it** on every other call that targets the project — Firebase Management, Identity Toolkit (`/admin/v2/...`), Firestore admin, IAP. Without it on those endpoints you get a 403 "no quota project" or a 401 "missing credentials" depending on the API.
- The header value must point at a real project where the calling user has access AND the relevant API is enabled. For our sequence, that means once we're past step 3, the project we're provisioning works as its own quota project.

---

## Preflight checks (before opening the project-create form)

### Billing

```
GET https://cloudbilling.googleapis.com/v1/billingAccounts
```

Look for at least one entry with `"open": true`. Closed accounts mean the trial expired or the user manually closed the account.

If empty or all-closed → send the user to `https://console.firebase.google.com/`. Their "Create a project → upgrade to Blaze" flow walks them through GCP free-trial signup AND Firebase ToS acceptance in one pass. Tell them to use whatever name they like (the project they create there is throwaway — we'll create the real one), then re-run `if-new.sh`.

### Firebase ToS

There is **no clean read-only probe** for Firebase ToS acceptance. Don't try.

- `GET availableProjects` without a quota header always returns 403 "no quota project" (regardless of ToS state).
- `GET availableProjects` with a quota header returns 200 even when ToS hasn't been accepted — useless.
- `GET /v1beta1/projects` with quota header returns `{}` if the user has no Firebase projects, `{"results":[...]}` if they do. Empty correlates with "ToS not accepted" *in practice* but isn't proof — a user who accepted ToS and then deleted every Firebase project would be falsely flagged.
- `serviceusage:enable firebase.googleapis.com` returns 200 OK regardless of ToS state on any project that already has *anything* enabled. The structured ToS error only fires on a truly first-ever API enable.

**Strategy:** skip preflight for ToS. Wait until step 4 (`:addFirebase`) returns the structured ToS error, then route to the same setup-needed page. The user runs the Firebase Console flow once, comes back, re-runs the script. In practice this is a rare path because most users hit Firebase Console first anyway.

---

## Propagation timing — the cheat sheet

| After | Wait at least | Symptom if you skip |
|---|---|---|
| `serviceusage:enable firebase.googleapis.com` | 15–30s, then poll op until done | `:addFirebase` returns HTML 404 |
| `serviceusage:enable identitytoolkit.googleapis.com` | poll op + 15s extra | `initializeAuth` returns 403 SERVICE_DISABLED |
| `serviceusage:enable iap.googleapis.com` | poll op + 15s extra | `brands.create` returns 403 SERVICE_DISABLED |
| `cloudresourcemanager projects:move` | 30–60s | `iap brands.create` returns 400 "Project must belong to an organization" even after a successful move |
| `:addFirebase` HTML 404 | retry every ~15s for up to a minute | This is propagation, not a permanent error |

Bake polling into the script's helper layer; never fire-and-forget then sleep a guess. Exception: the post-propagation waits above are real "the op is done but downstream caches haven't caught up" delays. A short fixed sleep is correct there.

---

## Async ops — the operation polling pattern

Most write APIs return long-running operations. The op-name **prefix tells you which host to poll**:

| Prefix | Poll on |
|---|---|
| `operations/create_project.global.*` | `cloudresourcemanager.googleapis.com/v3/{op}` |
| `operations/rm.*` | `cloudresourcemanager.googleapis.com/v3/{op}` |
| `operations/acat.*` | `serviceusage.googleapis.com/v1/{op}` |
| `operations/noop.DONE_OPERATION` | already done; no poll needed |
| Firebase Management op (no fixed prefix) | `firebase.googleapis.com/v1beta1/{op}` with quota header |

When grepping op names from JSON in bash, watch out for filtering: a regex that excludes `noop.DONE_OPERATION` will silently lose the "already enabled" case. Always handle both shapes.

---

## Dead ends — proven, don't repeat

### IAP brand back door for OAuth client creation

Path:
```
POST iap.googleapis.com/v1/projects/{p}/brands
POST iap.googleapis.com/v1/projects/{p}/brands/{b}/identityAwareProxyClients
POST identitytoolkit.googleapis.com/admin/v2/projects/{p}/defaultSupportedIdpConfigs?idpId=google.com
```

Looks like a clean way to programmatically add Google sign-in. **It isn't.** Three reasons:

1. **`orgInternalOnly: true` is forced** on every brand created via this API — it's an output-only field. Workspace org accounts: brand restricts sign-in to org members. Personal Gmail accounts (with auto-Cloud-Identity-Free org): brand restricts sign-in to that one user. Either way, not the "anyone with a Google account" shape that's almost always the actual goal.
2. **Brands and clients have no PATCH method.** `supportEmail`, `applicationTitle` are settable on create; `displayName` on the client. That's the entire surface. No way to flip internal/external, no way to add test users, no way to update redirect URIs.
3. **IAP-created clients have Google-managed redirect URIs.** Firebase Auth's Google sign-in needs `https://{p}.firebaseapp.com/__/auth/handler` on the allow-list; IAP doesn't put it there and Cloud Console marks IAP-issued clients as "automatically generated... can't be modified". Runtime sign-in fails with `redirect_uri_mismatch`.

If a future maintainer revisits this thinking "maybe I missed something", re-fetch the discovery doc with `curl https://iap.googleapis.com/\$discovery/rest?version=v1` and walk the methods. Mutation methods total: `brands.create`, `identityAwareProxyClients.{create, delete, resetSecret}`. That's it.

### OAuth consent screen state mutation

Internal/external user type, publishing status (TESTING / IN_PRODUCTION), test users — all **Cloud Console only**. No public REST API exists for any of them. Don't search; it's a confirmed gap, not a discovery problem.

### Project move to unlock IAP brands on personal Gmail

Works mechanically — `cloudresourcemanager projects:move` re-parents to the auto-Cloud-Identity-Free org, after which IAP brand creation succeeds — but the resulting brand is still `orgInternalOnly: true` (with a one-member org). So this is a workaround for the *first* IAP wall that hits the *second*. Combined with the redirect-URI dead end, doesn't help.

---

## Cloud Identity Free auto-orgs — quick reference

For personal Gmail accounts that go through GCP free-trial signup, Google often (but not universally) auto-creates a "Cloud Identity Free" org named like `<username>-org`. Visible in `cloudresourcemanager.googleapis.com/v3/organizations/<id>`. The Gmail user is the sole member.

API-created projects under that account **don't auto-attach** — they're parentless. To put a project under the auto-org, call `projects:move` explicitly.

This is incidentally interesting (we discovered it during the IAP exploration) but **not load-bearing for the email-link auth path**. It's only a gotcha if a future feature needs the project to be org-parented.

Workspace-org accounts (paid Workspace, e.g. truffledog) put projects under the org by default.

---

## Checking what's still unverified

Before claiming the provisioner is "done", confirm:

- [ ] Full sequence runs against a brand-new no-history account (most of our testing has been on accounts that already had something on them — propagation timings may differ).
- [ ] Real email arrives when `sendOobCode` is called *without* `returnOobLink: true`. We've only tested the admin shortcut.
- [ ] Click-through on the magic link lands the user back in the app and produces a valid Firebase Auth session.
- [ ] Firestore rules enforce the `allowedEmails` whitelist correctly (email match, not uid).
- [ ] Adding a second email via the app's UI works end-to-end (the second user receives a link and signs in).
- [ ] Firestore region choice surfaces somewhere — defaulting to `us-central1` silently is a soft footgun for non-US users.

---

## File layout pointers

- `if-new.sh` (in `~/_code/truffledog-website/`): current provisioner. Sections 1–4 (HTTP server, helpers, HTML templates, dispatcher).
- `~/.if/creds/{email}.json`: per-account OAuth creds. See `~/.if/creds/CLAUDE.md` for the contract.
- `~/.if/CLAUDE.md`: top-level personal scratch + tooling dir explainer.
- This file: architecture + provisioning knowledge for *this template*.
