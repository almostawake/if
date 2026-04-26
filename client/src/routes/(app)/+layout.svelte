<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { Snippet } from 'svelte';
  import { authStore } from '$lib/state/AuthStore.svelte';
  import { allowedEmailsStore } from '$lib/state/AllowedEmailsStore.svelte';

  let { children }: { children: Snippet } = $props();
  let menuOpen = $state(false);

  // Auth gate. Three states:
  //   no user           → /login
  //   user, not allowed → sign out, /login?denied=1
  //   user, allowed     → render the page
  // We wait for `loaded` (auth observer + whitelist check both done) to
  // avoid a redirect flicker on refresh.
  $effect(() => {
    if (!authStore.loaded) return;
    if (!authStore.user) {
      goto('/login', { replaceState: true });
    } else if (authStore.whitelisted === false) {
      authStore.signOut().then(() => goto('/login?denied=1', { replaceState: true }));
    }
  });

  // Long-lived Firestore subscription tied to this layout's lifecycle.
  // Only start once the user is known to be whitelisted — otherwise the
  // onSnapshot would hit a permission-denied error.
  $effect(() => {
    if (authStore.whitelisted !== true) return;
    allowedEmailsStore.start();
    return () => allowedEmailsStore.stop();
  });

  const navItems = [
    { href: '/', label: 'home' },
    { href: '/users', label: 'manage users' }
  ];

  function toggleMenu() {
    menuOpen = !menuOpen;
  }

  function closeMenu() {
    menuOpen = false;
  }

  async function handleSignOut() {
    closeMenu();
    await authStore.signOut();
    await goto('/login', { replaceState: true });
  }
</script>

<svelte:window onclick={(e) => {
  const target = e.target as HTMLElement;
  if (!target.closest('[data-menu-root]')) closeMenu();
}} />

<div class="flex min-h-screen flex-col">
  <header class="flex h-16 items-center border-b border-border bg-bg-soft px-3">
    <div data-menu-root class="relative">
      <button
        class="flex h-14 w-14 items-center justify-center rounded hover:bg-bg-hover"
        onclick={toggleMenu}
        aria-label="Menu"
        aria-expanded={menuOpen}
      >
        <span aria-hidden="true" class="text-3xl leading-none">≡</span>
      </button>
      {#if menuOpen}
        <nav
          class="absolute left-0 top-full mt-1 min-w-[180px] border border-border bg-white shadow-sm"
        >
          <ul>
            {#each navItems as item (item.href)}
              {@const active = page.url.pathname === item.href}
              <li>
                <a
                  href={item.href}
                  onclick={closeMenu}
                  class="block px-3 py-2 hover:bg-bg-hover"
                  class:active
                >
                  {item.label}
                </a>
              </li>
            {/each}
            <li class="border-t border-border">
              <button
                type="button"
                class="block w-full px-3 py-2 text-left hover:bg-bg-hover"
                onclick={handleSignOut}
              >
                sign out
              </button>
            </li>
          </ul>
        </nav>
      {/if}
    </div>
    <div class="ml-auto text-[15px] text-fg-faint">
      {authStore.user?.email ?? ''}
    </div>
  </header>

  <!--
    Page-content gutter: pl uses --page-gutter (= the menu icon's visible
    left edge, defined in app.css) so every page in this group aligns
    with the menu icon. New pages should not add their own horizontal
    padding — they inherit this.

    `flex flex-col` makes <main> a flex column so a page can opt into
    filling the remaining height (e.g. home's centred placeholder uses
    `flex-1`); pages that just stack content at the top need no extra
    classes.
  -->
  <main class="flex flex-1 flex-col overflow-auto py-4 pr-3 pl-[var(--page-gutter)]">
    {@render children()}
  </main>
</div>

<style>
  .active {
    color: var(--color-accent);
  }
</style>
