<script lang="ts">
  import '../app.css';
  import type { Snippet } from 'svelte';
  import { authStore } from '$lib/state/AuthStore.svelte';

  let { children }: { children: Snippet } = $props();

  $effect(() => {
    authStore.start();
    return () => authStore.stop();
  });
</script>

{@render children()}
