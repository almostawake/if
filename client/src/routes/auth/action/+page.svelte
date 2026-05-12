<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { AuthService } from '$lib/services/AuthService';
  import { usersStore } from '$lib/state/UsersStore.svelte';

  let status = $state<'working' | 'need-email' | 'error' | 'done'>('working');
  let error = $state<string | null>(null);
  let email = $state('');

  onMount(async () => {
    const href = window.location.href;
    if (!AuthService.isLink(href)) {
      status = 'error';
      error = "this doesn't look like a sign-in link.";
      return;
    }
    try {
      const user = await AuthService.completeEmailLink(href);
      // Best-effort enrichment of the whitelist row with uid +
      // lastSignInAt. Failure shouldn't block the redirect — the
      // user is signed in either way; the next sign-in will retry.
      try { await usersStore.recordSignIn(user); } catch { /* swallow */ }
      status = 'done';
      goto('/admin', { replaceState: true });
    } catch (e) {
      const msg = (e as Error).message;
      // Most likely cause: opened on a different device, so localStorage
      // doesn't have the email. Prompt for it.
      if (msg.toLowerCase().includes('email')) {
        status = 'need-email';
      } else {
        status = 'error';
        error = msg;
      }
    }
  });

  async function submitEmail(e: SubmitEvent) {
    e.preventDefault();
    try {
      const user = await AuthService.completeEmailLink(window.location.href, email.trim());
      try { await usersStore.recordSignIn(user); } catch { /* swallow */ }
      status = 'done';
      goto('/admin', { replaceState: true });
    } catch (err) {
      status = 'error';
      error = (err as Error).message;
    }
  }
</script>

<div class="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
  {#if status === 'working'}
    <div class="text-fg-faint">signing you in…</div>
  {:else if status === 'need-email'}
    <div class="space-y-3">
      <div class="section-label">confirm your email</div>
      <p>
        looks like you opened the link on a different device. enter the email you signed in with
        to finish:
      </p>
      <form onsubmit={submitEmail} class="space-y-3">
        <input
          class="tx-input"
          type="email"
          required
          bind:value={email}
          placeholder="you@example.com"
        />
        <button class="tx-btn w-full" type="submit" disabled={!email.trim()}>continue</button>
      </form>
    </div>
  {:else if status === 'error'}
    <div class="space-y-3">
      <div class="section-label text-err">sign-in failed</div>
      <p class="text-fg-muted">{error}</p>
      <a href="/login" class="text-accent">try again →</a>
    </div>
  {/if}
</div>
