import type { router as appRouter } from '@/router';

/**
 * Pick up a new deploy without interrupting the user.
 *
 * A single-page app never re-fetches itself: once a tab is open it runs
 * the build it loaded until the page is reloaded. So after a hosting
 * deploy, every open tab keeps the old code (and may talk to the new
 * Cloud Functions). This module closes that gap in two halves:
 *
 *   1. **Detect** — in the background (tab regains focus, plus a slow
 *      timer) fetch `/version.json`, which the build emits next to
 *      `index.html` with the same build id that is compiled into this
 *      bundle (`__BUILD_ID__`, via `define` in vite.config.ts). A
 *      different id means a newer build is live. Just remember it.
 *
 *   2. **Reload** — only at the next route change. A route change
 *      already throws away the page the user was on, so reloading at
 *      that moment costs nothing extra; reloading mid-page would eat
 *      whatever they were typing. The reload loads the URL they were
 *      navigating to, so it is invisible apart from a brief flash.
 *
 * Only in-memory state that outlives navigation (a Zustand store) is at
 * risk; a long-lived draft kept in a store should be persisted to
 * sessionStorage before this matters.
 *
 * Dev is skipped: Vite serves `index.html` for `/version.json`, and HMR
 * already handles code changes.
 */
export function watchForNewVersion(router: typeof appRouter): void {
  if (import.meta.env.DEV) return;

  let newerBuildIsLive = false;

  async function check(): Promise<void> {
    if (newerBuildIsLive) return;
    try {
      // `no-store` + cache-buster: never trust a cached copy of the one
      // file whose whole job is to be current. firebase.json also serves
      // it with Cache-Control: no-store (belt and braces).
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) return;
      const { build } = (await res.json()) as { build?: string };
      if (build && build !== __BUILD_ID__) newerBuildIsLive = true;
    } catch {
      // Offline, mid-deploy, whatever — try again next time.
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
  // A tab left in the foreground for hours never fires visibilitychange.
  setInterval(() => void check(), 5 * 60 * 1000);

  // Fires on every router state change; only act on a real location
  // change (new history key), and only once a newer build is known.
  let lastKey = router.state.location.key;
  router.subscribe((state) => {
    if (state.location.key === lastKey) return;
    lastKey = state.location.key;
    if (newerBuildIsLive) window.location.reload();
  });
}
