<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { authStore } from '$lib/state/AuthStore.svelte';
  import { AuthService } from '$lib/services/AuthService';

  let email = $state('');
  let sending = $state(false);
  let sent = $state(false);
  let error = $state<string | null>(null);
  let denied = $derived(page.url.searchParams.get('denied') === '1');

  $effect(() => {
    if (authStore.loaded && authStore.user && authStore.whitelisted === true) {
      goto('/users', { replaceState: true });
    }
  });

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (sending) return;
    sending = true;
    error = null;
    try {
      await AuthService.sendLink(email.trim());
      sent = true;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      sending = false;
    }
  }
</script>

<div class="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
  {#if !sent}
    <form onsubmit={submit} class="space-y-3">
      {#if denied}
        <div class="text-err">
          That email isn't on the access list. Ask someone who's already in to add you.
        </div>
      {/if}
      <label for="email" class="section-label block">Email</label>
      <div class="flex items-center gap-2">
        <input
          id="email"
          class="tx-input w-72"
          type="email"
          autocomplete="email"
          required
          bind:value={email}
          placeholder="you@example.com"
        />
        <button class="tx-btn" type="submit" disabled={sending || !email.trim()}>
          {sending ? 'Sending…' : 'Sign in'}
        </button>
      </div>
      {#if error}
        <div class="text-err">{error}</div>
      {/if}
    </form>
  {:else}
    <p>Check your email for the magic link.</p>
  {/if}
</div>
