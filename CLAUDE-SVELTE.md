# Svelte 5 — LLM Drift Guide

**Read this before writing any Svelte code.** Svelte 5 (released late 2024) introduced runes, which are newer than most LLM training cutoffs. Models habitually drift back to Svelte 4 patterns they've seen more of. This file exists to pin the Svelte 5 conventions we use.

**When in doubt:** Svelte 5 runes syntax, always. Svelte 4 syntax is not acceptable in this project even though it still compiles.

---

## Props — use `$props()`, not `export let`

```svelte
<!-- ❌ Svelte 4 -->
<script lang="ts">
  export let name: string
  export let count: number = 0
</script>

<!-- ✅ Svelte 5 -->
<script lang="ts">
  type Props = { name: string; count?: number }
  let { name, count = 0 }: Props = $props()
</script>
```

## Reactive state — use `$state`, not top-level `let`

```svelte
<!-- ❌ Svelte 4: top-level let was magically reactive -->
<script lang="ts">
  let count = 0
</script>

<!-- ✅ Svelte 5: explicit rune -->
<script lang="ts">
  let count = $state(0)
</script>
```

Mutations on `$state` arrays/objects work directly — no need to reassign:

```ts
let items = $state<string[]>([])
items.push('x')        // ✅ works — $state is a proxy
items[0] = 'y'         // ✅ works
// No need for: items = [...items, 'x']
```

## Derived values — use `$derived`, not `$:`

```svelte
<!-- ❌ Svelte 4 -->
<script>
  $: doubled = count * 2
  $: if (count > 10) console.log('big')
</script>

<!-- ✅ Svelte 5 -->
<script>
  let count = $state(0)
  let doubled = $derived(count * 2)
  $effect(() => {
    if (count > 10) console.log('big')
  })
</script>
```

**Rule:** `$:` is Svelte 4 only. Never use it. `$derived` for values, `$effect` for side-effects.

## Event handlers — attributes, not directives

```svelte
<!-- ❌ Svelte 4 -->
<button on:click={handle}>x</button>
<input on:input={handle} />

<!-- ✅ Svelte 5 -->
<button onclick={handle}>x</button>
<input oninput={handle} />
```

No colon. They're HTML attributes now.

## Component events — callback props, not `createEventDispatcher`

```svelte
<!-- ❌ Svelte 4 -->
<script>
  import { createEventDispatcher } from 'svelte'
  const dispatch = createEventDispatcher()
  function save() { dispatch('save', { id: 1 }) }
</script>

<!-- Parent: <Child on:save={(e) => ...}> -->

<!-- ✅ Svelte 5 -->
<script lang="ts">
  let { onsave }: { onsave: (id: number) => void } = $props()
  function save() { onsave(1) }
</script>

<!-- Parent: <Child {onsave} /> -->
```

`createEventDispatcher` is deprecated. Component "events" are just callback props.

## Two-way binding — use `$bindable()`

```svelte
<!-- Child -->
<script lang="ts">
  let { value = $bindable() }: { value: string } = $props()
</script>
<input bind:value />

<!-- Parent -->
<Child bind:value={text} />
```

## Runes outside components — `.svelte.ts` extension

Runes don't work in plain `.ts` files. They require the `.svelte.ts` extension so the compiler transforms them:

```
src/lib/state/CategoriesStore.svelte.ts    ← ✅ runes work here
src/lib/state/categoriesStore.ts           ← ❌ runes will error
```

Services and utils that *don't* use runes stay as plain `.ts`.

**`$effect` at module top-level does NOT work** — even inside `.svelte.ts`. Effects must run inside a component lifecycle or inside `$effect.root()`. For a singleton store that needs long-lived subscriptions (like Firestore `onSnapshot`):

```ts
// ✅ Expose start()/stop(); call them from the root +layout.svelte
class OwnersStore {
  items = $state<Owner[]>([])
  private unsub: (() => void) | null = null
  start = async () => {
    const { db } = await getFirebaseServices()
    this.unsub = onSnapshot(collection(db, 'owners'), (snap) => {
      this.items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Owner)
    })
  }
  stop = () => { this.unsub?.(); this.unsub = null }
}
```

```svelte
<!-- +layout.svelte -->
<script lang="ts">
  import { ownersStore } from '$lib/state/OwnersStore.svelte'
  $effect(() => {
    ownersStore.start()
    return () => ownersStore.stop()
  })
</script>
```

