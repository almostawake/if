# The Probe — Template Demo Scope

This file describes the **only** feature that ships with the template: a capability probe that proves every wire in the stack works end-to-end. It is not an app. It is scaffolding that happens to be interesting enough to leave running.

See **CLAUDE-STACK.md** for the broader template-scope rules (plumbing vs demo, deletion boundaries).

---

## Why the probe exists

A template has a tension: it needs to prove the stack wires up correctly (otherwise the first-run experience is "why isn't my database connecting?"), but it must not look so much like an app that an LLM starts extending *it* instead of replacing it with the user's real app.

The resolution used here:

1. **One page, one story.** Not N "demo pages". A single probe page with a single coherent narrative. Hard to mistake for a half-built app because it is obviously a worked example.
2. **Plumbing is permanent, demo is disposable.** The services, state stores, types, and generic Cloud Functions that the probe uses are the real capability layer — they stay forever. The probe's own page and its watchdog-specific functions delete as one folder each.
3. **The probe is useful.** The narrative is a real, recognisable small-app pattern (watch a thing, tell me when it changes). Users who want nothing more than that are not tricked into rewriting. Users who want more have a worked example of every integration pattern in the stack.
4. **Capabilities stay exercised.** Because the probe is genuinely fun to leave running, the wires get proven continuously — not just on the first day.

---

## The narrative

**"Saylor vs Buffett — the eternal duel, refereed by BTC."**

Every 5 minutes, a scheduled Cloud Function runs a four-step pipeline:

1. **Fetch** the current BTC/USD price from CoinGecko's free public API.
2. **Scrape** CoinMarketCap's BTC page for the Fear & Greed index — this is the capability probe for Puppeteer + stealth, and CMC is Cloudflare-protected on purpose (see "Why CMC, explained to a non-technical user" below).
3. **Fetch** the top 3 Google News RSS headlines for "Michael Saylor" and for "Warren Buffett".
4. **Ask Gemini** to write a one-sentence, tongue-in-cheek scorecard for the round — who's winning the narrative, citing at least one headline from each side and the price/sentiment move — given all four inputs.

The one-sentence verdict is stored in a `runs` subcollection with a timestamp, the raw inputs, a screenshot of the scraped page, and a Zod-validated structured verdict `{ winner: 'saylor' | 'buffett' | 'draw', verdict: string }`.

The probe page shows:

- A **heartbeat** row at the top: "Last run {N} min ago" (red if stale).
- A **live rolling timeline** of the last ~20 verdicts, updated via `onSnapshot` — no refresh needed.
- A **"Run now"** button that triggers the same pipeline as a callable function (proves the pipeline is decomposable — scheduler and manual-trigger share one code path).
- **Per-row screenshot viewer** — click a row to see the CMC screenshot captured at that moment, pulled from Firebase Storage.
- **Config panel** — edit the target URL, the Gemini prompt, the Ntfy topic, and the "email me a summary" toggle. (Admins only — protected by the admin-password session.)

## Why CMC, explained to a non-technical user

The probe page should include a short collapsible note the first time it's opened:

> **Why are we scraping CoinMarketCap instead of using an API?**
>
> CoinMarketCap is protected by Cloudflare's bot detection — the kind of challenge page you sometimes see as "Checking your browser…". Most real-world websites you'll want to automate against use something similar. This probe uses a stealth browser to get past that, and it works the same way on most sites you'd point it at next. We could have used the CoinGecko API for the price alone — and we do — but we scrape CMC on purpose to prove that the "automate any website" path works out of the box.

This reframes the scrape from "geek credential" to "the capability you'll need within your first week".

---

## Capability map

| Step | Capability | Lives in |
|---|---|---|
| Admin login gate on `/probe` | Admin password auth (callable function verifying `ADMIN_PASSWORD` from `functions/.env`) | `functions/src/auth.ts` + `src/lib/services/AuthService.ts` + `src/lib/state/authStore.svelte.ts` |
| Read / write watch config | Firestore | `src/lib/services/FirestoreService.ts` (or per-collection services) |
| Live history timeline | Firestore `onSnapshot` | `src/lib/state/watchdogStore.svelte.ts` |
| Screenshot upload + viewer | Firebase Storage | `src/lib/services/StorageService.ts` |
| 5-minute pipeline trigger | Scheduled Cloud Function (`onSchedule('every 5 minutes')`) | `functions/src/watchdog/scheduled.ts` |
| Manual trigger ("Run now") | HTTPS callable function, shared pipeline | `functions/src/watchdog/runNow.ts` |
| BTC price | `fetch` — CoinGecko | `functions/src/watchdog/pipeline.ts` |
| Saylor + Buffett headlines | `fetch` — Google News RSS | `functions/src/watchdog/pipeline.ts` |
| CMC Fear & Greed | Puppeteer + stealth | `functions/src/watchdog/scrape.ts` |
| One-sentence verdict | Gemini API | `functions/src/gemini.ts` (generic) + prompt in `functions/src/watchdog/pipeline.ts` |
| Typed verdict shape | Zod | validated in `functions/src/watchdog/pipeline.ts` before write |
| Phone notification on verdict flip | Ntfy | `functions/src/ntfy.ts` (generic) |
| Email summary on verdict flip | Gmail API | `functions/src/gmail.ts` (generic) |
| Typed data-model contract | `@collection` JSDoc tags on `types/Watchdog.ts`, `types/WatchdogRun.ts` | `src/lib/types/` |

