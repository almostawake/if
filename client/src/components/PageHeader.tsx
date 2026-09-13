/**
 * Standard header for any "main" page inside AppLayout. Render at the top
 * of the page, before the page's content.
 *
 *   <PageHeader title="users" description="…" />
 *
 * Spacing (consistent across all pages):
 *   pt-4   <- on the page wrapper, above the header
 *   title
 *   mt-2   <- inside the header, before description
 *   description
 *   mt-2   <- inside the header, before the divider
 *   ─── divider ───
 *   mt-8   <- on the page's first content block
 */
type Props = { title: string; description?: string };

export function PageHeader({ title, description }: Props) {
  return (
    <header>
      <h1 className="font-bold">{title}</h1>
      {description && <p className="text-fg-faint mt-2 text-[15px]">{description}</p>}
      <hr className="border-border mt-2 border-t" />
    </header>
  );
}
