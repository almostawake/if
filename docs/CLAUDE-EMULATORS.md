# Firebase emulators & dev server

Read this before starting/stopping the local emulator suite, seeding data, or driving the app in a browser session. The companion doc is `../CLAUDE.md` for the broader project rules.

The local project id is `demo-not-required` — a Firebase emulator convention, not a real project. Do NOT `firebase use` it. Free local emulation is a deliberate constraint; do NOT suggest anything that requires a live Firebase project to develop against. Do NOT deploy unless the user explicitly asks.

---

## Start, stop, status

Always use the npm scripts, never direct `firebase` commands:

- Start emulators: `npm run start:emulators` — logs go to `/tmp/firebase-emulator.log`
- Start client: `npm run start:client` (SvelteKit dev server, port 5173)

On first browser interaction in a conversation, check whether emulators and dev server are up. Start whichever is down — in parallel, in the background.

```sh
lsof -i :4000 >/dev/null 2>&1 && echo "emulators running"
lsof -i :5173 >/dev/null 2>&1 && echo "dev server running"
```

Stop emulators: `lsof -ti :4400 | xargs kill` (the hub gracefully shuts down all children).
Stop dev server: `lsof -ti :5173 | xargs kill`.
Verify shutdown: `lsof -i :4000 -i :4400 -i :9099 -i :5001 -i :8080 -i :9199 >/dev/null 2>&1 || echo "all stopped"`.

---

## Admin whitelist seed — verify on every emulator startup

Only `/admin` is gated; end users at `/` are anonymous. The `/admin` gate rejects sign-in unless the user's email exists at Firestore `/allowedAdmins/{email}` — on a fresh `emulator-data/` this collection is empty, so admin logins silently bounce.

**Mandate (do this whenever you've just started, or first interacted with, the emulators in a session):** verify the project owner is on the admin whitelist. The owner's identity lives in `.env.auth.json` at the project root — read the `email` field only (NOT the access_token; see ../CLAUDE.md "Auth & deploy → flow 2"). If `.env.auth.json` doesn't exist, the project hasn't been auth'd yet — say so and stop; don't fabricate an email.

```sh
OWNER=$(jq -r '.email // empty' .env.auth.json 2>/dev/null)
[ -z "$OWNER" ] && echo "no .env.auth.json email — ask the user before seeding" && exit
# Is the owner already whitelisted?
curl -s -H "Authorization: Bearer owner" \
  "http://localhost:8080/v1/projects/demo-not-required/databases/(default)/documents/allowedAdmins/$OWNER" \
  | jq 'if .name then "seeded: \(.fields.email.stringValue)" else "MISSING" end'
```

If the result is `MISSING`, surface that to the user and ask whether to seed `$OWNER` as admin (don't auto-seed — give them a chance to use a different email). On confirmation:

```sh
EMAIL=$OWNER  # or whatever the user said
curl -s -X POST -H "Authorization: Bearer owner" -H "Content-Type: application/json" \
  "http://localhost:8080/v1/projects/demo-not-required/databases/(default)/documents/allowedAdmins?documentId=$EMAIL" \
  -d "{\"fields\":{\"email\":{\"stringValue\":\"$EMAIL\"},\"addedAt\":{\"integerValue\":\"$(date +%s)000\"},\"addedBy\":{\"stringValue\":\"bootstrap\"}}}"
```

Seeding is a *precondition* for the email-link flow, not a bypass — the user still does the link dance.

**Multi-account note:** if the project has additional `.env.auth.<email>.json` files, those represent other Google identities for outbound GCP calls. They don't all need to be on the admin whitelist — only the people you want clicking through `/admin`. If the user is operating as a non-default identity (`ACCOUNT_EMAIL=alice@x.com …`), apply the same check for `alice@x.com`.

---

## Magic sign-in link — no email is sent locally

The link sits in the auth emulator. After the user clicks "send link", fetch it and pass it to them to paste into the browser:

```sh
curl -s http://localhost:9099/emulator/v1/projects/demo-not-required/oobCodes \
  | jq -r '.oobCodes[-1].oobLink'
```

---

## Emulator autonomy

You have full autonomy over emulator state. Don't hesitate to create users, log in/out, clear data, or load data — whatever is fastest to verify your work.

**Golden rule:** always use the app's own functions for every step — login, import, delete, etc. Never write directly to Firestore unless deliberately testing an edge case (e.g. simulating a stale schema). The app's flows create necessary parent docs, stamp schema versions, and maintain data integrity. Bypassing them causes subtle bugs (phantom docs, missing parent collections, stale caches).

**Auth helpers** (use via `javascript_tool`):

```js
const { getFirebase } = await import('/src/lib/firebase/init.ts');
const { auth } = getFirebase();
auth.currentUser   // → User | null
await auth.signOut();
```

Sign in goes through the app's email-link flow against the auth emulator's fake-link handler. Don't bypass it.

**Two ways to reset data:**

1. **Reset a user's data** — call the app's own delete/clear functions (e.g. via `javascript_tool` against an exported store action). The `users/{uid}` parent doc stays intact. Reload, then load new data.

2. **Full clean slate** — stop emulators, delete persisted state, restart. Avoids stale browser auth tokens that cause silent write failures.
   - Stop emulators: `lsof -ti :4400 | xargs kill`
   - Delete persisted state: `rm -rf emulator-data/`
   - Start emulators: `npm run start:emulators`
   - Re-run the admin whitelist seed check above (the `allowedAdmins` collection is gone)
   - Reload the page and **log in first** (creates the `users/{uid}` parent doc)
   - Then load data

   Do NOT use the emulator's DELETE REST endpoints to wipe auth/Firestore — they clear server state but leave stale auth tokens in the browser, causing the next `setDoc` to silently fail.

**Hot-reload of `firestore.rules` is unreliable.** The emulator's `"Rules updated"` log fires on file change but the running engine sometimes keeps serving the previous version. If a rules change doesn't seem to take effect, restart the emulators (full clean slate isn't needed — a stop+start is enough; persisted data survives via `--export-on-exit` / `--import`).

**Native dialogs** (`alert`, `confirm`, `prompt`) block the browser extension — inject test data programmatically via `javascript_tool` instead.

**Loading data programmatically:** copy the file to `client/static/` (SvelteKit serves it at root), `fetch('/file.json')` via `javascript_tool`, then clean up the copy. Always reload the page after importing so the app's startup hooks create parent docs and pick up new state. `client/static/*.json` should be gitignored to prevent accidentally committing test data.

```js
const { getFirebase } = await import('/src/lib/firebase/init.ts');
const { auth } = getFirebase();
const uid = auth.currentUser.uid;
const res = await fetch('/myfile.json');           // any file under client/static/
const data = await res.json();
// then call the app's own import function — never write directly to Firestore.
```

**Test fixtures:** project-level test data lives in `client/test/fixtures/` (checked-in) once a project starts accumulating any. Copy to `client/static/` to use, clean up after.