Every row in the "lives in" column marked with a **generic** file (`gemini.ts`, `gmail.ts`, `ntfy.ts`, everything in `src/lib/services/`) is **permanent plumbing**. The rest — anything under `src/routes/(demo)/` or `functions/src/watchdog/` — is disposable.

---

## Default config shipped with the template

Pre-filled so the probe does something meaningful within 30 seconds of first login. The user changes these during onboarding if they want.

| Setting | Default |
|---|---|
| Scrape target | `https://coinmarketcap.com/currencies/bitcoin/` |
| Scrape fields | `{ price, fearAndGreed, dominancePct }` — partial results OK if any field can't be extracted |
| Fetch (price) | `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd` |
| Fetch (Saylor news) | `https://news.google.com/rss/search?q=michael+saylor&hl=en` |
| Fetch (Buffett news) | `https://news.google.com/rss/search?q=warren+buffett&hl=en` |
| Gemini prompt | See "The Gemini prompt" below |
| Schedule | Every 5 minutes |
| Ntfy topic | *empty* — user opts in during onboarding |
| Email toggle | *off* — user opts in during onboarding |
| Alternative stress-test scrape target | `https://nowsecure.nl` — documented in the config panel's help text, not wired as default. The canonical stealth-plugin test target, useful when diagnosing whether the stealth path is broken. |

### The Gemini prompt

```
BTC: ${price} USD (was ${prevPrice}, Δ ${pct}% since last run).
CoinMarketCap Fear & Greed: ${fearAndGreed ?? 'unavailable'}.

Michael Saylor — latest headlines:
1. ${saylor[0]}
2. ${saylor[1]}
3. ${saylor[2]}

Warren Buffett — latest headlines:
1. ${buffett[0]}
2. ${buffett[1]}
3. ${buffett[2]}

You are narrating an eternal duel between the BTC maximalist (Saylor) and the
value-investing skeptic (Buffett). Write one tongue-in-cheek sentence scoring
round ${n}: who is winning the narrative, referencing the price/sentiment move
and at least one headline from each side. Be playful. Do not claim real causation.

Respond ONLY with JSON matching this schema:
{ "winner": "saylor" | "buffett" | "draw", "verdict": string }
```

The response is parsed and Zod-validated; a parse failure is recorded as a run error, not a crash.

---

## Degradation rules (template-wide, not probe-specific)

These are general patterns the probe demonstrates, and which every future feature should follow:

1. **Scrapers return partial results rather than throw.** If the page loads but one selector misses, return `{ price, fearAndGreed: null }`. Never throw from a scraper for missing fields — only for hard failures (timeout, navigation error).
2. **LLM prompts handle missing fields.** Every field injected into a prompt is guarded with `?? 'unavailable'` or equivalent. The LLM's job is to reason around missing data, not crash on it.
3. **LLM responses are always Zod-validated before use.** A malformed response becomes a recorded error, not a type-cast lie.
4. **Scheduled functions write a heartbeat.** Every scheduled run writes `lastRunAt` to a heartbeat doc, successful or not. The UI reads this to show "scheduler healthy / stale". No heartbeat after 2× the schedule interval ⇒ red.
5. **Every external call has a "run now" manual equivalent.** If the real pipeline is in a callable function and the scheduler just invokes it, you never have to wait 5 minutes to debug.

---

## File map

Every file is marked **P** (permanent plumbing) or **D** (disposable demo).

