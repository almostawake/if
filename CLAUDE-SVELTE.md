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

Svelte 4 stores (`writable`, `readable`, `derived` from `svelte/store`, `$store` auto-subscription) still work but are not our pattern. Use **class-based rune stores** instead (see CLAUDE-STACK.md § State pattern). Only touch `svelte/store` if integrating with a library that returns one.

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
