import type { ReactNode } from 'react';
import { PageHeader } from '@/components/PageHeader';

/**
 * Standard wrapper for any "main" page inside AppLayout. Owns the page
 * chrome — gutter/top spacing, header (title + optional description +
 * divider), and the gap to first content. Pages just declare their title,
 * description, and content:
 *
 *   <Page title="users" description="…">
 *     <p>page content here</p>
 *   </Page>
 *
 * The content area is itself a flex-column that flex-fills <main>. Pages
 * that want to center content can use
 * `className="flex flex-1 items-center justify-center"` on a child; pages
 * that just stack rows from the top need no extra classes.
 */
type Props = {
  title: string;
  description?: string;
  children?: ReactNode;
};

export function Page({ title, description, children }: Props) {
  return (
    <div className="flex flex-1 flex-col pt-4">
      <PageHeader title={title} description={description} />
      {children && <div className="mt-8 flex flex-1 flex-col">{children}</div>}
    </div>
  );
}
