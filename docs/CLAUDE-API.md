# Inbound HTTP API

Conventions for any inbound HTTP endpoint in this project. See **../CLAUDE.md** for ways of working.

## The rule

**One Cloud Function — `api` — handles every inbound HTTP request.** It's a Gen 2 `onRequest` wrapping an Express app at `functions/src/index.ts`.

Why one function and not many:
- Each Gen 2 function = its own Cloud Run service = its own cold-start. Multiple HTTP functions means multiple cold-starts to pay, with no shared warm-up.
- One service = simpler ops, one set of scaling/concurrency settings, one URL prefix.
- The cost of "one big router" is exactly the cost of an `if` in middleware, which is nothing.

When adding a new inbound endpoint, **always** add it as a route on the existing Express app. Do not export a second `onRequest` for HTTP work.

## Auth

Most routes are gated by a bearer-token middleware that reads `CODE_THAT_OTHER_SERVICES_NEED_TO_GET_PAST_OUR_BOUNCER` from `functions/.env`. The bearer secret is for **external callers** (webhooks, server-to-server, cron pings from outside the project). It is not the right tool for the app's own signed-in users — see "What does NOT live here" below.

### Public browser-facing routes (the narrow exception)

A short, named allowlist of routes is mounted **above** the bearer middleware and runs without a bearer. Only OAuth-style endpoints qualify: end users open them in a browser, they don't carry the shared secret, and they must work for anonymous visitors before any identity exists. Current allowlist:

- `GET /consent` — kicks off the Google permission flow, 302s to Google
- `GET /oauth/callback` — Google redirects back here with the auth code; exchange + store

The pattern, in `functions/src/index.ts`:

```ts
app.use(oauthRouter);  // public — above the gate
app.use(bearerGate);   // everything below requires the bearer
```

Don't widen this allowlist casually. If a new route is reachable without a bearer, it must (a) be unambiguously browser-initiated, (b) handle all of its own security (CSRF state, signed cookies, etc.), and (c) be listed here. If it doesn't, it belongs below the gate.

## Adding a route

Open `functions/src/index.ts`, delete the scaffold catch-all, and add real routes:

```ts
app.get("/widgets", async (req, res) => { /* ... */ });
app.post("/widgets", async (req, res) => { /* ... */ });

// Replace the scaffold message with a proper 404 once real routes exist:
app.use((_req, res) => res.status(404).json({error: "not found"}));
```

## Splitting into files

Fine when `index.ts` gets unwieldy (rule of thumb: more than ~5 routes or ~150 lines). Move handlers into `functions/src/api/{topic}.ts`, export an `express.Router()` from each, mount in `index.ts`:

```ts
// functions/src/api/widgets.ts
import {Router} from "express";
const router = Router();
router.get("/", async (req, res) => { /* list */ });
router.post("/", async (req, res) => { /* create */ });
export default router;
```

```ts
// functions/src/index.ts
import widgetsRouter from "./api/widgets";
app.use("/widgets", widgetsRouter);
```

Still one deploy unit, one Cloud Run service, one cold-start. **Never** add a second `onRequest` export for HTTP work — that defeats the whole point.

## What does NOT live here

- **Callables** (`onCall`) — typed RPC for the app's own signed-in client. Authenticated by Firebase Auth ID token, not by the bearer. One callable per operation, organised by feature folder under `functions/src/`.
- **Background triggers** (`onDocumentCreated`, `onSchedule`, etc.) — separate exports, by feature folder.
- **Anything called from the app's own signed-in client** — use a callable. The bearer secret is server-side; shipping it to the browser would defeat its purpose.

## Env vars

`functions/.env` carries the bearer secret. Firebase Functions Gen 2 auto-loads it both in the emulator and in deployed functions. Gitignored. Seeded by the install script (or copy `functions/.env.example` to `functions/.env` and fill it in by hand).

The same secret is used by the emulator — calls in local dev need the bearer too, for parity.

## Region

Functions deploy to whatever region the project's Firestore database lives in. That region is **immutable** — chosen once at project creation by the new-project script (`../aa/n`; default `australia-southeast1`, override with `n --region <id>`). `cmd-deploy.mjs` looks it up and injects it as `FIREBASE_REGION`, which `setGlobalOptions` reads at the top of `functions/src/index.ts`. No hardcoded region to drift, and functions always sit with their data. Don't override per-function — keeping everything in one region avoids cross-region latency and egress.

## Where it's reachable

- **Local emulator:** `http://localhost:5001/{project-id}/{region}/api/...`
- **Deployed:** `https://{region}-{project}.cloudfunctions.net/api/...` — `{region}` is the project's Firestore region (see above)

The public OAuth routes (`/consent`, `/oauth/callback`) are reached instead via the Hosting domain — `https://{project}.web.app/...` — through the rewrites in `firebase.json`.

To put it at `https://yourdomain/api/...`, add a hosting rewrite in `firebase.json` **above** the SPA catch-all:

```json
"rewrites": [
  {"source": "/api/**", "function": {"functionId": "api"}},
  {"source": "**", "destination": "/index.html"}
]
```
