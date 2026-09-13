import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/state/authStore';
import { formatAuMobile } from '@common/mobile';

/**
 * Top bar for the signed-in surface — AppLayout is the only thing that
 * renders it. Hamburger menu top left (pages + sign out), the signed-in
 * mobile top right.
 *
 * It still checks `isAdmin === true` before painting anything, even though
 * its layout already gates on the same condition: the layout's redirect
 * runs in an effect, so there is one frame where a non-admin would
 * otherwise see admin chrome.
 */
export function AppHeader() {
  const navigate = useNavigate();
  const loaded = useAuthStore((s) => s.loaded);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const [menuOpen, setMenuOpen] = useState(false);

  // Click anywhere outside the menu closes it. Listener lives on the
  // document because the click that matters happens outside this subtree.
  useEffect(() => {
    if (!menuOpen) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-menu-root]')) setMenuOpen(false);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [menuOpen]);

  async function handleSignOut() {
    setMenuOpen(false);
    // Navigate to the sign-in screen BEFORE signing out: once off the
    // AppLayout its gate effect is gone, so it can't race this with a
    // redirect of its own.
    navigate('/', { replace: true });
    await signOut();
  }

  return (
    <header className="border-border bg-bg-soft flex h-16 items-center border-b px-3">
      {loaded && isAdmin === true && (
        <>
          <div data-menu-root className="relative">
            <button
              className="hover:bg-bg-hover flex h-14 w-14 items-center justify-center rounded"
              onClick={() => setMenuOpen((open) => !open)}
              aria-label="Menu"
              aria-expanded={menuOpen}
            >
              <span aria-hidden="true" className="text-3xl leading-none">
                ≡
              </span>
            </button>
            {menuOpen && (
              /*
                New pages (e.g. /scopes) should add themselves here in the
                same shape — a li with a <Link> — so the menu stays the
                single source of nav truth. They go in AppLayout's
                `children` in router.tsx to inherit the auth gate.
              */
              <nav className="border-border absolute top-full left-0 mt-1 min-w-[180px] border bg-white shadow-sm">
                <ul>
                  <li>
                    <Link
                      to="/users"
                      onClick={() => setMenuOpen(false)}
                      className="hover:bg-bg-hover block px-3 py-2"
                    >
                      users
                    </Link>
                  </li>
                  <li className="border-border border-t">
                    <button
                      type="button"
                      className="hover:bg-bg-hover block w-full px-3 py-2 text-left"
                      onClick={handleSignOut}
                    >
                      sign out
                    </button>
                  </li>
                </ul>
              </nav>
            )}
          </div>
          <div className="text-fg-faint ml-auto text-[15px]">
            {user?.phoneNumber ? formatAuMobile(user.phoneNumber) : ''}
          </div>
        </>
      )}
      {/* Anything other than a loaded admin renders an empty bar; the layout
          is already redirecting them out. */}
    </header>
  );
}
