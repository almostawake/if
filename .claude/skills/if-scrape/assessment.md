# Blueprint: scrape-web-page — Assessment

**Scope: assessment only.** This decides *what we're going to do* — it does not build anything. When the assessment is done you present a verdict and a short plan, then **stop**. Build guidance comes later.

## Your job

The user wants to scrape a website. You've been given a URL (in the command arguments — if none was given, ask for one). Then:

1. Open the site in a real browser and inspect it.
2. Work through the assessment below.
3. Land on one **implementation type** (the "rungs" at the end).
4. Write a short plan to `scrape-plan.md` in the project root, and present the verdict to the user.
5. **Stop.** Do not write scraping code. This phase is assessment only.

The user is a non-developer. Explain the verdict in plain terms: what you found, which approach it implies, how hard it will be, and anything that could make it impractical. Keep jargon minimal and offer to expand.

## How to observe the site

Use the **chrome-devtools MCP** (pre-registered — no setup needed). Open a **new tab with `background: true`**. Never bring it to front, never resize.

Tools you'll lean on:
- `navigate_page` — load the URL
- `list_network_requests` — find the document response (for headers) and any JSON API calls
- `get_network_request` — inspect a specific request's headers / body / response
- `take_snapshot` — see the rendered DOM
- `evaluate_script` — check for `__NEXT_DATA__` and friends, pull `document.documentElement.outerHTML`, etc.
- `list_console_messages` — surface anti-bot / framework / CORS hints
- `take_screenshot` — capture what the page looks like (useful in the plan and for the user)

## Gate questions (check first — any can stop the job)

- **Legality / ToS.** Is this the user's own data on a service they use, or public data — or someone else's locked-down data? If the last, stop and discuss before going further.
- **Captcha on the data itself.** If hCaptcha / reCAPTCHA / Turnstile gates *every data request* (not just login), this is likely impractical for this template — flag it.
- **Run frequency.** Ask how often this needs to run. Hold the answer open — it becomes a practicality check once you know whether login is needed and how long a session lasts.

## Branch A — getting past the door

**A1. Anti-bot posture.** Navigate to the URL. Inspect the document response headers, the HTML, and the console.
- Nothing, or *passive* Cloudflare (a `__cf_bm` cookie is set but the page loads normally, no challenge screen) → door is open. Continue.
- *Active* challenge — an interstitial ("Checking your browser…", "Verify you are human"), a `cf-mitigated` header, `__cf_chl` in the HTML, or Akamai / PerimeterX (`_px*`) markers → this is **Rung 8** territory and it dominates everything else. Finish the assessment, but the verdict is heading toward "hard, possibly not worth it."

**A2. Login required?** Look at what loaded. Is the target data visible, or is there a login wall / redirect to sign-in?
- Data visible, no login → skip to Branch D.
- Login wall → continue A3. (The MCP browser profile may happen to be logged in already — if so, still reason about what a logged-out visitor would see.)

**A3. Can login be done without a browser?** Look at the login page, and if you can, the network request its form makes.
- A plain form POST that returns a token or session cookie, with no JS-computed challenge → login is automatable → **Rung 5** path.
- The login page runs JS to compute something, or is itself challenge-gated → login needs a browser → **Rung 4** path (session captured once, by hand).

**A4. 2FA?** Ask the user, and look at the login flow.
- None → best case for whichever auth rung you're on.
- TOTP (authenticator app) and the user can provide the seed → automatable, stays **Rung 5**.
- SMS / email OTP → login can't be fully automated → **Rung 4** (manual capture). Cross-check against run frequency: if a captured session lasts months, an occasional manual re-login is fine; if sessions die quickly, this is **impractical** — say so.
- Hardware key / push approval → manual only; practical only if sessions are very long-lived.

## Branch D — getting the data (once past the door)

**D1. Is the page calling a private JSON API?** In `list_network_requests`, look for same-origin requests that return the target data as JSON.
- Yes → that endpoint is the data source. Best case — it can be hit with `fetch` directly, skipping page rendering entirely.
- No → continue D2.

**D2. Is the data in the served HTML?** Compare the raw HTML (`evaluate_script` returning `outerHTML`, or the document response body) against the rendered page. Is the target data actually in the source?
- Yes → `fetch` + parse the HTML is enough.
- No → continue D3.

**D3. Is the hydration payload inlined?** Check for `__NEXT_DATA__`, `window.__NUXT__`, SvelteKit inline data, `page-data.json`.
- Yes → the data is sitting in the HTML as a JSON blob; `fetch` + extract it, no runtime browser needed.
- No → the DOM is genuinely built by JS at runtime → a **browser is needed at runtime (Rung 6)**.

## The implementation types (rungs)

- **Rung 3 — Direct fetch.** No login; data in the HTML, an inlined payload, or a reachable API. Plain `fetch` + parse. Easiest, most robust, cheapest to run.
- **Rung 4 — Stateful fetch, manual session capture.** Login needed but not browser-automatable (OTP etc.). Capture the session once via a browser, store it, replay data calls with `fetch`. Unattended *except* for occasional manual re-login.
- **Rung 5 — Stateful fetch, programmatic login.** Login is plain HTTP. Automate login + refresh, then `fetch`. Fully unattended.
- **Rung 6 — Plain headless browser.** JS-rendered site with no anti-bot. A browser runs at scrape time to render the page, then data is extracted from the DOM. Heavier and more fragile than fetch, but straightforward.
- **Rung 8 — Stealth browser.** Active anti-bot. A browser plus stealth patches and human-like behaviour, at runtime, every run. Hardest, most fragile, most likely to break or get blocked. Be honest with the user about whether the value justifies it.

## Synthesis — combine the two branches

| Door (Branch A) | Data (Branch D) | Verdict |
|---|---|---|
| Open | API / HTML / inlined JSON | **Rung 3** |
| Open | JS-rendered, no API | **Rung 6** |
| Login, manual capture | API / HTML / inlined JSON | **Rung 4** |
| Login, programmatic | API / HTML / inlined JSON | **Rung 5** |
| Login | JS-rendered, no API | **Rung 6** (browser does login + render) |
| Active anti-bot | anything | **Rung 8** (or: not worth it) |

## Output

Write `scrape-plan.md` in the project root with:
- **Target** — the URL.
- **Verdict** — the rung, named, in one line.
- **Why** — what you observed in Branches A and D that led there.
- **Plan sketch** — 3–6 rough bullets of what building it would involve. Rough, not detailed.
- **Blockers / unknowns** — anything you couldn't determine, anything that needs the user (credentials, a 2FA seed, ToS confirmation), anything that might make it impractical.

Then present the same verdict to the user in plain language and **stop**. Do not start building.
