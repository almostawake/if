import { createBrowserRouter } from 'react-router-dom';
import { AppLayout } from '@/layouts/AppLayout';
import { SignInPage } from '@/pages/SignInPage';
import { UsersPage } from '@/pages/UsersPage';

/**
 * THE route table — the whole URL map of the app in one file.
 *
 * **This is the auth gate.** Routes nested under `AppLayout` are signed-in
 * only: that layout checks the whitelist, redirects anyone who fails, and
 * renders the top bar. A route added at the TOP level of this array is
 * wide open to the internet.
 *
 * So: a new page goes in `AppLayout`'s `children`, and gets a link in
 * `AppHeader`'s menu. Only the sign-in screen at `/` sits outside — there
 * is no anonymous surface in this app. Don't add one without asking.
 */
export const router = createBrowserRouter([
  { path: '/', element: <SignInPage /> },
  {
    element: <AppLayout />,
    children: [{ path: '/users', element: <UsersPage /> }],
  },
]);
