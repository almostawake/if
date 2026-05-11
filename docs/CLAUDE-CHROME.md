# Browser conventions

Read before opening, driving, or screenshotting the app — or any other page — through chrome-devtools.

## Tool selection
- **chrome-devtools MCP only.** No Puppeteer, no Selenium, no `claude-in-chrome` extension. The project registers `chrome-devtools` in `.mcp.json` at repo root.
- **WebFetch** is fine only for stateless public docs/API lookups. Never use it for our own app, anything that needs the user's session, or sites we scrape.

## Tabs
- `new_page` with `background: true`. Never `bringToFront`. Never resize. Avoid `lighthouse_audit`, `performance_*`, `emulate`, `resize_page`.
- New tab per task. Reuse an existing tab only when the user identifies one to use.
- "Open the app" defaults to the local dev server (`http://localhost:5173`).

## Marking tabs (so the user sees who owns what)
Mark every tab you touch as the **first** action on that tab, before any work or further navigation. Marking late is a known LLM failure mode — don't fall into it.

- Get this session's emoji from `.claude/util-my-color.mjs` (run via Bash).
- Set `document.title` to `<emoji> <existing-title>`, stripping any existing pool-emoji prefix (this is also how you take over another session's tab):
  ```js
  // run via evaluate_script; replace E with this session's emoji
  const POOL = ['🟦','🟩','🟧','🟪','🟥','🟨'], E = '🟦';
  document.title = E + ' ' + document.title.replace(new RegExp('^(' + POOL.join('|') + ')\\s*'), '');
  ```
- Marker is page state and is lost on full-page navigation. After any `navigate_page` you call, re-mark. For tabs you'll navigate often, pass the marking JS as `navigate_page`'s `initScript` so it re-applies on each new document automatically.

## After UI changes
Open and verify in the browser. Don't assume. Screenshots for layout/alignment-sensitive work.
