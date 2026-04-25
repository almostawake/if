<script lang="ts">
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/state/AuthStore.svelte';

  $effect(() => {
    if (!authStore.loaded) return;
    goto(authStore.user ? '/users' : '/login', { replaceState: true });
  });
</script>

<div class="flex h-screen items-center justify-center">
  <span class="text-fg-faint">Loading…</span>
</div>
