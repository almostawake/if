# Sign-in — email link + whitelist, and how it maps to domains

## Who signs in (and who doesn't)

Two groups of people use this app; only one of them signs in:

- **End users at `/`** (and any other non-`/admin/*` route): **anonymous**. No sign-in required, no Firestore writes from them. Features live here. Don't gate `/` — public-by-default is the chosen shape. The home page's top bar (`AppHeader.svelte`, added at the owner's request) shows a "sign in" link and, for an already-signed-in whitelisted user, the admin menu; this *reads* auth state (so Firebase initializes on `/`) but gates nothing.

  "Anonymous" means **no Firebase Auth session of any kind** — Firebase's Anonymous Authentication provider (`signInAnonymously()`) counts as a sign-in provider and is equally off-limits. Anonymous visitors also have **no data path, deliberately**: Firestore rules default-deny them, the `api` function is bearer-gated, and callables/Storage serve whitelisted users only. This is not a gap to fill — if a feature at `/` needs to store or fetch per-visitor data, stop and ask the user rather than inventing a path (no anonymous auth, no public rules, no additions to the api no-bearer allowlist). A proper anonymous-data pattern may be added later.
- **Signed-in users at `/admin/*`**: sign in via **Firebase Auth Email Link**, gated by the `users` collection in Firestore (doc id = lowercased email). Flow: enter email → magic link by email → click → signed in iff `request.auth.token.email.lower()` exists in `/users/{email}`. Magic-link only — no passwords, no OAuth.

`/admin` is the management surface for the app itself (today: the user whitelist; later: scopes, integrations, etc.). End users never visit it. There is no separate "admin" tier — anyone in `users` can sign in to `/admin` and edit the list (users manage users). The doc id is email, not Firebase uid, because email is the only stable identifier we have at invite time (the uid doesn't exist until first sign-in).

**Bootstrap:** the project owner's email must exist in `/users/{lowercased-email}` before first sign-in. The emulator auto-seeds the owner via `cmd-seed-user.mjs` on `npm run start:emulators`; prod needs a one-time manual seed at first deploy. If the list is ever emptied (everyone removes everyone), recovery requires out-of-band access (Firebase Console / Admin SDK).

**Don't add Google OAuth, password auth, anonymous auth, or other sign-in providers without asking.** Email Link is the chosen pattern: zero passwords, no consent-screen setup, easy to administrate. Point users here if they ask for "logins".

**On the Firebase Web "API key" (`AIzaSy…`) in `client/.env`:** it's a misnamed *public project identifier*, not a credential — see [Firebase docs](https://firebase.google.com/docs/projects/api-keys). Safe to ship in the bundle. Real auth is Firebase Auth ID tokens + Firestore security rules. The file holds project-specific Firebase Web config (`VITE_FIREBASE_*`); seed it from your project's Firebase console (or the bootstrap of your choice) before deploying. Gitignored — never commit.

## Domains: the three knobs

Three independent URL "knobs" decide which domain each part of the flow uses.
They are easy to confuse, and confusing them burns a whole session chasing the
wrong layer. This is the map.

| Knob | Where it's set | Controls | Does **not** control |
|---|---|---|---|
| **`authDomain`** | Client SDK config — `client/src/lib/firebase/init.ts`, computed from `window.location.host` at runtime | Firebase's OAuth popup/redirect surfaces (`/__/auth/handler`, `/__/auth/iframe`) | The email magic-link host. **Email-link sign-in never reads `authDomain`.** |
| **`callbackUri`** | **Server-side** Identity Platform project config (`notification.sendEmail.callbackUri`) — *not in the repo* | The **host of the link in the email** (`https://<callbackUri-host>/auth/action?…`) | Where sign-in finally completes (that's `continueUrl`) |
| **`continueUrl`** | Per request at send time = `window.location.origin + '/auth/action'` (`AuthService.sendLink`) | The origin the user **started on**; carried inside the link as a query param | The link's host (that's `callbackUri`) |

**The trap:** `authDomain` is *not* the magic-link host. The host is
`callbackUri`, which lives only in server-side project config. If a magic link
points at the wrong domain, editing `authDomain` or `VITE_FIREBASE_AUTH_DOMAIN`
changes **nothing** — wrong layer.

Why `authDomain` is set to `window.location.host` anyway: purely so that *if*
an OAuth provider is ever added it works same-origin. With email-link only,
`authDomain`'s value is irrelevant.

## The lifecycle

1. **Send** — `AuthService.sendLink`, running on whatever domain the user is
   on: sets `continueUrl = window.location.origin/auth/action`, saves the email
   in *that origin's* `localStorage`, calls `sendSignInLinkToEmail`.
2. **Email** — Firebase sends a link to the **fixed `callbackUri` host**, with
   `continueUrl` ridden along as a query param:
   `https://<callbackUri-host>/auth/action?mode=signIn&oobCode=…&continueUrl=https://<start-origin>/auth/action`
3. **Click → forward** — `routes/auth/action/+page.svelte` opens on the
   callbackUri host. If `continueUrl`'s origin differs, it copies the one-time
   params onto `continueUrl` and `window.location.replace`s there, so
   completion happens on the origin the user started from (where their
   `localStorage` email is). Guarded to `https:` + an `/auth/action` path so the
   code is never bounced to an unrelated page.
4. **Complete** — on the start origin, `completeEmailLink` reads the pending
   email from `localStorage` and calls `signInWithEmailLink`.

Because `continueUrl` is captured from `window.location.origin` at send time,
the flow works from **any** connected domain with no per-domain config — the
fixed `callbackUri` is just a transparent hop.

**Caveat:** completion needs the link opened in the same browser that requested
it (the pending email is in `localStorage`). Cross-device falls through to the
"confirm your email" prompt — by design.

Sessions are **per origin** (localStorage/IndexedDB): a session on
`<project>.web.app` does not carry to a custom domain. Users sign in once per
origin.

## Adding a sign-in domain

To let users sign in on a new domain (e.g. a custom domain):

1. **Connect it in Firebase Hosting** (custom domain, cert provisioned) so it
   serves `/auth/action` and the reserved `/__/*` paths.
2. **Add it to Auth → Authorised domains** (Console).

That's all — the step-3 forwarding handles the rest, and `callbackUri` can stay
on any one connected host. You generally do **not** touch `callbackUri`.

If you ever need the email link to *display* a specific host, that — and only
that — is the lever, set server-side:

```sh
# read the current value
TOKEN=$(node cmd-auth.mjs --token)
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://identitytoolkit.googleapis.com/admin/v2/projects/<PID>/config" \
  | jq .notification.sendEmail.callbackUri
# change it: Console → Authentication → Templates → (edit a template) → Customise action URL
#   or: PATCH …/config?updateMask=notification.sendEmail.callbackUri
```

## If you ever add a redirect-based provider

`signInWithRedirect` breaks in Chrome under third-party cookie restrictions.
`authDomain` is already set to `window.location.host` (same-origin redirect —
see `client/src/lib/firebase/init.ts`); you'd also need to call
`getRedirectResult(auth)` on init. Otherwise users land back on the login
screen after selecting their account.

## Don't

- Don't "fix the email-link domain" via `authDomain` / `VITE_FIREBASE_AUTH_DOMAIN` — wrong layer; the lever is `callbackUri`.
- Don't add password or OAuth providers without asking — email-link is deliberate.
- Don't expect a session on one origin to carry to another — auth state is per-origin.
