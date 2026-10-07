import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppHeader } from '@/components/AppHeader';
import { useAuthStore } from '@/state/authStore';
import { useUsersStore } from '@/state/usersStore';
import { useKeptScroll } from '@/utils/keptScroll';

/**
 * The signed-in surface: gate + page frame. Every route listed as a child
 * of this layout in `router.tsx` is behind the check below; anything
 * routed outside it is public. That is the entire access model — put a
 * new page in this layout's `children` and it is gated for free.
 *
 * Only the sign-in screen at / sits outside. There is no anonymous
 * surface in this app.
 *
 * The top bar is rendered here, above every page; a page is content only
 * (its name comes from the bar's SCREENS list, and it fills the bar's
 * control / indicator slots with <HeaderControl> / <HeaderRight>).
 */
export function AppLayout() {
  const navigate = useNavigate();
  const loaded = useAuthStore((s) => s.loaded);
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const signOut = useAuthStore((s) => s.signOut);
  // Every page comes back where it was scrolled to, keyed by its route.
  const kept = useKeptScroll(useLocation().pathname);

  // Three states once `loaded` resolves:
  //   no user           → / (sign in)
  //   user, not admin   → sign out, /?denied=1
  //   user, admin       → render the page
  // The JSX below is also gated on `loaded && isAdmin === true`, so the
  // page never paints for non-admins. Without that gate the layout
  // flashes before this effect can redirect.
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

  // <main> is the scroller (the frame is the viewport's height, so the
  // header stays put), and it owns the page gutter: pages add no
  // horizontal padding of their own.
  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
      <main {...kept} className="pl-gutter flex flex-1 flex-col overflow-auto py-4 pr-3">
        <Outlet />
      </main>
    </div>
  );
}
