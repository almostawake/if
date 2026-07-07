<!--
  Public home page (/). Anonymous-browsable — no auth gate; the top bar
  shows "sign in" (top right) for visitors and the admin menu (top left)
  for signed-in whitelisted users. This is the starting point the user
  will replace with their first real feature.
-->
<script lang="ts">
  import AppHeader from '$lib/components/AppHeader.svelte';
</script>

<div class="flex min-h-screen flex-col">
  <AppHeader />
  <div class="flex flex-1 items-center justify-center px-6 text-fg-faint">
    ah, one day a home page here.
  </div>
</div>
