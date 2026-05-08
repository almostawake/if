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
| Backend | **Firebase** — Auth, Firestore, Functions, Storage | Same as reference app. All resources in `australia-southeast1` (Sydney) — see "Region" below. |
| Auth (default) | **Admin-password callable function** reading `ADMIN_PASSWORD` from `functions/.env` | Avoids OAuth consent screen pain on first run. Matches the template audience: personal automation with a single admin. See "Escalation paths" below if real end users are needed. |
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

All Firebase resources default to **`australia-southeast1`** (Sydney):

- **Firestore** and **default Storage bucket** — provisioned to Sydney by the new-project script (`../aa/n`).
- **Cloud Functions** (and the Cloud Run services + Artifact Registry repos they spawn) — pinned via `setGlobalOptions({region: "australia-southeast1"})` at the top of `functions/src/index.ts`. Every function in this codebase inherits.

Don't override per-function unless there's a real reason — keeping everything in one region avoids cross-region latency and egress costs. If you ever need a function elsewhere, set `region` on that specific `onRequest` / `onCall` / etc., not by editing `setGlobalOptions`.

---

## Template scope

This repo is a **template**, not an app. The rules:

- **Permanent plumbing:** everything under `src/lib/services/`, `src/lib/state/`, `src/lib/types/`, `src/lib/utils/`, and `functions/src/` files that aren't inside `functions/src/watchdog/`. These are the real capability layer — keep them, extend them.
- **Disposable demo:** everything under `src/routes/(demo)/` and `functions/src/watchdog/`. These exist **only** to prove the plumbing works end-to-end. Delete the demo when real work starts.
- **Do not add features to `(demo)/`.** Add them to new routes and a new `functions/src/{feature}/` folder.
- **First file in every demo file** carries this comment, redundantly with this doc, because LLMs obey comments they can see:
  ```ts
  // DEMO — delete (demo)/ route group + functions/src/watchdog/ when starting real work. Not a feature.
  ```

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
| `src/lib/state/` | Rune stores + domain actions | `$lib/services`, `$lib/types` |
| `src/lib/services/` | Firestore I/O, stateless, `uid`-first | `$lib/types`, firebase SDK |
| `src/lib/types/` | Pure TS types with `@collection` JSDoc tags | nothing |
| `src/lib/utils/` | Pure helpers (parsers, id gen, formatters) | `$lib/types` |

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
│   │   ├── types/                   ← @collection JSDoc tags
│   │   └── utils/
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
import type { Category, CategoryGroup } from '$lib/types/Category'
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
import type { Category } from '$lib/types/Category'

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
| Real end users (not just an admin) | **Firebase Auth — Email Link sign-in** | Simpler than Google/MS OAuth for a non-technical audience: no consent screens, no client configuration. Point the user at Google OAuth only if they insist. |
| Heavier scraping (Cloudflare-hard sites, long-running jobs, custom Chromium flags) | **Cloud Run + Playwright** | Cloud Functions can host Puppeteer+stealth fine for the common case; Cloud Run is the next rung when you hit memory, cold-start, or bundle-size walls. |
| Relational queries | **Firestore with denormalised reads**, or last-resort **Cloud SQL** | NoSQL modelling covers almost every small-app need. Do not add Drizzle or an ORM — the types layer with `@collection` tags is the convention. |
| Voice / SMS in | **Twilio** | Documented but not wired. Compliance and number provisioning are a real commitment — warn the user before starting. |
| AI voice out | **ElevenLabs** | Documented but not wired. No free tier — warn on cost. |
| Mobile apps | **Expo** | Documented but not wired. App-store approval is a saga; set expectations. |
| Realtime / multiplayer | **Firestore `onSnapshot`** | Already covered by the stack — no additional service needed. Listed here so nobody reaches for PartyKit or Socket.io. |

If the user asks for something not in the stack or the escalation list, follow ../CLAUDE.md's rule: suggest the closest alternative that keeps the stack small and LLM-friendly, and only add a new technology if there's a concrete requirement the stack can't meet.
