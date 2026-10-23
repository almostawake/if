# React — conventions and drift guide

**Read this before writing any client code.** React has more training data than any other framework, which is why this project uses it — but the corpus is twenty years deep, and most of it is out of date. This file pins the conventions we actually use, so the odds of first-shot-correct code stay high.

**When in doubt:** function components, hooks at the top level, effects only for syncing with something outside React.

---

## Components — function + named export, always

```tsx
// ❌ class components: never, in any form
class Thing extends React.Component { render() { return <div /> } }

// ❌ default export — makes the import name a guess
export default function Thing() {}

// ✅
type Props = { title: string; count?: number };

export function Thing({ title, count = 0 }: Props) {
  return <div>{title}</div>;
}
```

The one exception is `src/components/ErrorBoundary.tsx`: React has no hook for catching render errors, so that file is a class. Don't add a second.

Every module in `src/` uses **named exports**. No `export default` anywhere. It removes a whole class of "was that a default or a named import" mistakes, and it makes a symbol greppable by its real name.

No `PropTypes` — TypeScript is the prop contract.

No `React.FC`. Type the props object directly, as above.

## Hooks — top level only

`react-hooks/rules-of-hooks` runs as an **error** in `npm run check`, so this fails the build rather than misbehaving at runtime:

```tsx
// ❌ hook after an early return, or inside a condition/loop
if (!user) return null;
const [x, setX] = useState(0);

// ✅ every hook runs on every render; branch AFTER them
const [x, setX] = useState(0);
if (!user) return null;
```

## Effects — for syncing with the outside world, nothing else

`useEffect` is for reaching outside React: subscriptions, timers, imperative DOM, navigation. It is **not** for computing values.

```tsx
// ❌ derived state in an effect — an extra render and a stale window
const [full, setFull] = useState('');
useEffect(() => { setFull(`${first} ${last}`); }, [first, last]);

// ✅ just compute it during render
const full = `${first} ${last}`;
```

