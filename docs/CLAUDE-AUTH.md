# Sign-in — SMS code + whitelist

## Who signs in (and who doesn't)

**Everyone who uses this app signs in.** There is no public or anonymous surface — that's a deliberate change from the earlier shape, not an oversight.

- **`/`** is the sign-in screen and the only ungated route: enter a mobile → six-digit code by SMS → enter it → land on `/users`. Signed in iff `request.auth.token.phone_number` exists in `/users/{mobile}`. SMS only — no passwords, no email, no OAuth.
- **Everything else** lives under `AppLayout` (`client/src/layouts/AppLayout.tsx`), which owns the single auth gate and the top bar. `client/src/router.tsx` nests those routes as its `children`, so its pages are served at root level (`/users` today, `/scopes` and friends later) while sharing one gate.

**A new page is gated by where you register it.** A route listed in `AppLayout`'s `children` is behind the gate; one listed at the top level of the route table is wide open to the internet. Don't add anything outside the layout without asking.

**Firebase's Anonymous Authentication provider (`signInAnonymously()`) is off-limits**, as are public Firestore rules and additions to the `api` function's no-bearer allowlist. If a feature seems to need an unauthenticated data path, stop and ask rather than inventing one.

`/users` is the management surface for the app itself (today the whitelist; later scopes, integrations, etc.). There is no separate "admin" tier — anyone in `users` can sign in and edit the list (users manage users). The doc id is the mobile, not the Firebase uid, because the number is the only stable identifier we have at invite time (the uid doesn't exist until first sign-in).

**Bootstrap:** the project owner's mobile must exist in `/users/{+614XXXXXXXX}` before first sign-in. The `n` installer asks for it at provisioning and seeds it into the real project; the emulator auto-seeds the same number from `MOBILE_OF_APP_OWNER` in `.env` via `cmd-seed-user.mjs` on `npm run start:emulators`. If the list is ever emptied (everyone removes everyone), recovery requires out-of-band access (Firebase Console / Admin SDK).

**Don't add Google OAuth, password auth, email-link auth, anonymous auth, or other sign-in providers without asking.** SMS is the chosen pattern: nothing to remember, nothing to type but a number, and no consent-screen setup. Point users here if they ask for "logins".

**On the Firebase Web "API key" (`AIzaSy…`) in `client/.env`:** it's a misnamed *public project identifier*, not a credential — see [Firebase docs](https://firebase.google.com/docs/projects/api-keys). Safe to ship in the bundle. Real auth is Firebase Auth ID tokens + Firestore security rules. The file holds project-specific Firebase Web config (`VITE_FIREBASE_*`); gitignored — never commit.

## The one thing that breaks this flow

**Every stored number must be E.164 (`+614XXXXXXXX`), matching Firebase's `phone_number` claim character for character.** The Firestore rule compares the claim against the doc id with no normalising on either side, so a row saved as `0412345678` or `+61 412 345 678` fails the check — and it fails *late*: the user gets a code, types it correctly, signs in, and is then bounced by the `(app)` gate as "not on the list". That's a confusing bug to chase, so every write path normalises first.

`normalizeAuMobile` in `functions/src/common/mobile.ts` is the canonical implementation. It exists in three places because two of them run before that file exists in a new project:

| Where | What it seeds / writes |
|---|---|
| `functions/src/common/mobile.ts` | the app itself — sign-in at `/`, add at `/users` |
| `normalize_au_mobile` in the `n` installer | the first whitelist row in the real project |
| `cmd-seed-user.mjs` | the same row in the Firestore emulator |

**Change one, change all three.** Only `04` mobiles are accepted anywhere — a landline can't receive an SMS, so whitelisting one creates a row that can never sign in.

## Cost and abuse — why the country allowlist exists

Every verification SMS is billed: about a cent to an Australian number, up to ~46c in the priciest countries. An unrestricted project is the standard target for **SMS pumping**, where an attacker triggers bulk codes to expensive destinations and collects a share of the carrier fee.

The project is therefore provisioned with `smsRegionConfig.allowlistOnly` set to the countries it actually serves (`AU` by default, set by `n --sms-regions`). That removes the payout rather than merely making the attack harder — there's no revenue share to collect on a one-cent Australian message. Phone auth also requires a linked billing account; it stopped working on the no-cost plan in September 2024.

Two consequences worth knowing:

- **New Firebase projects allow no SMS regions at all by default.** A project where phone sign-in "does nothing" with no error is almost always missing this config, not missing the provider.
- **Adding a country is a deliberate cost decision**, not a config detail. Read the rate first.

```sh
# what the project currently allows
TOKEN=$(node cmd-auth.mjs --token)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/<PID>/config" \
  | jq '{phone: .signIn.phoneNumber, sms: .smsRegionConfig}'
```

## Domains

`authDomain` (client SDK config, `client/src/firebase/init.ts`) governs Firebase Auth's OAuth popup/redirect surfaces (`/__/auth/handler`, `/__/auth/iframe`). **SMS sign-in doesn't use them** — the phone flow talks to identitytoolkit directly. It's computed from `window.location.host` purely so that *if* an OAuth provider is ever added it works same-origin.

What phone sign-in *does* care about is the **authorised domains** list in project config: reCAPTCHA refuses to run on a host that isn't on it. `n` adds `localhost` at provisioning (projects created after 2025-04-28 don't include it by default) alongside the two Firebase Hosting domains.

Sessions are **per origin** (localStorage/IndexedDB): a session on `<project>.web.app` does not carry to a custom domain. Users sign in once per origin.

## Adding a sign-in domain

To let users sign in on a new domain (e.g. a custom domain):

1. **Connect it in Firebase Hosting** (custom domain, cert provisioned).
2. **Add it to Auth → Authorised domains** (Console), or via the same `admin/v2/projects/<PID>/config` PATCH with `updateMask=authorizedDomains`.

That's all — there's no per-domain link host to configure the way email-link sign-in needed.

## reCAPTCHA

Firebase requires an app verifier for every web phone sign-in. `AuthService` uses an **invisible** reCAPTCHA, so a user only sees a challenge if Google's risk scoring asks for one. It's created lazily against a `div` appended to `document.body`, and discarded on failure — a spent verifier can't be reused, and reusing one makes the *next* attempt fail for the wrong reason.

`connectAuthEmulator()` swaps in a no-op verifier, so local dev runs the same code path with no reCAPTCHA at all.

## Local dev

The auth emulator sends no SMS — it records the code it would have sent. `AuthService.devCode()` polls `/emulator/v1/projects/demo-not-required/verificationCodes` and the login page pre-fills the result, so signing in locally is: type your number, click, click. The whole thing is behind `import.meta.env.DEV`, and prod has no `/emulator/v1/*` route.

The number you sign in with locally is whatever `MOBILE_OF_APP_OWNER` in `.env` says, because that's the row `cmd-seed-user.mjs` seeds.

## Don't

- Don't store a mobile in any shape but E.164 — see "the one thing that breaks this flow" above.
- Don't add password, email-link, or OAuth providers without asking — SMS is deliberate.
- Don't widen `smsRegionConfig` casually; it's the thing standing between this project and an SMS-pumping bill.
- Don't expect a session on one origin to carry to another — auth state is per-origin.
