# Target Tech Stack

The tech stack and layer patterns for this project. See **../CLAUDE.md** for ways of working, and **CLAUDE-REACT.md** for the React conventions (read this before writing any client code — the React corpus is twenty years deep and most of it is out of date).

The stack is chosen to maximise **first-shot correctness from LLMs**. That means: conventions that live in the repo rather than a library's docs, APIs that can be grepped, and training-corpus-heavy tools.

---

## Stack summary

| Layer | Choice | Why |
|---|---|---|
| Build tool | **Vite** | Ecosystem standard, fast, matches the reference app. |
| Framework | **React 19 + TypeScript** | The largest training corpus of any UI framework, which is the whole point — see CLAUDE-REACT.md. |
| Routing | **React Router v7** (declarative mode) | One route table in `src/router.tsx`, which is also the auth gate. No loaders/actions, no framework mode. |
| Deployment | **Vite SPA build → `client/dist`** | Pure static output, served by Firebase Hosting with a catch-all rewrite to `/index.html`. No SSR — avoids the `typeof window` dance with the Firebase client SDK. |
| Styling | **Tailwind CSS** | Utility-first, inline classes = LLM-readable. |
| Components | **shadcn/ui** | Components are *copied into the repo* (`src/components/ui/`), not a dependency. LLMs can grep and read the exact API instead of hallucinating props. Add one when a screen actually needs it — the folder starts empty. |
| Icons | **lucide-react** | De-facto standard, huge set, tree-shakes. Add when first needed. |
| State | **Zustand** | One store per domain in `src/state/`, state + actions co-located. See "State pattern" below. |
| Backend | **Firebase** — Auth, Firestore, Functions, Storage (private; signed-URL access only) | Same as reference app. All resources in one region, chosen at project creation — see "Region" below. Storage is fully private; access goes through callable-minted signed URLs — see "Storage privacy posture" below. |
| Auth (default) | **Firebase Auth — phone (SMS) sign-in** + `users` whitelist in Firestore (doc id = E.164 mobile) | Gates everything except `/`, the sign-in screen; the whole signed-in surface sits in the `(app)` route group. No public/anonymous surface. Zero passwords, no OAuth consent screen, signed-in users self-administer from `/users`. Billed per SMS and locked to an allowlisted country — see CLAUDE-AUTH.md before touching either. |
| Validation | **Zod** | Used at every I/O boundary: form → Firestore, LLM response → typed object, scraped fields → typed object. |
| LLM | **Gemini API** (via a Cloud Function that holds the key) | Single LLM SDK across the stack. Key lives server-side. Costs are real — no free tier to hide behind. |
| Scraping (simple) | `fetch` from a Cloud Function | CORS-safe, no dependencies, use whenever a plain HTTP body is enough. |
| Scraping (protected sites) | **Puppeteer + `puppeteer-extra-plugin-stealth`** on Cloud Functions | Bullet-proof against the 99% of sites guarded by CF-style bot detection. Cloud Run is the documented escalation for the 1% that need heavier setup. |
| Email (outbound) | **Gmail API**, sending from the user's own Gmail account | Avoids Resend/SendGrid account setup. |
| Notifications (push to phone) | **Ntfy** (`ntfy.sh`) | Zero-account, free, one `fetch` call. Topic lives in `functions/.env`. |
| Local dev | **Firebase emulator suite** | Free local emulation is a hard requirement — see ../CLAUDE.md. |
| Lint/format | **ESLint + Prettier + tsc** | `npm run check` = `tsc --noEmit && eslint .`; `npm run format` = Prettier (tailwind class sorting). ESLint runs the full `react-hooks` set, React Compiler rules included. |

---

## Region

Every Firebase resource for a project lives in **one region**, chosen once when the project is created:

- **Firestore** and the **default Storage bucket** — created with the project. Default `australia-southeast1` (Sydney); single regions only — Functions can't live in a multi-region like `nam5`. **Immutable** once set.
- **Cloud Functions** (and the Cloud Run services + Artifact Registry repos they spawn) — deploy to that same region automatically. The region is recorded in `.env` as `THIS_PROJECT_REGION_ON_GOOGLE_HOSTING`; the functions build generates `functions/src/region.ts` from it (`cmd-region.mjs`), and `setGlobalOptions` reads it in `functions/src/index.ts`. It's baked into source rather than passed as an env var because firebase-tools runs functions discovery in a subprocess with a fixed, minimal env that user values never reach. `region.ts` is gitignored and regenerated on every build.

