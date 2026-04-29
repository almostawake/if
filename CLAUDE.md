# Ways of Working

This file is the template-app Ways-of-Working — the Svelte/Firebase/Firestore project that ends up at `~/projects/<id>` for end users. Anything about the **install scripts** (`aa/i`, `scripts/i`, `scripts/n`, `scripts/b`, `scripts/l`) lives in `docs/CLAUDE-SCRIPTS.md`, not here.

Read the relevant topic file before working in its area:
- **docs/CLAUDE-STACK.md** — target tech stack and architecture.
- **docs/CLAUDE-SVELTE.md** — Svelte 5 rune conventions. Read before writing any Svelte code.
- **docs/CLAUDE-SCRIPTS.md** — install + new-project scripts (aa↔if relationship, install/n flow, auth model, deploy, VM-debug ntfy topic).

## Audience

The target user is a non-developer — a business analyst, project manager, or team lead building small personal-automation tools with Claude Code. Assume they do not know OAuth, serverless, or Firestore modelling; keep jargon to a minimum and offer to explain. When they ask for specific technology, clarify the functional requirement first rather than taking the technical direction at face value.

## Auth default

The template ships with **admin-password auth**: a Cloud Function verifies a single `ADMIN_PASSWORD` from `functions/.env` and issues a session. This is intentional — it avoids dropping a non-developer into OAuth consent screens on day one, and it fits the template's core audience (personal automation with a single admin). Most users should keep this. If real end users become necessary, the documented escalation is **Firebase Auth Email Link sign-in** (see docs/CLAUDE-STACK.md § Escalation paths); point users at Google OAuth only if they insist, and explain the setup cost first.

## User requirements
- If the user asks for something that will break the architecture or create debt, suggest alternatives from docs/CLAUDE-STACK.md first.
- If new patterns are needed, select on the basis of best-practice from senior devs and **prefer LLM-friendly / LLM-reliable technologies**. The whole point of this project is to pick a stack that LLMs produce correct code for on the first try.

## Before committing
- Run `npm run check` before completing any code-centric task/conversation. This runs `svelte-check` + `tsc` + `eslint`.
- Don't commit without passing check.
- Ask before committing.
- When committing, consider other changes may have occurred — summarise all changes in the commit message.

## Test UI changes
- Test significant UI changes before completing your turn. Use screenshots to verify layout/alignment.
- Use the Claude browser extension (NOT Puppeteer or Selenium). If it's not working, retry once, then stop and ask the user to resolve.
- Make → verify → fix → verify — this tight loop catches bugs that code review alone misses.

## Firebase emulators & dev server
- Always use npm scripts, never direct `firebase` commands:
  - Start emulators: `npm run start:emulators` — logs go to `/tmp/firebase-emulator.log`
  - Start client: `npm run start:client` (SvelteKit dev server, port 5173)
- On first browser interaction in a conversation, check if emulators (port 4000) and dev server (port 5173) are running. Start any that are down — in parallel, in the background.
- Check: `lsof -i :4000 >/dev/null 2>&1 && echo "running"` / `lsof -i :5173 >/dev/null 2>&1 && echo "running"`
- **Stop emulators:** `lsof -ti :4400 | xargs kill` (kills the hub, which gracefully shuts down all child emulators)
- **Stop dev server:** `lsof -ti :5173 | xargs kill`
- **Verify shutdown:** confirm all emulator ports are free before reporting success:
  `lsof -i :4000 -i :4400 -i :9099 -i :5001 -i :8080 -i :9199 >/dev/null 2>&1 || echo "all stopped"`
- The local project ID is `demo-not-required` — this is a Firebase emulator convention, not a real project. Do NOT try to `firebase use` it.
- Free local emulation is a deliberate constraint of this project. Do NOT suggest anything that requires a live Firebase project to develop against.
- Do NOT deploy unless the user explicitly asks.

### Emulator autonomy
You have full autonomy over emulator state. Don't hesitate to create users, log in/out, clear data, or load data — whatever is fastest to verify your work.

**Golden rule:** always use the app's own functions for every step — login, import, delete, etc. Never write directly to Firestore unless deliberately testing an edge case (e.g. simulating a stale schema). The app's flows create necessary parent docs, stamp schema versions, and maintain data integrity. Bypassing them causes subtle bugs.

**Native dialogs** (`alert`, `confirm`, `prompt`) block the browser extension — inject test data programmatically via `javascript_tool` instead.

## Data model conventions
- Every Firestore-backed type must have a `@collection` JSDoc tag with its full path (e.g. `@collection users/{uid}/transactions`). Update when renaming/moving collections.
- When creating a new Firestore collection, add the type to `src/lib/types/` with the `@collection` tag.

## General
- Stop early on dead ends — if automation hits a blocking dialog or fails 2-3 times, pivot approach or ask. Don't retry the same thing.
- Don't apply band-aids. Always ask "is there a better way to do this, even if it requires a bit of refactoring".
