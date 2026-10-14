import { lazy, type ComponentType } from 'react';

const RELOAD_KEY = 'lastro:chunk-reload-attempted';

// Every route component is lazy-loaded (see App.tsx) — a deploy renames the built JS chunk
// files, so a tab left open across a deploy gets "Failed to fetch dynamically imported
// module" the moment it navigates to a route it hasn't loaded yet, with no way out short of
// a manual hard refresh. Reloads once automatically instead; sessionStorage (not just an
// in-memory flag) survives the reload itself, so a second real failure after that still
// throws for real instead of reload-looping forever.
// Split out from lazyWithReload so a test can call it directly without going through
// React's lazy()/Suspense machinery.
export function loadWithReloadOnce<T>(factory: () => Promise<T>): Promise<T> {
  return factory()
    .then((mod) => {
      sessionStorage.removeItem(RELOAD_KEY);
      return mod;
    })
    .catch((err) => {
      let alreadyAttempted = true;
      try {
        alreadyAttempted = !!sessionStorage.getItem(RELOAD_KEY);
        if (!alreadyAttempted) sessionStorage.setItem(RELOAD_KEY, '1');
      } catch {
        // sessionStorage unavailable (private mode, blocked) — fall through and throw below
      }
      if (!alreadyAttempted) {
        window.location.reload();
        return new Promise<T>(() => {}); // never resolves — the reload replaces this page
      }
      throw err;
    });
}

export function lazyWithReload<T extends { default: ComponentType<unknown> }>(factory: () => Promise<T>) {
  return lazy(() => loadWithReloadOnce(factory));
}