Alternative: `$effect.root(fn)` creates an unscoped effect and returns a `destroy()` function. Prefer the `start()`/`stop()` pattern — simpler, piggybacks on component cleanup.

## Class-based rune stores — gotchas

- **`this` binding**: method references lose `this`. Passing `onclick={store.reset}` makes `this === <button>`. Use **arrow-function fields** (`reset = () => {...}`) or wrap inline (`onclick={() => store.reset()}`). Arrow-field is the convention here.
- **Empty-array inference**: `foo = $state([])` infers `never[]`. Use explicit generic: `foo = $state<Owner[]>([])`.
- **Class instances inside `$state` are not further proxied**. Prefer plain objects/arrays inside state; use classes for the store itself and for behaviour, not for data rows.
- **`$state.raw`** disables the deep proxy — useful when you only ever reassign the whole value (e.g. swapping a full Firestore snapshot result): `rows = $state.raw<Owner[]>([])` then `this.rows = snap.docs.map(...)`.
- **Destructuring breaks reactivity**: `const { items } = store` snapshots the value. Keep reads on the store (`store.items`).
- **You cannot `export let x = $state(0)` and reassign across modules.** Export a singleton instance of a class and mutate its fields instead.

## Reactive Maps / Sets / Dates / URLs

Native `Map`, `Set`, `Date`, `URL` are not reactive in `$state`. Import from `svelte/reactivity`:

```ts
import { SvelteMap, SvelteSet, SvelteDate, SvelteURL } from 'svelte/reactivity'

class CategoriesStore {
  byId = new SvelteMap<string, Category>()
}
```

## SvelteKit: use `$app/state`, not `$app/stores`

`$app/stores` is **deprecated**. Use `$app/state` (SvelteKit 2.12+):

```svelte
<!-- ❌ -->
<script>
  import { page } from '$app/stores'
  $: id = $page.params.id
</script>

<!-- ✅ -->
<script>
  import { page } from '$app/state'
  let id = $derived(page.params.id)
</script>
```

`$app/state` values are only reactive via runes — a `$:` reactive statement won't track them.

## Snippets, not slots (mostly)

Svelte 5 added `{#snippet}` / `{@render}` which replace most uses of slots. Slots still work, but snippets are more flexible (typed, can take arguments, can be passed as props).

```svelte
<!-- Defining a snippet -->
{#snippet row(item: Item)}
  <tr><td>{item.name}</td></tr>
{/snippet}

<!-- Rendering it -->
{@render row(items[0])}

<!-- Passing as a prop (replaces named slots) -->
<Table {rows}>
  {#snippet cell(item)}
    <span>{item.value}</span>
  {/snippet}
</Table>
```

For default slot content, `{@render children?.()}` where `children` is destructured from `$props()`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte'
  let { children }: { children: Snippet } = $props()
</script>

<div class="card">
  {@render children()}
</div>
```

## Stores (`writable` / `readable`) — avoid for new code

Svelte 4 stores (`writable`, `readable`, `derived` from `svelte/store`, `$store` auto-subscription) still work and aren't formally deprecated — the docs say their use cases have "greatly diminished". They remain useful for RxJS/async-stream interop but are not our pattern for new state. Use **class-based rune stores** instead (see CLAUDE-STACK.md § State pattern). Only touch `svelte/store` if integrating with a library that returns one.

## Quick drift checklist

When reviewing LLM-generated Svelte code, scan for these red flags — any one is a Svelte 4 regression:

- [ ] `export let` in a `.svelte` file → should be `$props()`
- [ ] `$:` reactive statement → should be `$derived` or `$effect`
- [ ] `on:click` (or any `on:event`) → should be `onclick`
- [ ] `createEventDispatcher` → should be callback props
- [ ] `writable()` / `readable()` for new state → should be a rune store class
- [ ] Runes in a plain `.ts` file → rename to `.svelte.ts`
- [ ] Top-level `let count = 0` used reactively → should be `let count = $state(0)`
- [ ] `<slot />` in new components → prefer `{@render children()}` or named snippets
- [ ] `$app/stores` imports → should be `$app/state`
- [ ] `new Map()` / `new Set()` inside `$state` → should be `SvelteMap` / `SvelteSet` from `svelte/reactivity`
- [ ] `$effect(...)` at module top-level of a `.svelte.ts` → won't run; move into a `start()` method called from root layout's `$effect`
- [ ] `onclick={store.method}` (bare method ref) → arrow-function field or wrap inline to preserve `this`
