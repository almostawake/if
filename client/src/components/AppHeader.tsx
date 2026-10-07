import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { useAuthStore } from '@/state/authStore';
import { formatAuMobile } from '@common/mobile';

// The app's screens, in the order the menu always shows them: the same
// list on every screen, the one you're on highlighted. The label is also
// the screen's name in the bar. A new screen goes in here (and in
// AppLayout's children in router.tsx).
const SCREENS: { label: string; href: string }[] = [{ label: 'users', href: '/users' }];

// Top bar for signed-in screens — the only chrome a screen has; AppLayout
// renders it above every page. Hamburger menu left (every screen, the
// current one highlighted — picking it goes to that screen's top level —
// then "sign out", then, greyed at the bottom, who is signed in and what
// version is running), the screen's name beside it (the ONLY place a
// screen is named: pages carry no heading, no description, no counts),
// the screen's main control two thirds of the way across, and an
// indicator slot far right. A page fills the two slots by rendering
// <HeaderControl> / <HeaderRight> anywhere in its tree.
export function AppHeader() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const here = useLocation().pathname;
  const mobile = useAuthStore((s) => s.user?.phoneNumber);

  const current = SCREENS.find((s) => here === s.href || here.startsWith(s.href + '/'));

  // A click anywhere outside the menu, or Esc, closes it. Listeners live
  // on the document because the click that matters happens outside this
  // subtree.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('[data-menu-root]')) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function signOut() {
    setOpen(false);
    // Leave the signed-in surface BEFORE signing out: once off AppLayout
    // its gate effect is gone, so it can't race this with a redirect of
    // its own.
    navigate('/', { replace: true });
    await useAuthStore.getState().signOut();
  }

  return (
    <header className="border-border bg-bg-soft flex h-16 shrink-0 items-center border-b px-[calc(var(--spacing-gutter)-11px)]">
      {/* Two to one either side of the control puts it two thirds of the
          way across, whatever the sides hold. */}
      <div className="flex flex-2 items-center">
        <div data-menu-root className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label="menu"
            aria-expanded={open}
            className="flex h-11 w-11 flex-col items-center justify-center gap-[5px] rounded hover:opacity-60"
          >
            <span className="bg-fg h-[2.5px] w-[22px] rounded-[1px]" />
            <span className="bg-fg h-[2.5px] w-[22px] rounded-[1px]" />
            <span className="bg-fg h-[2.5px] w-[22px] rounded-[1px]" />
          </button>
          {open && (
            <nav className="border-border bg-bg absolute top-full left-0 z-10 min-w-[180px] rounded-md border py-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.12)]">
              <ul>
                {SCREENS.map((s) => {
                  const isCurrent = s === current;
                  return (
                    <li key={s.href}>
                      <Link
                        to={s.href}
                        onClick={() => setOpen(false)}
                        aria-current={isCurrent ? 'page' : undefined}
                        className={`hover:bg-bg-hover block px-5 py-3 hover:no-underline ${isCurrent ? 'bg-accent-soft font-semibold' : ''}`}
                      >
                        {s.label}
                      </Link>
                    </li>
                  );
                })}
                <li>
                  <button
                    type="button"
                    onClick={signOut}
                    className="text-accent hover:bg-bg-hover block w-full px-5 py-3 text-left"
                  >
                    sign out
                  </button>
                </li>
                <li className="section-label px-5 py-3">
                  {mobile ? <div>{formatAuMobile(mobile)}</div> : null}
                  <div>{__APP_VERSION__}</div>
                </li>
              </ul>
            </nav>
          )}
        </div>
        {current ? <div className="ml-2.5 truncate font-semibold">{current.label}</div> : null}
      </div>
      {/* Always there, even empty — the control stays put screen to screen. */}
      <div
        ref={(el) => useSlots.setState({ control: el })}
        className="flex w-8 items-center justify-center"
      />
      <div className="flex flex-1 justify-end">
        <div
          ref={(el) => useSlots.setState({ right: el })}
          className="flex h-11 w-11 items-center justify-center"
        />
      </div>
    </header>
  );
}

// The bar's two slots, filled from inside a page. The header registers its
// slot elements here as it mounts; a page's <HeaderControl> renders into
// one through a portal, so the page owns what the bar shows without the
// bar knowing about the page.
const useSlots = create<{ control: HTMLElement | null; right: HTMLElement | null }>(() => ({
  control: null,
  right: null,
}));

/** The screen's main control, two thirds of the way along the bar (32px wide). */
export function HeaderControl({ children }: { children: ReactNode }) {
  const el = useSlots((s) => s.control);
  return el ? createPortal(children, el) : null;
}

/** An indicator at the bar's far right (44px square). */
export function HeaderRight({ children }: { children: ReactNode }) {
  const el = useSlots((s) => s.right);
  return el ? createPortal(children, el) : null;
}
