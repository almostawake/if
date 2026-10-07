import { useLayoutEffect, useRef, type UIEvent } from 'react';

// A scrolling element that comes back where you left it: ‹ and the
// browser's back re-mount the page they return to, and a long list would
// otherwise open at the top again. Each scroller names itself with a key;
// its offset is kept here for the page session and put back as soon as
// the content is tall enough to scroll that far (content from Firestore
// arrives after the first paint). AppLayout spreads this onto <main>
// keyed by the route, so every page gets it for free; a page that scrolls
// inside its own element spreads it there instead.
const kept = new Map<string, number>();

export function useKeptScroll(key: string) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const y = kept.get(key);
    if (!el || !y) return;

    let watcher: ResizeObserver | null = null;
    let giveUp: ReturnType<typeof setTimeout> | null = null;
    const stop = () => {
      watcher?.disconnect();
      if (giveUp) clearTimeout(giveUp);
    };
    const restore = () => {
      if (el.scrollHeight - el.clientHeight < y) return false;
      el.scrollTop = y;
      stop();
      return true;
    };
    if (restore()) return;

    // Not tall enough yet: watch the content grow, for a couple of seconds.
    watcher = new ResizeObserver(() => void restore());
    for (const child of el.children) watcher.observe(child);
    giveUp = setTimeout(stop, 2000);
    return stop;
  }, [key]);

  return {
    ref,
    onScroll: (e: UIEvent<HTMLDivElement>) => {
      kept.set(key, e.currentTarget.scrollTop);
    },
  };
}
