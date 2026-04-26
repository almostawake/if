<!--
  Standard header for any "main" page inside the (app) layout. Render at
  the top of the page, before the page's content.

    <PageHeader title="whitelisted users" description="…" />

  Spacing (consistent across all pages):
    pt-4   <- on the page wrapper, above the header
    title
    mt-2   <- inside the header, before description
    description
    mt-2   <- inside the header, before the divider
    ─── divider ───
    mt-4   <- on the page's first content block (e.g. ul.mt-4)
-->
<script lang="ts">
  type Props = { title: string; description?: string };
  let { title, description }: Props = $props();
</script>

<header>
  <h1 class="font-bold">{title}</h1>
  {#if description}
    <p class="mt-2 text-[15px] text-fg-faint">{description}</p>
  {/if}
  <hr class="mt-2 border-t border-border" />
</header>
