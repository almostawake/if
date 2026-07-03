# What this app does

This file is the app's functional state: the first read of any feature session,
and part of any commit that changes behaviour. Keep entries short — what it
does, where it lives, what data it touches.

## Built and working

- **`/` — the public app.** Placeholder home page. No sign-in; visitors are
  anonymous and make no Firestore writes. New features go here unless the user
  says otherwise.
- **`/admin` — whitelist management.** Signed-in users manage the `users`
  collection (doc id = lowercased email). Presence on the list is what grants
  sign-in; anyone on it can add/remove anyone (users manage users, no separate
  admin tier).
- **Sign-in plumbing.** `/login` (enter email → magic link) and `/auth/action`
  (link landing + forward to the origin the user started on). Email-link only —
  no passwords, no OAuth. How it works: docs/CLAUDE-AUTH.md.
- **`api` Cloud Function.** The single inbound HTTP endpoint for external
  callers (webhooks, server-to-server), gated by a bearer secret in
  `functions/.env`. No app-specific routes yet. Conventions: docs/CLAUDE-API.md.

## Features

*None yet.*

<!-- Entry format — add one per shipped feature:
### <Name> — <one line: what it does for the user>
- Screens: routes involved
- Data: @collection paths touched
- Functions/API: callables or api routes added
- Notes: anything a future session must know that the code doesn't show
-->