`react-hooks/exhaustive-deps` is an **error** here too. Fill the dependency array honestly; if that causes a loop, the fix is to restructure (move the value into the effect, or read it from a store's `getState()`), never to lie about the deps.

Subscriptions return their teardown:

```tsx
useEffect(() => {
  const { start, stop } = useUsersStore.getState();
  start();
  return stop;
}, [isAdmin]);
```

**StrictMode is on** (`main.tsx`). In development every effect mounts, unmounts and mounts again, on purpose. Anything that starts something must be safe to call twice — see `start()` in `usersStore.ts`, which no-ops if a listener already exists.

## Refs — React 19 passes `ref` as a normal prop

```tsx
// ❌ forwardRef — unnecessary since React 19
const Input = forwardRef((props, ref) => <input ref={ref} {...props} />);

// ✅
function Input({ ref, ...props }: { ref?: React.Ref<HTMLInputElement> }) {
  return <input ref={ref} {...props} />;
}
```

Use a ref for focus and measurement, never to hold render-visible state.

## State — Zustand stores in `src/state/`

One store per domain, created with `create()`, exported as `useXStore`. State, actions and the plumbing live in one file.

```ts
// src/state/categoriesStore.ts
import { create } from 'zustand';

type CategoriesState = {
  items: Category[];
  add: (name: string) => Promise<void>;
};

export const useCategoriesStore = create<CategoriesState>(() => ({
  items: [],
  add: async (name) => {
    // ...write to Firestore...
    useCategoriesStore.setState((s) => ({ items: [...s.items, created] }));
  },
}));
```

Read in a component **one field per selector** — that way a change to some other field doesn't re-render you:

```tsx
// ❌ selecting an object literal returns a new reference every render
const { items, add } = useCategoriesStore((s) => ({ items: s.items, add: s.add }));

// ✅
const items = useCategoriesStore((s) => s.items);
const add = useCategoriesStore((s) => s.add);
```

Outside a component (inside an effect, a callback, another store) read the store imperatively — no hook, no subscription:

```ts
useUsersStore.getState().recordSignIn(user);
```

**Store state does not survive a route change after a deploy.** `src/version.ts` reloads the page at the next navigation once a newer build is live. Firestore-backed state simply re-subscribes; a long-lived draft held only in a store would be lost — persist it to `sessionStorage` (or Firestore) if it must outlive navigation.

**`src/state/` is the only place that mutates domain state.** Components go through a store; stores go through `src/services/`; services never import stores. Single source of truth, easy to grep.

## Routing — React Router v7, declarative mode

`src/router.tsx` holds the whole URL map, and **it is the auth gate**: routes nested under `AppLayout` are signed-in only, routes at the top level are public. Add a page to `AppLayout`'s `children` and it is gated for free.

- Both `react-router` and `react-router-dom` are installed and resolve to the same v7 copy, so either import path works. Don't add v8 — it drops `react-router-dom`, and two majors in one tree means two Router contexts and a `useNavigate() may be used only in the context of a <Router>` crash.
- Navigate between pages with `<Link to="/users">`, never `<a href>` — an anchor triggers a full page reload and throws away the signed-in session state.
- Navigate from code with `useNavigate()`. `navigate('/x', { replace: true })` is the equivalent of the old `goto(..., { replaceState: true })`.
- Read the query string with `useSearchParams()`.
- We do **not** use loaders, actions, or framework mode. Data comes from Firestore through the stores.

## Styling — Tailwind v4

- There is **no `tailwind.config.js`**, and there must not be. v4 is configured in CSS.
- The entry is `@import 'tailwindcss'` at the top of `src/app.css` — not the v3 `@tailwind base/components/utilities` triple.
- Design tokens live in the `@theme { }` block in `src/app.css` and are the only source of colour, size and face. A token named `--color-fg` is what generates `text-fg`, `bg-fg`, `border-fg`; `--text-small` generates `text-small` (size and line height together); `--spacing-gutter` generates `pl-gutter`. **Never a hex colour or a px font size in a component** — add a token.
- Text is one of three presets: body (the default, nothing to add), `text-small`, or `.section-label` (small, faint, medium — for a field label or a group heading). Bold is `font-semibold`, not `font-bold`.
- Shared controls are components, not classes: `Button` (solid / ghost), `Input`, `SearchInput`, `InlineInput`, `Spinner`, `Marked` in `src/components/`. Use them rather than restyling an `<input>` or `<button>` inline; extend them rather than adding a parallel one.
- `className`, not `class`. Conditional classes are ordinary template strings.
- Light only, lowercase everywhere (no `uppercase`, no capitalised labels), no icons libraries — glyphs are text (×, +, ‹, ›).

## Design — what a screen looks like

### Page chrome — the top bar names the screen, the page is just the content

`AppLayout` renders `AppHeader` above every page. A page is its content and nothing else.

- **No on-page heading, no description/subtitle.** The screen's name is its label in `SCREENS` (`AppHeader.tsx`), shown beside the hamburger, and nowhere else. Never write a sentence explaining what a page is or how to use it.
- **No counts, summaries or status captions** ("82 products", "3 results", "last updated…") unless the owner asked for that specific one.
- **What may sit above the content:** a control the owner asked for ("show deleted"), and a line that only appears when something is wrong (a save error). If there is nothing to say, render nothing — no empty toolbar.
- The bar has two slots a page can fill from anywhere in its tree: `<HeaderControl>` (the screen's main control, two thirds of the way across, 32px wide) and `<HeaderRight>` (an indicator, far right, 44px square). They stay put screen to screen; don't put a control anywhere else in the bar.
- The menu is one list, the same on every screen, the current one highlighted; picking it goes to that screen's top level. "sign out" under the screens; who is signed in and the version, greyed, at the bottom.
- **Adding a screen:** a page in `src/pages/`, a route in `AppLayout`'s `children` (`router.tsx`), an entry in `SCREENS`. Nothing else.
- Page content starts at the gutter (`<main>` applies `pl-gutter`); pages add no horizontal padding of their own. `<main>` is the scroller and remembers its place per route (`useKeptScroll`); a page that scrolls inside its own element spreads `useKeptScroll(key)` onto that element instead.
- When unsure whether a label earns its place: leave it out and mention it in your reply.

### Row lists — tabular data reads as columns, without a table

Any list where each row carries the same few values — a name and some figures, times and a count — is laid out as **columns that hold still down the page**, never as free-flowing text per row, and never as a bordered grid (a grid is for data edited in place).

- **One line per row.** The identifying text (a name) first, taking whatever width is left (`flex-1 truncate`); the values after it, each in its own column of fixed width.
- **Columns are fixed widths in characters** — the font is monospace, so a column is `n ch` wide (`w-[8ch]`), sized to the widest value the column will hold that day ("30/09/26" = 8, a four-digit count = 4 or 5).
- **Numbers are right-stopped** (`text-right`), with **commas in the thousands** (39,504 — `toLocaleString('en-AU')`). **No data is a dash** (–), faint, in the column where the figure would be — never a blank, never a zero. Dates and other fixed-length tokens are **centred** in their column. Text is left.
- **Group headings** are a full-width band in `bg-bg-soft` with the name as `.section-label`, and a gap (~18px) between one group's last row and the next heading. No count in the heading.
- **Secondary values are faint** (`text-fg-faint`): a date, the figure that qualifies it; the value the row is about is `text-fg`, `font-medium` if it needs to carry the line. Red (`text-err`) only where something is wrong.
- **A count of things** goes in square brackets, `[13]`, right-stopped in its column.
- **No header row, no captions, no dividers between rows** — the columns and the air between them do the work. Rows are clickable as a whole (`hover:bg-bg-hover`); a button at the row's end sits outside the clickable part — a button inside a button is invalid HTML.
- Don't hide an affordance behind hover alone (a touch screen has no hover): the × and the + are always visible, faint.

### Grids — column headings wrap and sit on the bottom

A column is only as wide as its **values** need; the heading is never what sets the width.

- **Headings wrap** onto as many lines as they need — no `truncate`, no widening the column to keep a heading on one line. Abbreviate a long heading the way the owner would say it ("units per pkg").
- **Headings are bottom-aligned** in the heading row (`items-end`), so a one-line heading and a three-line heading share a baseline above their values.
- Values keep one line and scroll inside their cell.

### Waiting — anything that can take time shows it, and is got ready ahead where it can be

Applies to anything that goes off to the server after a click — a call, a file to fetch, an upload, an export.

- **A click is answered at once, at the click**: the thing clicked changes state immediately (the row takes its tint), before the result is in. Never a click that looks like nothing happened.
- **A wait that can pass ~300 ms shows a `Spinner`**, in the control that will show the result (the bar's control becomes the spinner, then the result). No "loading…" words, no full-screen overlay, no skeletons. Show it even when the wait is usually short.
- **The store owns the flag** (`loading` beside the data it is waiting on), set at the click and cleared on the first sign of the real thing, on failure, and on cancel — every exit, or the spinner sticks.
- **A wait can be given up**: clicking the spinner cancels; a late answer to a cancelled or superseded ask is dropped.
- **Get it ready ahead**: when a screen shows things the reader will probably click, fetch what the click needs in the background as the screen shows them — quietly, one at a time, failures left for the click to report.
- A failed wait ends as the screen's one red line (§ Page chrome), not a stuck spinner.

### Search

`SearchInput` for the box (× to clear, Esc clears); `searchTerms` / `matchesAll` in `src/utils/search.ts` for the rule (every typed word has to appear, any order, case ignored); `Marked` to show the words found on a yellow ground.

### Drift checklist

- [ ] an `<h1>`, a description line, or an unrequested count on a page → the bar names the screen; delete it
- [ ] a hex colour or px font size in a component → a token in `app.css`
- [ ] `uppercase`, a capitalised label, `font-bold` → lowercase, `font-semibold`
- [ ] an inline-styled `<button>` / `<input>` → `Button` / `Input`
- [ ] a click that goes to the server with nothing on screen changing until it answers → § Waiting
- [ ] a list of same-shaped rows as prose, or as a bordered table → § Row lists
- [ ] a page with its own left padding → it inherits the gutter

## Imports and aliases

- `@/…` → `client/src/…` (e.g. `@/state/authStore`).
- `@common/…` → `functions/src/common/…` — the zod schemas shared with Cloud Functions. Browser-safe only; never import `firebase-admin` through it.
- Both are declared twice, in `vite.config.ts` (for the bundler) and `tsconfig.json` (for the type checker). Adding an alias means editing both.

## The `check` gate

`npm run check` = `tsc --noEmit && eslint .`, and it must pass before any code task is done. ESLint runs the full `eslint-plugin-react-hooks` recommended set, which includes the React Compiler rules (purity, immutability, `set-state-in-effect`, and friends). Those flag real bugs. Fix the code rather than switching a rule off; if a rule genuinely does not fit this project, disable it in `eslint.config.js` with a comment saying why.

`npm run format` (Prettier, with Tailwind class sorting) on files you touched.
