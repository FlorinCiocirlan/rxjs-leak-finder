export type RouteChange = { from: string; to: string };
export type RouteListener = (change: RouteChange) => void;

function currentPath(): string {
  return window.location.pathname + window.location.search + window.location.hash;
}

function urlToPath(url: string | URL | null | undefined, base: string): string {
  if (url == null) return base;
  const s = String(url);
  if (s === '') return base;
  // Absolute URL: extract pathname+search+hash
  if (s.startsWith('http://') || s.startsWith('https://') || s.startsWith('//')) {
    try {
      const u = new URL(s);
      return u.pathname + u.search + u.hash;
    } catch {
      return s;
    }
  }
  // Relative or absolute path
  return s;
}

// Module-level tracking: intercept replaceState/pushState so we always know
// the current URL even in environments (e.g. happy-dom) where window.location
// doesn't update synchronously after history mutations.
let _trackedPath: string | null = null;

function getTrackedPath(): string {
  return _trackedPath ?? currentPath();
}

function patchHistoryGlobal() {
  if ((history as any).__rld_patched_global) return;
  (history as any).__rld_patched_global = true;

  const origPush = history.pushState;
  const origReplace = history.replaceState;

  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    origPush.apply(this, args);
    const url = args[2];
    if (url != null) {
      _trackedPath = urlToPath(url, _trackedPath ?? currentPath());
    }
  } as typeof history.pushState;

  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    origReplace.apply(this, args);
    const url = args[2];
    if (url != null) {
      _trackedPath = urlToPath(url, _trackedPath ?? currentPath());
    }
  } as typeof history.replaceState;
}

// Patch as soon as the module is imported
patchHistoryGlobal();

export function installRouteTracker(listener: RouteListener): () => void {
  let lastPath = getTrackedPath();

  const fireWithUrl = (url: string | URL | null | undefined) => {
    const next = url != null
      ? urlToPath(url, getTrackedPath())
      : getTrackedPath();
    if (next === lastPath) return;
    const prev = lastPath;
    lastPath = next;
    listener({ from: prev, to: next });
  };

  const fire = () => {
    // Prefer window.location (accurate for hash/popstate changes) over the
    // tracked path (which may lag if the environment doesn't sync location
    // after pushState but does sync it for hash changes).
    const fromLocation = currentPath();
    const fromTracked = getTrackedPath();
    // Use whichever differs from lastPath; location takes precedence.
    const next = fromLocation !== lastPath ? fromLocation : fromTracked;
    if (next === lastPath) return;
    const prev = lastPath;
    lastPath = next;
    _trackedPath = next; // keep module state in sync
    listener({ from: prev, to: next });
  };

  // Layer our per-instance patch on top of the global patch
  const globalPush = history.pushState;
  const globalReplace = history.replaceState;

  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    globalPush.apply(this, args);
    fireWithUrl(args[2]);
  } as typeof history.pushState;

  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    globalReplace.apply(this, args);
    fireWithUrl(args[2]);
  } as typeof history.replaceState;

  const onPop = () => fire();
  const onHash = () => fire();
  window.addEventListener('popstate', onPop);
  window.addEventListener('hashchange', onHash);

  return () => {
    history.pushState = globalPush;
    history.replaceState = globalReplace;
    window.removeEventListener('popstate', onPop);
    window.removeEventListener('hashchange', onHash);
  };
}

export function tryAngularRouter(listener: RouteListener, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const ng = (globalThis as any).ng;
      try {
        const router = ng?.applicationRef?.injector?.get?.((globalThis as any).ng?.Router);
        if (router?.events?.subscribe) {
          router.events.subscribe((e: any) => {
            if (e && (e.constructor?.name === 'NavigationEnd' || e.url)) {
              const prev = (globalThis as any).__rld_session?.currentRoute ?? '';
              listener({ from: prev, to: e.url ?? e.urlAfterRedirects ?? '' });
            }
          });
          resolve(true);
          return;
        }
      } catch {}
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, 250);
    };
    tick();
  });
}
