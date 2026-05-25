# Target Tech Stack

The tech stack and layer patterns for this project. See **../CLAUDE.md** for ways of working, and **CLAUDE-SVELTE.md** for Svelte 5 specifics (read this before writing any Svelte code — LLMs habitually drift to Svelte 4 syntax).

The stack is chosen to maximise **first-shot correctness from LLMs**. That means: conventions that live in the repo rather than a library's docs, APIs that can be grepped, and training-corpus-heavy tools.

---

## Stack summary

| Layer | Choice | Why |
|---|---|---|
| Build tool | **Vite** | Ecosystem standard, fast, matches the reference app. |
| Framework | **SvelteKit** | File-based routing, layouts, `$lib` alias, SPA adapter. |
| Language | **Svelte 5 + TypeScript** | Runes (`$state`, `$derived`, `$effect`) — see CLAUDE-SVELTE.md. |
| Deployment | **`adapter-static` (SPA)** | Pure static output. Deploys to Firebase Hosting identically to the reference app. No SSR — avoids the `if (browser)` dance with the Firebase client SDK. |
| Styling | **Tailwind CSS** | Utility-first, inline classes = LLM-readable. |
| Components | **shadcn-svelte** + **bits-ui** | Components are *copied into the repo*, not a dependency. LLMs can grep and read the exact API instead of hallucinating props. |
| Icons | **lucide-svelte** | De-facto standard, huge set, tree-shakes. |
| State | **Class-based rune stores** | One class per domain, `$state` + methods + `$derived` co-located. See "State pattern" below. |
| Backend | **Firebase** — Auth, Firestore, Functions, Storage (private; signed-URL access only) | Same as reference app. All resources in one region, chosen at project creation — see "Region" below. Storage is fully private; access goes through callable-minted signed URLs — see "Storage privacy posture" below. |
| Auth (default) | **Firebase Auth — Email Link sign-in** + `users` whitelist in Firestore (doc id = lowercased email) | Gates `/admin/*` only. End users at `/` are anonymous (no sign-in). Zero passwords, no OAuth consent screen, signed-in users self-administer from `/admin`. See ../CLAUDE.md "Auth & deploy → flow 1" for details. |
| Validation | **Zod** | Used at every I/O boundary: form → Firestore, LLM response → typed object, scraped fields → typed object. |
| LLM | **Gemini API** (via a Cloud Function that holds the key) | Single LLM SDK across the stack. Key lives server-side. Costs are real — no free tier to hide behind. |
| Scraping (simple) | `fetch` from a Cloud Function | CORS-safe, no dependencies, use whenever a plain HTTP body is enough. |
| Scraping (protected sites) | **Puppeteer + `puppeteer-extra-plugin-stealth`** on Cloud Functions | Bullet-proof against the 99% of sites guarded by CF-style bot detection. Cloud Run is the documented escalation for the 1% that need heavier setup. |
| Email (outbound) | **Gmail API**, sending from the user's own Gmail account | Avoids Resend/SendGrid account setup. Provisioned during first-run setup. |
| Notifications (push to phone) | **Ntfy** (`ntfy.sh`) | Zero-account, free, one `fetch` call. Topic lives in `functions/.env`. |
| Local dev | **Firebase emulator suite** | Free local emulation is a hard requirement — see ../CLAUDE.md. |
| Lint/format | **ESLint + Prettier + svelte-check** | `npm run check` = `svelte-check && eslint .` |

---

## Region

Every Firebase resource for a project lives in **one region**, chosen once when the project is created:

