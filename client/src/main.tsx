import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { router } from '@/router';
import '@/app.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root missing from index.html');

// StrictMode stays ON. It double-invokes effects in development, which is
// how a non-idempotent subscription (a listener started twice, never torn
// down) shows up on your machine instead of in production.
createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
