<!--
  Standard wrapper for any "main" page inside the /admin layout. Owns
  the page chrome — gutter/top spacing, header (title + optional
  description + divider), and the gap to first content. Pages just
  declare their title, description, and content:

    <Page title="admins" description="…">
      <p>page content here</p>
    </Page>

  The content slot is itself a flex-column that flex-fills <main>. Pages
  that want to center content can use
  `class="flex flex-1 items-center justify-center"` on a child; pages
  that just stack rows from the top need no extra classes.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import PageHeader from './PageHeader.svelte';

  type Props = {
    title: string;
    description?: string;
    children?: Snippet;
  };
  let { title, description, children }: Props = $props();
</script>

<div class="flex flex-1 flex-col pt-4">
  <PageHeader {title} {description} />
  {#if children}
    <div class="mt-8 flex flex-1 flex-col">
      {@render children()}
    </div>
  {/if}
</div>