- **Firestore** and the **default Storage bucket** — provisioned by the new-project script (`../aa/n`). Default `australia-southeast1` (Sydney); override at creation with `n --region <id>` (single regions only — Functions can't live in a multi-region like `nam5`). **Immutable** once set.
- **Cloud Functions** (and the Cloud Run services + Artifact Registry repos they spawn) — deploy to that same region automatically. `n` records the region in `.env` as `THIS_PROJECT_REGION_ON_GOOGLE_HOSTING`; the functions build generates `functions/src/region.ts` from it (`cmd-region.mjs`), and `setGlobalOptions` reads it in `functions/src/index.ts`. It's baked into source rather than passed as an env var because firebase-tools runs functions discovery in a subprocess with a fixed, minimal env that user values never reach. `region.ts` is gitignored and regenerated on every build.

Functions always sit with their data — no cross-region latency or egress. Don't override per-function; if you genuinely need a function elsewhere, set `region` on that specific `onRequest` / `onCall`, not on `setGlobalOptions`.

---

## Storage privacy posture

**Cloud Storage is fully private. The client never reads or writes objects directly.** `storage.rules` denies everything. Every read goes through a Cloud Functions callable that authenticates the caller (Firebase Auth ID token), authorises them against the `users` whitelist, and mints a short-lived V4 signed URL that the browser fetches with no token plumbing.

Why not the obvious-looking `match /foo/{x} { allow read: if request.auth != null && firestore.exists(...) }`: cross-service Storage→Firestore rules silently 403 in production with no actionable error. We've burned a day on this; not doing it again. Putting the access decision in TypeScript means it's testable, greppable, and the failure mode is a typed exception, not an empty `<audio>` element.

**Project setup `n` already does for you:** the Cloud Functions runtime service account (`<project-number>-compute@developer.gserviceaccount.com`) is granted `roles/iam.serviceAccountTokenCreator` on **itself**. Without this, `file.getSignedUrl()` 500s in the runtime — there's no SA private key locally, so signing falls back to the IAM Credentials API, which requires self-impersonation. The binding is provisioned by `aa/n`'s `grant_token_creator` row on every project; do not remove it. If signing ever 500s on a project you didn't provision via `n`, this is the missing piece.

**Pattern for a new private-Storage feature:**

1. **Write** objects from a Cloud Function via the Admin SDK (`getStorage().bucket().file(path).save(buf)`). Admin SDK bypasses storage rules.
2. **Read** via a new callable in `functions/src/<feature>/` that returns `{ url }` (or `{ url: null }` when the file doesn't exist):
   ```ts
   export const getThingUrl = onCall({ region: FUNCTIONS_REGION }, async (request) => {
     const email = request.auth?.token?.email;
     if (!email) throw new HttpsError('unauthenticated', 'sign-in required');
     const onWhitelist = (await getFirestore().doc(`users/${email.toLowerCase()}`).get()).exists;
     if (!onWhitelist) throw new HttpsError('permission-denied', 'not on the users whitelist');
     // ...validate the input id, build the Storage path...
     const file = getStorage().bucket().file(path);
     const [exists] = await file.exists();
     if (!exists) return { url: null };
     const [url] = await file.getSignedUrl({
       version: 'v4', action: 'read', expires: Date.now() + 15 * 60 * 1000,
     });
     return { url };
   });
   ```
3. **Export** it from `functions/src/index.ts` (separate from the `api` Express function — see CLAUDE-API.md).
4. **Client** calls it with `httpsCallable(functions, 'getThingUrl')`. Drop the result straight into `<img src>` / `<audio src>` / wherever.

Keep the TTL short (15min is the default for playback-style use; tighten further for higher-sensitivity data). The URL carries its own credential, so the browser fetches the object directly with no further auth plumbing.

**Do not** add per-path rule blocks to `storage.rules`. If you find yourself wanting to, you almost certainly want a new callable instead.

---

## Template scope

This repo is a **template**, not an app. It ships with the bare minimum: auth, an empty home page, and the capability layer below. New features land in their own routes (`src/routes/<feature>/`) and their own `functions/src/<feature>/` folder.

The capability layer — `src/lib/services/`, `src/lib/state/`, `src/lib/utils/`, `functions/src/common/` (shared zod schemas + types), and `functions/src/` — is what gets extended, not replaced. Keep new code consistent with the patterns already there.

---

## SvelteKit config

- `adapter-static` with `fallback: 'index.html'` — SPA mode, client-side routing.
- Root `+layout.ts` exports `export const ssr = false` and `export const prerender = false` — disables SSR globally so Firebase client SDK code runs without `if (browser)` guards.
- File-based routing with **route groups** `(groupname)/` for layout boundaries that don't affect the URL (e.g. `(app)/` for authed screens, `(marketing)/` for public pages).

---

## Layer responsibilities

| Layer | Role | Imports from |
|---|---|---|
| `src/routes/` | URL → page composition, layouts | `$lib/components`, `$lib/state` |
| `src/lib/components/` | Presentational + interactive UI | `$lib/state`, `$lib/components/ui` |
| `src/lib/components/ui/` | shadcn-svelte primitives (owned, editable) | Tailwind, bits-ui |
| `src/lib/state/` | Rune stores + domain actions | `$lib/services`, `$common` |
| `src/lib/services/` | Firestore I/O, stateless, `uid`-first | `$common`, firebase SDK |
| `$common/*` (= `functions/src/common/`) | zod schemas + their `z.infer` types for Firestore-backed docs, tagged with `@collection`. **Single home, shared client ↔ functions** — must stay browser-safe (no `firebase-admin` / Node-only imports). | `zod` |
| `src/lib/utils/` | Pure helpers (parsers, id gen, formatters) | `$common` |

**Hard rules:**
- Components **never** import from `services/` directly — they go through `state/`.
- Services **never** import from `state/`. Keeps them testable and framework-free.
- `state/*.svelte.ts` is the **only** place that mutates domain state. Single source of truth, easy to grep.

---

## Client Directory structure

```
client/
├── src/
│   ├── routes/                      ← file-based routing
│   │   ├── +layout.svelte           ← app shell
│   │   ├── +layout.ts               ← ssr=false, prerender=false
│   │   ├── +page.svelte
│   │   └── (app)/
│   │       ├── +layout.svelte       ← authed layout
│   │       └── .../+page.svelte
│   ├── lib/
│   │   ├── components/              ← flat; split by feature only past ~20 files
│   │   │   └── ui/                  ← shadcn-svelte primitives
│   │   ├── state/                   ← class-based rune stores (.svelte.ts)
│   │   ├── services/                ← Firestore I/O
│   │   │   └── firebase.ts          ← init singleton + getFirebaseServices()
│   │   └── utils/
│   │   (zod schemas + types live in functions/src/common/, imported as `$common/*`)
│   ├── app.html
│   ├── app.css                      ← Tailwind entry
│   └── app.d.ts
├── static/                          ← public assets (was `public/` in CRA/Vite-React)
├── svelte.config.js
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## State pattern — class-based rune stores

One file per domain, exported as a singleton. State + actions + derived values co-located.

```ts
// src/lib/state/CategoriesStore.svelte.ts
import * as CategoryService from '$lib/services/CategoryService'
import type { Category, CategoryGroup } from '$common/Category'
import { generateId } from '$lib/utils/generateId'

class CategoriesStore {
  items = $state<Category[]>([])
  groups = $state<CategoryGroup[]>([])
  byId = $derived(new Map(this.items.map((c) => [c.id, c])))

  async ensureCategory(uid: string, name: string, groupId: string): Promise<string> {
    const existing = this.items.find((c) => c.name === name)
    if (existing) return existing.id
    const order = this.items.filter((c) => c.groupId === groupId).length
    const cat: Category = { id: generateId(), name, groupId, order }
    await CategoryService.createCategory(uid, cat)
    this.items.push(cat)
    return cat.id
  }
}

export const categoriesStore = new CategoriesStore()
```

Components then do:

```svelte
<script lang="ts">
  import { categoriesStore } from '$lib/state/CategoriesStore.svelte'
</script>

{#each categoriesStore.items as cat (cat.id)}
  <div>{cat.name}</div>
{/each}
```

**Why this shape:**
- No `useCallback`, no stale closures, no provider tree.
- Every mutation for a domain lives in one file — easy to grep, easy for an LLM to understand without reading five hook files.
- `$derived` replaces Jotai's derived atoms.
- The class is a plain JS class — testable in isolation with no framework harness.

---

## Services pattern

Stateless function modules. `uid` is always the first argument. Firestore batch writes chunk at 500 and commit in parallel with `Promise.all`. After a write, the **caller** (a state store) merges into local state — services never touch stores.

```ts
// src/lib/services/CategoryService.ts
import { collection, doc, writeBatch } from 'firebase/firestore'
import { getFirebaseServices } from './firebase'
import type { Category } from '$common/Category'

export async function createCategory(uid: string, cat: Category): Promise<void> {
  const { db } = await getFirebaseServices()
  const ref = doc(collection(db, `users/${uid}/categories`), cat.id)
  // ...
}
```

## Schema migration

A `SchemaService` owns a `CURRENT_SCHEMA` version and a migration chain. `migrateIfNeeded(uid)` runs on login before data loads. Types moved/renamed trigger a new migration step.

---

## The `check` gate

`npm run check` must pass before completing any code task:

```json
{
  "scripts": {
    "check": "svelte-check --tsconfig ./tsconfig.json && eslint .",
    "dev": "vite dev",
    "build": "npm run check && vite build"
  }
}
```

`svelte-check` covers both `.svelte` and `.ts` type-checking, so a separate `tsc --noEmit` is not needed.

---

## Escalation paths

Things the template deliberately does **not** ship, but documents as "if you need this, here's the supported path":

| Need | Escalation | Notes |
|---|---|---|
| Auth provider beyond Email Link (Google/MS OAuth, SAML, MFA…) | **Firebase Auth additional providers** | Email Link is the default and covers the template audience. Only swap if a user explicitly insists. Watch out for the `signInWithRedirect` Chrome 3rd-party cookie gotcha — see ../CLAUDE.md. |
| Heavier scraping (Cloudflare-hard sites, long-running jobs, custom Chromium flags) | **Cloud Run + Playwright** | Cloud Functions can host Puppeteer+stealth fine for the common case; Cloud Run is the next rung when you hit memory, cold-start, or bundle-size walls. |
| Relational queries | **Firestore with denormalised reads**, or last-resort **Cloud SQL** | NoSQL modelling covers almost every small-app need. Do not add Drizzle or an ORM — the types layer with `@collection` tags is the convention. |
| Voice / SMS in | **Twilio** | Documented but not wired. Compliance and number provisioning are a real commitment — warn the user before starting. |
| AI voice out | **ElevenLabs** | Documented but not wired. No free tier — warn on cost. |
| Mobile apps | **Expo** | Documented but not wired. App-store approval is a saga; set expectations. |
| Realtime / multiplayer | **Firestore `onSnapshot`** | Already covered by the stack — no additional service needed. Listed here so nobody reaches for PartyKit or Socket.io. |

If the user asks for something not in the stack or the escalation list, follow ../CLAUDE.md's rule: suggest the closest alternative that keeps the stack small and LLM-friendly, and only add a new technology if there's a concrete requirement the stack can't meet.
