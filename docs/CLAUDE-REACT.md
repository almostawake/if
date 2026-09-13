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
- Design tokens live in the `@theme { }` block in `src/app.css`. A token named `--color-fg` is what generates `text-fg`, `bg-fg`, `border-fg`.
- Project-wide classes (`.tx-input`, `.tx-btn`, `.tx-btn-ghost`) live in `@layer components` in the same file. Reuse them rather than restyling a button inline.
- `className`, not `class`. Conditional classes are ordinary template strings.

## Imports and aliases

- `@/…` → `client/src/…` (e.g. `@/state/authStore`).
- `@common/…` → `functions/src/common/…` — the zod schemas shared with Cloud Functions. Browser-safe only; never import `firebase-admin` through it.
- Both are declared twice, in `vite.config.ts` (for the bundler) and `tsconfig.json` (for the type checker). Adding an alias means editing both.

## The `check` gate

`npm run check` = `tsc --noEmit && eslint .`, and it must pass before any code task is done. ESLint runs the full `eslint-plugin-react-hooks` recommended set, which includes the React Compiler rules (purity, immutability, `set-state-in-effect`, and friends). Those flag real bugs. Fix the code rather than switching a rule off; if a rule genuinely does not fit this project, disable it in `eslint.config.js` with a comment saying why.

`npm run format` (Prettier, with Tailwind class sorting) on files you touched.