```
client/src/routes/
├── +layout.svelte                              P  app shell (auth gate, shadcn toaster)
├── +layout.ts                                  P  ssr=false, prerender=false
├── +page.svelte                                P  landing → redirects to /probe if admin, else /login
├── login/+page.svelte                          P  admin password form
└── (demo)/
    └── probe/
        ├── +page.svelte                        D  probe UI — heartbeat, timeline, config, screenshot viewer
        └── +page.ts                            D  auth guard

client/src/lib/
├── components/
│   ├── ui/                                     P  shadcn-svelte primitives
│   ├── HeartbeatRow.svelte                     D  the "last run N min ago" strip
│   ├── VerdictTimeline.svelte                  D  onSnapshot-driven list
│   └── ScreenshotViewer.svelte                 D  storage-backed image panel
├── services/
│   ├── firebase.ts                             P  init singleton, getFirebaseServices()
│   ├── AuthService.ts                          P  admin password login wrapper
│   ├── FirestoreService.ts                     P  typed collection helpers
│   ├── StorageService.ts                       P  upload/download/signed URLs
│   ├── GeminiService.ts                        P  callable wrapper → functions/src/gemini.ts
│   ├── ScrapeService.ts                        P  callable wrapper → functions/src/scrape.ts
│   ├── NtfyService.ts                          P  callable wrapper → functions/src/ntfy.ts
│   └── GmailService.ts                         P  callable wrapper → functions/src/gmail.ts
├── state/
│   ├── authStore.svelte.ts                     P  admin session + heartbeat claim
│   └── watchdogStore.svelte.ts                 D  onSnapshot of config + runs
├── types/
│   ├── Watchdog.ts                             D  @collection users/{uid}/watchdog
│   └── WatchdogRun.ts                          D  @collection users/{uid}/watchdog/{id}/runs
└── utils/
    ├── generateId.ts                           P  opaque id for docs
    └── rssParse.ts                             P  tiny RSS → [{title, link, pubDate}] helper

functions/src/
├── index.ts                                    P  exports all callables + schedules
├── auth.ts                                     P  verifyAdminPassword callable
├── gemini.ts                                   P  generic Gemini call with Zod-validated response
├── scrape.ts                                   P  generic Puppeteer+stealth page.goto + extract
├── ntfy.ts                                     P  generic POST to ntfy.sh
├── gmail.ts                                    P  generic Gmail-send using user's refresh token
└── watchdog/
    ├── scheduled.ts                            D  onSchedule('every 5 minutes') → pipeline
    ├── runNow.ts                               D  callable → pipeline
    └── pipeline.ts                             D  orchestration: fetch + scrape + gemini + store + notify
```

**The "P" files are your stack's real capability layer.** Every generic thing (scrape, gemini, gmail, ntfy) is written as a single-purpose function that takes inputs and returns outputs — no watchdog-specific logic leaks into them. When you delete the watchdog, those files keep working for whatever you build next.

---

## How to start your real app

1. Delete `client/src/routes/(demo)/`.
2. Delete `functions/src/watchdog/`.
3. Delete `client/src/lib/state/watchdogStore.svelte.ts`.
4. Delete `client/src/lib/types/Watchdog.ts` and `WatchdogRun.ts`.
5. Delete `client/src/lib/components/{HeartbeatRow,VerdictTimeline,ScreenshotViewer}.svelte` (or keep HeartbeatRow if your real app has a scheduled function — it's reusable).
6. Delete the `users/{uid}/watchdog` Firestore collection via the emulator UI (or a real console when deployed).
7. Re-export `functions/src/index.ts` to remove watchdog references.
8. Run `npm run check` — it should pass with the watchdog gone.

Everything that remains is your starting point. The probe is gone; the capabilities it proved are still wired.

---

## Not yet documented (deferred)

Things that still need to land before the template is runnable. Tracking here so we don't lose them:

- **Resource provisioning walkthrough.** How the user gets a Gemini API key, connects their Gmail account (OAuth consent + refresh-token storage), chooses an Ntfy topic, sets `ADMIN_PASSWORD`, and creates the Firebase project. Equivalent to `cf-template-app/CLAUDE.md` § "First-time Setup". Auto-provision where possible; instruct via dashboard only as last resort.
- **Real Firestore security rules** for `users/{uid}/watchdog` and `users/{uid}/watchdog/{id}/runs`. `firestore.rules` is currently deny-all.
- **`client/` scaffold itself** — `npm create svelte@latest`, Tailwind init, shadcn-svelte init, Firebase client init, the `check` script, `.svelte.ts` example.
- **`functions/` scaffold** — TypeScript, emulator wiring, the admin-password callable, stub exports of generic services so imports resolve before the watchdog lands.
- **Onboarding flow** — the first-run walkthrough in `CLAUDE.md` (prerequisites, local run, first deploy, delete-this-section). Template-specific; lift from cf-template-app and adapt.
- **Decision on Puppeteer hosting constraints** — Cloud Functions 2nd gen memory limits for Chromium; `@sparticuz/chromium` vs full Puppeteer; cold-start budget. Verify before scaffolding.
- **`package.json` `check` script actually existing** in `client/` — currently the root package.json references `cd client && npm run check` but there's no `client/` yet.
