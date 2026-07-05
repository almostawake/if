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

  // /login is for admins only. If an already-signed-in admin lands
  // here, bounce them straight to /admin (the only thing they sign in
  // for in this app).
  $effect(() => {
    if (authStore.loaded && authStore.user && authStore.isAdmin === true) {
      goto('/admin', { replaceState: true });
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

<div class="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
  {#if !sent}
    <form onsubmit={submit} class="space-y-3">
      {#if denied}
        <div class="text-err">
          that email isn't on the admin list. ask an existing admin to add you.
        </div>
      {/if}
      <div class="flex items-center gap-2">
        <input
          id="email"
          class="tx-input w-[360px]"
          type="email"
          autocomplete="email"
          required
          bind:value={email}
          placeholder="you@example.com"
        />
        <button class="tx-btn whitespace-nowrap" type="submit" disabled={sending || !email.trim()}>
          {sending ? 'sending…' : 'send link'}
        </button>
      </div>
      {#if error}
        <div class="text-err">{error}</div>
      {/if}
    </form>
  {:else}
    <p>check your email for the magic link.</p>
  {/if}
</div>
