import { useEffect } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { AppHeader } from '@/components/AppHeader';
import { useAuthStore } from '@/state/authStore';
import { useUsersStore } from '@/state/usersStore';

/**
 * The signed-in surface: gate + chrome. Every route listed as a child of
 * this layout in `router.tsx` is behind the check below; anything routed
 * outside it is public. That is the entire access model — put a new page
 * in this layout's `children` and it is gated for free.
 *
 * Only the sign-in screen at / sits outside. There is no anonymous
 * surface in this app.
 */
export function AppLayout() {
  const navigate = useNavigate();
  const loaded = useAuthStore((s) => s.loaded);
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const signOut = useAuthStore((s) => s.signOut);

  // Three states once `loaded` resolves:
  //   no user           → / (sign in)
  //   user, not admin   → sign out, /?denied=1
  //   user, admin       → render the page
  // The JSX below is also gated on `loaded && isAdmin === true`, so the
  // chrome (menu, signed-in mobile, etc.) never paints for non-admins.
  // Without that gate the layout flashes before this effect can redirect.
  useEffect(() => {
    if (!loaded) return;
    if (!user) {
      navigate('/', { replace: true });
    } else if (isAdmin === false) {
      signOut().then(() => navigate('/?denied=1', { replace: true }));
    }
  }, [loaded, user, isAdmin, signOut, navigate]);

  // Long-lived Firestore subscription tied to this layout's lifecycle.
  // Only start once the user is known to be an admin — otherwise the
  // onSnapshot would hit a permission-denied error.
  useEffect(() => {
    if (isAdmin !== true) return;
    const { start, stop } = useUsersStore.getState();
    start();
    return stop;
  }, [isAdmin]);

  if (!loaded || isAdmin !== true) return null;

  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />

      {/*
        Page-content gutter: pl uses --page-gutter (= the menu icon's visible
        left edge, defined in app.css) so every page aligns with the menu
        icon. New pages should not add their own horizontal padding — they
        inherit this.

        `flex flex-col` makes <main> a flex column so a page can opt into
        filling the remaining height; pages that just stack content at the
        top need no extra classes.
      */}
      <main className="flex flex-1 flex-col overflow-auto py-4 pr-3 pl-[var(--page-gutter)]">
        <Outlet />
      </main>
    </div>
  );
}
