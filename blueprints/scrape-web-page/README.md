# Blueprint: scrape-web-page

**Status:** research draft. The `snippets/` directory contains reference code lifted from a prior project for ideas only — names, libraries, and storage choices are not yet committed for this template. Treat them as inspiration, not API.

**Audience for this file:** Claude Code (the LLM running a session for a novice App Builder). The novice does not know puppeteer, stealth, DOM internals, or anti-bot countermeasures. **You are the one who follows this plan; they are the one you check in with at gates.**

---

## When this blueprint applies

Any task that involves *programmatically loading a web page and extracting data from it*. Common shapes:

- "Scrape X from website Y on a schedule and save it"
- "Watch page Z for changes / new items"
- "Pull data from a portal that doesn't have an API"
- "Log into site W and grab data that's behind the login wall"

If the target has a public, documented API, **stop and propose that instead** — scraping is the fallback, not the default. The novice user probably doesn't know there's an API; ask.

If the target is a static page with no auth, no JS rendering, and no anti-bot, **stop and propose `fetch` + a simple HTML parser instead** — a headless browser is the fallback, not the default. You only need this blueprint when the page actually fights back (JS-rendered, auth-walled, or bot-detected).

---

## The drift problem (read this every phase boundary)

This is a long-running, multi-phase task. By Phase 2, the LLM's original plan has been buried under tool output. The mechanisms that keep you on track are *structural*, not prose:

1. **Phase gates.** End every phase by *showing the user something concrete* (a screenshot, a row of extracted data, a saved HTML file) and **stopping until they confirm**. Do not bulldoze through gates. The gate is the human-in-loop — it is what makes the plan survive.
2. **`scrape-plan.md` in the project root.** Write it at the start of Phase 0. Update it at each phase boundary with: target URL, auth shape, sample data shape, what worked, what failed, current phase. When you (or a future session) get lost, **re-read this file before doing anything else**.
3. **Phase 1 should be a single page.** Not a batch, not a schedule, not a database write. One page, one extraction, shown to the user. Resist scope creep — the urge to "just also handle X" is the drift.

If you find yourself debugging deep in Phase 2 and you can't remember what the user actually wanted, stop. Re-read `scrape-plan.md`. Re-read this file from the top.

---

## Phases

### Phase 0 — Reconnaissance (no scraping code yet)

**Goal:** characterise the target. Decide which path the rest of the work takes.

**How you observe the target:** drive a real local browser via the **chrome-devtools MCP** (per the user's global instructions — it's pre-registered, no per-project setup). Open a new tab with `background: true`, navigate, then use the MCP tools to inspect:
- `list_network_requests` — find XHR/Fetch endpoints returning JSON (these often *are* the answer)
- `take_snapshot` / `evaluate_script` — see what's actually in the rendered DOM
- `take_screenshot` — capture what the user would see (useful at the gate)
- `list_console_messages` — surface warnings about CORS, blocked trackers, etc.

This is much better than guessing from `curl` output: you're seeing exactly what a logged-in human sees, in the same browser profile, with the same cookies.

**Output artifact:** `scrape-plan.md` in the project root with the recon findings. Show this to the user before writing any scraping code.

Run this checklist mechanically — do not skip steps because the answer "seems obvious":

