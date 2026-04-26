<script lang="ts">
  import { authStore } from '$lib/state/AuthStore.svelte';
  import { allowedEmailsStore } from '$lib/state/AllowedEmailsStore.svelte';
  import Page from '$lib/components/Page.svelte';

  let adding = $state(false);
  let newEmail = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (adding && inputEl) inputEl.focus();
  });

  function startAdd() {
    adding = true;
    newEmail = '';
    error = null;
  }

  function cancelAdd() {
    adding = false;
    newEmail = '';
    error = null;
  }

  async function submitAdd(e: SubmitEvent) {
    e.preventDefault();
    if (saving) return;
    saving = true;
    error = null;
    try {
      const me = authStore.user?.email ?? 'unknown';
      await allowedEmailsStore.add(newEmail, me);
      cancelAdd();
    } catch (err) {
      error = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  async function remove(email: string) {
    error = null;
    try {
      await allowedEmailsStore.remove(email);
    } catch (err) {
      error = (err as Error).message;
    }
  }
</script>

<Page
  title="whitelisted users"
  description="these users will be allowed to log in and see everything."
>
  <ul class="space-y-1">
    {#each allowedEmailsStore.emails as item (item.email)}
      <li class="group flex items-center gap-2">
        <span>{item.email}</span>
        {#if allowedEmailsStore.emails.length > 1}
          <!--
            Two layered hover states. Row-hover (`group`) reveals the ×
            button; button-hover (`group/del`) additionally reveals the
            "delete <email>" label. Mirrors the `+ add a user` pattern
            below, just in red.
          -->
          <button
            type="button"
            class="group/del inline-flex items-center gap-2 text-err opacity-0 group-hover:opacity-100"
            onclick={() => remove(item.email)}
            aria-label="delete {item.email}"
          >
            <span class="text-[24px] leading-none">×</span>
            <span class="opacity-0 transition-opacity group-hover/del:opacity-100">delete</span>
          </button>
        {/if}
      </li>
    {/each}
  </ul>

  <div class="mt-[1.45em]">
    {#if !adding}
      <button
        type="button"
        class="group inline-flex items-center gap-2 text-fg-faint hover:text-fg"
        onclick={startAdd}
        aria-label="add a user"
      >
        <span class="text-[24px] leading-none">+</span>
        <span class="opacity-0 transition-opacity group-hover:opacity-100">add a user</span>
      </button>
    {:else}
      <form onsubmit={submitAdd} class="flex items-center gap-2">
        <input
          class="tx-input w-72"
          type="email"
          required
          bind:this={inputEl}
          placeholder="email@domain"
          bind:value={newEmail}
          onkeydown={(e) => { if (e.key === 'Escape') cancelAdd(); }}
        />
        <button class="tx-btn" type="submit" disabled={saving || !newEmail.trim()}>
          {saving ? '…' : 'add'}
        </button>
        <button class="tx-btn-ghost" type="button" onclick={cancelAdd}>cancel</button>
      </form>
    {/if}
  </div>

  {#if error}
    <div class="mt-3 text-err">{error}</div>
  {/if}
</Page>
