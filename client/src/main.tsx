import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/router';
import { watchForNewVersion } from '@/version';
import '@/app.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root missing from index.html');

// After a deploy, open tabs pick up the new build on their next route
// change — never mid-page. See src/version.ts.
watchForNewVersion(router);

// StrictMode stays ON. It double-invokes effects in development, which is
// how a non-idempotent subscription (a listener started twice, never torn
// down) shows up on your machine instead of in production.
createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