1. **Is there an API?** With the page open in chrome-devtools MCP, `list_network_requests` after a reload. Look for XHR/Fetch responses with the data you want. If found — **stop scraping, propose calling the API directly**. This is the single biggest win available; do not skip it.
2. **Is the data in the initial HTML, or rendered after?** Compare `view-source:` (server HTML) with the live DOM (via MCP `take_snapshot`). If the data is in the server HTML, a plain `fetch` is enough — no browser needed.
3. **Is there an auth wall?** Open the URL in a fresh chrome-devtools MCP tab (which uses the `Chrome-Claude` profile and shouldn't have user sessions). If it redirects to login, the user will need to either (a) log in once via the MCP browser so we can capture the session, or (b) provide credentials the script can use to log in programmatically.
4. **Cloudflare / hCaptcha / Akamai / PerimeterX?** Check console messages and the response HTML for the usual fingerprints. If present, flag to the user before continuing — these can multiply the effort required by 10x and sometimes can't be solved without paid services. Don't burn an hour discovering this in Phase 2.
5. **Rate limits / per-session quotas?** Ask the user what they know. Most sites have caps; better to know up front than discover by ban.
6. **Legal / ToS stance.** Make the user explicitly aware that scraping may violate ToS. If the target is a service they pay for and the data is their own, usually fine. Public data is usually fine. Other people's locked-down data is not. Ask before proceeding if it's not clearly the first case.
7. **What does "done" look like?** One specific worked example: "given URL X, I want fields {name, price, posted_at} in Firestore at `listings/{id}`." Vague goals doom long sessions.

**On cookies / session capture (if auth is needed):** The intended pattern for this template is to **store session cookies in Firestore**, in a pre-defined location handled by template-supplied helpers (analogous to how `consent` is handled — the user shouldn't have to design the storage shape themselves). **The exact Firestore location and helper API for cookies aren't pinned down yet** — flag this to the user when you hit it, don't invent your own scheme. For research / Phase 1 only, capturing cookies into a local gitignored file is acceptable as a stopgap.

**Gate:** show the user the filled-in `scrape-plan.md`. Confirm path (API call / static HTML / headed browser / stealth headed browser). Confirm the "done" definition. Do not proceed without confirmation.

### Phase 1 — Spike on one page (one extraction, end-to-end manual)

**Goal:** prove you can load *one* page and extract the target data, run by hand. No batching, no schedule, no database write. Just *one* successful extraction visible to the user.

Implementation by path (decided in Phase 0):

- **API mode:** plain `fetch` with the right headers / cookies. Print the JSON. Done.
- **Static HTML mode:** plain `fetch` + a simple HTML parser. Print extracted fields. Done.
- **Browser mode (no anti-bot):** headed browser, navigate, extract via DOM evaluation. Print fields. Done.
- **Stealth mode (anti-bot detected):** headed browser with stealth patches and human-like timing/cursor (see "Concepts" below). Print fields. Done.

**Run the script with the browser visible** during the spike. You need to *see* the page to debug DOM extraction. Cloud-headless comes much later.

**Save raw artifacts on every run during the spike:**
- A screenshot
- The rendered HTML
- Console output of what was extracted

These are how you debug when extraction breaks. Show them to the user at the gate — a screenshot of the loaded page next to the extracted data is the single best "is this what you wanted?" check.

**Gate:** show the user the screenshot + the extracted data. Confirm the data is correct *and complete*. Update `scrape-plan.md` with the working selectors and the extraction snippet. Do not proceed without confirmation.

### Phase 2 — Robustness on one page (handle the edge cases)

**Goal:** the same single-page extraction, but resilient. Add only what is needed to keep it working under realistic conditions.

In rough priority order:
1. **Wait for the right thing**, not a fixed timeout. Wait for the *data you want* to appear (a selector, an xpath, a `waitForFunction` predicate). Fixed `wait(5000)` is a debt you accumulate; replace with selectors as soon as you can.
2. **Detect "page didn't load right"** explicitly — 404, redirected-to-login, anti-bot challenge. Return a typed soft-fail (e.g., `return false`) rather than letting extraction silently produce nulls. After navigation, the *expected* element must be present, else bail.
3. **Add jitter on every fixed delay.** Bots have constant timing; humans don't. A small randomisation on every wait/coord is cheap insurance even if you don't think the target is bot-detecting.
4. **Mouse + scroll movement before interactions** if the site is sensitive. Cursor moves to a couple of random points, scroll down a bit and back, *then* interact. Bezier-curve cursor movement (not linear) is what matters.
5. **Re-run the spike 5 times in a row.** Same URL, fresh session. Does it work every time? Flaky tests on one URL = guaranteed broken on a batch.

**Don't:** add retry loops yet. Don't add proxy rotation yet. Don't add ban-detection yet. Those belong to Phase 3 if at all — most personal-automation scrapes never need them.

**Gate:** show the user a clean log of 5 consecutive successful runs. Update `scrape-plan.md`. Confirm before scaling up.

### Phase 3 — Production (batch, schedule, store)

**Goal:** wire the working single-page scrape into the template's stack — schedule it, store the results, surface them to the end user.

This is where you stop being scrape-specific and start using the rest of the project conventions:
- **Storage:** Firestore, typed via `functions/src/types/` (see `docs/CLAUDE-STACK.md`).
- **Schedule:** scheduled Cloud Function. One short run per scheduled tick — not a long-running browser.
- **Auth secret for inbound triggers** (if any): see `docs/CLAUDE-API.md`.
- **Session cookies:** the template-supplied Firestore pattern (TBD; see Phase 0 note).

Phase 3 is *out of scope for this blueprint as research material* — the production wiring for headless-browser deploys on this template's stack still needs to be settled.

**Gate before deploying:** the user explicitly asks for deploy. Do not deploy on your own (per project CLAUDE.md).

---

## Concepts (when stealth is needed)

The library choices for this template aren't finalised; these are the *capabilities* you need, however they're implemented:

- **Stealth patches.** Hide the dozen-ish fingerprint signals (`navigator.webdriver`, plugins list, languages, chrome runtime details, etc.) that bot-detectors check.
- **Human-like cursor.** Bezier-curve mouse paths instead of teleporting. Combined with jittered timing, this defeats most timing-based bot detection.
- **Jittered timing.** A small randomisation on every delay and coordinate. Cheap, ubiquitous.
- **Session cookies persisted somewhere.** For this template that target is Firestore (pattern TBD).

When extraction is brittle because the DOM changes weekly, **LLM-driven schema extraction** is an option — an LLM call per page that takes HTML and a target schema and returns the data. Use this only when deterministic DOM extraction has proven flaky and the data shape is small enough that an LLM call per page is affordable. For most structured pages, deterministic DOM extraction is more reliable and free.

---

## Anti-patterns (the common LLM mistakes when scraping)

1. **Don't extract from hidden elements.** Many SPAs render multiple copies of an element and hide all but one with CSS. Naive `querySelector` grabs the first, which is often the hidden one. The fix: filter by `getBoundingClientRect().width > 0` and `children.length === 0` ("visible leaves only").
2. **Don't rely on long CSS selectors with brittle minified class names.** SPAs ship new minified classes weekly. Anchor on:
   - Semantic landmarks (`main`, `section`, `dialog`, `aria-label`)
   - Heading text (`h2.textContent === 'Experience'`)
   - Stable URL-based attributes (`a[href*="/company/"]`)
   - …then walk from there.
3. **Don't `wait(5000)` and hope.** Wait for the data you want, not for clock time. Fixed waits are bug magnets when the site is slow.
4. **Don't run the browser headless during development.** You can't debug what you can't see. Cloud-headless is a Phase 3 concern.
5. **Don't throw on the first per-target failure.** Network blip on one URL shouldn't kill a 100-URL batch. *Do* throw on systemic failures (login broken, selector vanished entirely) — those need a human. Use the pattern: soft-fail = `return false`, hard-fail = `throw`.
6. **Don't commit cookies to git.** Site session cookies are credentials. Store in the template's Firestore cookies pattern (TBD); never in source.
7. **Don't skip the human-like warm-up if the site is sensitive.** A few cursor moves and a scroll before clicking is cheap and meaningfully reduces detection.

---

## Quick decision tree (for the LLM running a fresh session)

```
User asks for "scrape X"
         │
         ▼
Does X have a documented API?     ── yes ──▶ STOP. Propose API instead. Confirm with user.
         │ no
         ▼
Is the data in the server HTML?   ── yes ──▶ Use fetch + HTML parser. Skip Phase 0–2 browser work.
         │ no (JS-rendered)
         ▼
Any anti-bot signals?             ── yes ──▶ FLAG to user. Cost of solving may exceed value.
         │ no                                Decide together before continuing.
         ▼
Plain headed browser — but still apply the phases, gates, and patterns above.
```

---

## Open questions (for the template author, not for a fresh LLM session)

- **Firestore cookies pattern.** Pick a collection + helper API (analogous to `consent`) so the LLM doesn't have to invent storage. Until this lands, the LLM has to flag and pause.
- **Cloud-deploy path for headed/headless browsers.** Where does the scheduled scrape actually run? Firebase Functions has constraints (memory, chromium binary); Cloud Run may be the real answer. Settle this before Phase 3 has a target.
- **TOTP / 2FA secret storage** for sites that require it during login. Env var? Firestore? Secret Manager?
- **Trigger mechanism for this blueprint.** Two reliable options: (a) verb list in CLAUDE.md ("if user asks for scrape / watch page / pull data, read `blueprints/scrape-web-page/README.md` first") or (b) a `/scrape` slash command that explicitly loads this file. Slash command is more reliable; verb list is the fallback.