Functions always sit with their data — no cross-region latency or egress. Don't override per-function; if you genuinely need a function elsewhere, set `region` on that specific `onRequest` / `onCall`, not on `setGlobalOptions`.

---

## Google APIs already enabled

The project is **linked to a billing account at creation** — paid services (Functions Gen 2, Cloud Run, Vertex AI) already work. Never treat billing setup or a plan upgrade as a blocker; do flag features likely to carry real spend before building them.

Project creation also enables these APIs (all `*.googleapis.com`) — treat them as available, never as something the user must turn on:

- **Firebase core** — `firebase`, `firestore`, `storage` + `firebasestorage`, `identitytoolkit` (Auth), `firebasehosting`
- **Functions deploy/runtime chain** — `cloudfunctions`, `cloudbuild`, `run`, `artifactregistry`, `eventarc`, `pubsub`
- **Scheduled jobs** — `cloudscheduler` (`onSchedule` triggers work with no extra setup)
- **AI** — `aiplatform` (Vertex AI → Gemini). The Functions runtime service account already holds `roles/aiplatform.user` — Gemini calls from Functions need no extra IAM.
- **Speech-to-text** — `speech` (Cloud Speech-to-Text). Transcribe audio from Functions with the runtime SA's own ADC token — no API key, no outside transcription vendor. If a call ever returns `PERMISSION_DENIED`, grant the runtime SA `roles/speech.client` as part of the feature work.
- **User-consented data** — `gmail`, `calendar-json` (pairs with the consent flow's default `ADMIN_CONSENTS` scopes)
- **Plumbing** — `cloudbilling`, `apikeys`

**Pre-provisioned means use-it-by-default.** When a task needs a capability this list already covers, the enabled service IS the choice — do not substitute an outside provider, and treat a missing API key as a signal to use the platform, not to improvise a workaround. The canonical case is AI: call **Gemini through Vertex AI** (`aiplatform.googleapis.com`, authenticated with the standard Google token — `cmd-auth.mjs` locally, ADC in Functions), **not** the Gemini direct API (`generativelanguage.googleapis.com` with an API key) and not another vendor (Anthropic/OpenAI — no such credentials are provisioned).

Anything not listed (Sheets, Drive, Maps, …) is **not** enabled. Enabling one is part of the feature work, not a user chore: get a token per docs/CLAUDE-DEPLOY.md, `POST https://serviceusage.googleapis.com/v1/projects/<pid>/services/<api>:enable`, and mention to the user that a new Google service was switched on for their project.

---

## Storage privacy posture

**Cloud Storage is fully private. The client never reads or writes objects directly.** `storage.rules` denies everything. Every read goes through a Cloud Functions callable that authenticates the caller (Firebase Auth ID token), authorises them against the `users` whitelist, and mints a short-lived V4 signed URL that the browser fetches with no token plumbing.

Why not the obvious-looking `match /foo/{x} { allow read: if request.auth != null && firestore.exists(...) }`: cross-service Storage→Firestore rules silently 403 in production with no actionable error. We've burned a day on this; not doing it again. Putting the access decision in TypeScript means it's testable, greppable, and the failure mode is a typed exception, not an empty `<audio>` element.

**Project-level IAM this relies on:** the Cloud Functions runtime service account (`<project-number>-compute@developer.gserviceaccount.com`) is granted `roles/iam.serviceAccountTokenCreator` on **itself** — set at project creation; do not remove it. Without this, `file.getSignedUrl()` 500s in the runtime — there's no SA private key locally, so signing falls back to the IAM Credentials API, which requires self-impersonation. If signing ever 500s, this binding is the missing piece.

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

## Scope

The app ships deliberately minimal: sign-in, the users whitelist, and the capability layer below. New features land in their own page (`src/pages/<Feature>Page.tsx`, registered under `AppLayout` in `src/router.tsx` so they inherit the auth gate) and their own `functions/src/<feature>/` folder.

The capability layer — `src/services/`, `src/state/`, `src/utils/`, `functions/src/common/` (shared zod schemas + types), and `functions/src/` — is what gets extended, not replaced. Keep new code consistent with the patterns already there.

---

## Vite + React config

- Plain `vite build` → `client/dist`, a static SPA. Firebase Hosting rewrites `**` to `/index.html` so client-side routing works on a hard refresh.
- There is no SSR and no prerender step at all, so Firebase client SDK code runs without `typeof window` guards.
- Routing is a **route table**, not a folder convention: `src/router.tsx` lists every URL. Routes nested under `AppLayout` are behind the auth gate; routes at the top level are public. **A new page is gated by which array it goes in** — see CLAUDE-AUTH.md.
- Two path aliases, declared in both `vite.config.ts` and `tsconfig.json`: `@/` → `client/src/`, `@common/` → `functions/src/common/`.

---

## Layer responsibilities

| Layer | Role | Imports from |
|---|---|---|
| `src/router.tsx` | The URL map, and the auth gate | `@/layouts`, `@/pages` |
| `src/pages/` | One file per screen | `@/components`, `@/state` |
| `src/layouts/` | Shared chrome + the signed-in gate | `@/components`, `@/state` |
| `src/components/` | Presentational + interactive UI | `@/state`, `@/components/ui` |
| `src/components/ui/` | shadcn/ui primitives (owned, editable) | Tailwind |
| `src/state/` | Zustand stores + domain actions | `@/services`, `@common` |
| `src/services/` | Firestore I/O, stateless, `uid`-first | `@common`, firebase SDK |
| `@common/*` (= `functions/src/common/`) | zod schemas + their `z.infer` types for Firestore-backed docs, tagged with `@collection`. **Single home, shared client ↔ functions** — must stay browser-safe (no `firebase-admin` / Node-only imports). | `zod` |
| `src/utils/` | Pure helpers (parsers, id gen, formatters) | `@common` |

**Hard rules:**
- Components **never** import from `services/` directly — they go through `state/`.
- Services **never** import from `state/`. Keeps them testable and framework-free.
- `src/state/*` is the **only** place that mutates domain state. Single source of truth, easy to grep.

---

## Client Directory structure

```
client/
├── index.html                       ← the SPA shell (fonts, #root)
├── src/
│   ├── main.tsx                     ← createRoot + StrictMode + RouterProvider
│   ├── router.tsx                   ← THE route table, and the auth gate
│   ├── layouts/
│   │   └── AppLayout.tsx            ← signed-in gate + top bar + <Outlet/>
│   ├── pages/                       ← one file per screen
│   ├── components/                  ← flat; split by feature only past ~20 files
│   │   └── ui/                      ← shadcn/ui primitives (empty until needed)
│   ├── state/                       ← Zustand stores
│   ├── services/                    ← Firestore I/O
│   ├── firebase/init.ts             ← init singleton + getFirebase()
│   ├── utils/
│   │   (zod schemas + types live in functions/src/common/, imported as `@common/*`)
│   └── app.css                      ← Tailwind entry + @theme tokens
├── public/                          ← static assets served at root
├── dist/                            ← build output (gitignored)
├── vite.config.ts                   ← plugins + the @ / @common aliases
├── eslint.config.js
├── tsconfig.json                    ← one file, no project references
└── package.json
```

There is deliberately **no `tailwind.config.js`** — Tailwind v4 is configured in `src/app.css`.

---

## State pattern — Zustand stores

One file per domain in `src/state/`, exported as `useXStore`. State and actions co-located.

```ts
// src/state/categoriesStore.ts
import { create } from 'zustand';
import * as CategoryService from '@/services/CategoryService';
import type { Category } from '@common/Category';
import { generateId } from '@/utils/generateId';

type CategoriesState = {
  items: Category[];
  ensureCategory: (uid: string, name: string, groupId: string) => Promise<string>;
};

export const useCategoriesStore = create<CategoriesState>((set, get) => ({
  items: [],

  ensureCategory: async (uid, name, groupId) => {
    const existing = get().items.find((c) => c.name === name);
    if (existing) return existing.id;
    const order = get().items.filter((c) => c.groupId === groupId).length;
    const cat: Category = { id: generateId(), name, groupId, order };
    await CategoryService.createCategory(uid, cat);
    set((s) => ({ items: [...s.items, cat] }));
    return cat.id;
  },
}));
```

Components then do:

```tsx
// One selector per field — selecting an object literal returns a new
// reference every render and re-renders on every unrelated change.
const items = useCategoriesStore((s) => s.items);

return items.map((cat) => <div key={cat.id}>{cat.name}</div>);
```

Outside a component — in an effect, a callback, another store — read it imperatively with no subscription:

```ts
useCategoriesStore.getState().ensureCategory(uid, name, groupId);
```

**Why this shape:**
- No provider tree, no context plumbing, no `useReducer` boilerplate.
- Every mutation for a domain lives in one file — easy to grep, easy for an LLM to understand without reading five hook files.
- Derived values are computed in the component during render, or in a selector; there is no separate derived-atom concept to learn.
- The store is callable outside React, so services and effects use the same API components do.

## Services pattern

Stateless function modules. `uid` is always the first argument. Firestore batch writes chunk at 500 and commit in parallel with `Promise.all`. After a write, the **caller** (a state store) merges into local state — services never touch stores.

```ts
// src/services/CategoryService.ts
import { collection, doc, writeBatch } from 'firebase/firestore'
import { getFirebase } from '@/firebase/init'
import type { Category } from '@common/Category'

export async function createCategory(uid: string, cat: Category): Promise<void> {
  const { db } = getFirebase()
  const ref = doc(collection(db, `users/${uid}/categories`), cat.id)
  // ...
}
```

## Data model conventions

- All Firestore-backed schemas live in **`functions/src/common/`** — single source of truth, shared with the client via the `@common` alias (configured in both `client/vite.config.ts` and `client/tsconfig.json`). Files there must stay browser-safe (zod + pure TS only, no `firebase-admin` / Node-only imports).
- One PascalCase file per type (e.g. `User.ts`). Each file exports a zod schema and a `z.infer`-derived type — never declare a bare `interface` here. Multiple related types may share a file, each with its own `@collection` tag.
- Every Firestore-backed type carries a `@collection` JSDoc tag with its full path (e.g. `@collection users/{e164Mobile}` or `@collection users/{uid}/transactions`). Update the tag when renaming/moving collections.
- Validate at I/O boundaries: parse incoming Firestore snapshots and outgoing writes with the schema (`userSchema.parse(...)`) so a drifting wire shape fails loudly instead of silently corrupting state.
- Imports: `import { userSchema, type User } from '@common/User'` (client) or `'../common/User'` (functions, relative).

## Schema migration

A `SchemaService` owns a `CURRENT_SCHEMA` version and a migration chain. `migrateIfNeeded(uid)` runs on login before data loads. Types moved/renamed trigger a new migration step.

---

## The `check` gate

`npm run check` must pass before completing any code task:

```json
{
  "scripts": {
    "check": "tsc --noEmit && eslint .",
    "dev": "vite",
    "build": "vite build"
  }
}
```

ESLint runs the full `eslint-plugin-react-hooks` recommended set — including the React Compiler rules (purity, immutability, `set-state-in-effect`) — with `rules-of-hooks` and `exhaustive-deps` promoted to errors. Those two catch the classic React bugs: a hook behind an early return, and an effect reading a stale value.

---

## Escalation paths

Things the stack deliberately does **not** include, but documents as "if you need this, here's the supported path":

| Need | Escalation | Notes |
|---|---|---|
| Auth provider beyond SMS (Google/MS OAuth, SAML, MFA…) | **Firebase Auth additional providers** | SMS sign-in is the default and covers the target audience. Only swap if a user explicitly insists. Watch out for the `signInWithRedirect` Chrome 3rd-party cookie gotcha — see CLAUDE-AUTH.md. |
| Heavier scraping (Cloudflare-hard sites, long-running jobs, custom Chromium flags) | **Cloud Run + Playwright** | Cloud Functions can host Puppeteer+stealth fine for the common case; Cloud Run is the next rung when you hit memory, cold-start, or bundle-size walls. |
| Relational queries | **Firestore with denormalised reads**, or last-resort **Cloud SQL** | NoSQL modelling covers almost every small-app need. Do not add Drizzle or an ORM — the types layer with `@collection` tags is the convention. |
| Voice / SMS in | **Twilio** | Documented but not wired. Compliance and number provisioning are a real commitment — warn the user before starting. |
| AI voice out | **ElevenLabs** | Documented but not wired. No free tier — warn on cost. |
| Mobile apps | **Expo** | Documented but not wired. App-store approval is a saga; set expectations. |
| Realtime / multiplayer | **Firestore `onSnapshot`** | Already covered by the stack — no additional service needed. Listed here so nobody reaches for PartyKit or Socket.io. |

If the user asks for something not in the stack or the escalation list, follow ../CLAUDE.md's rule: suggest the closest alternative that keeps the stack small and LLM-friendly, and only add a new technology if there's a concrete requirement the stack can't meet.
