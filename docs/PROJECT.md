# What this app does

This file is the app's functional state: the first read of any feature session,
and part of any commit that changes behaviour. Keep entries short — what it
does, where it lives, what data it touches.

## Built and working

- **`/` — sign in.** The front door and the only ungated route: enter a
  mobile, get a six-digit code by SMS, enter it, land on `/users`. Both
  steps live on this one route (there is no link to land on, so nothing
  like the old `/auth/action`). SMS only — no passwords, no email, no
  OAuth. There is no public/marketing surface. How it works:
  docs/CLAUDE-AUTH.md.
- **`/users` — whitelist management.** The landing page once signed in.
  Manage the `users` collection (doc id = E.164 mobile, e.g.
  `+61412345678`). Presence on the list is what grants sign-in; anyone on
  it can add/remove anyone (users manage users, no separate admin tier).
- **`AppLayout` and the route table.** `src/router.tsx` is the whole URL
  map. Routes nested under `AppLayout` are the signed-in surface: that
  layout owns the single auth gate + top bar (`AppHeader`: menu top left,
  your mobile top right). **New features go in `src/pages/` and get
  registered under `AppLayout`'s `children`** — a route added at the top
  level of the table is ungated.
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
