// apps/frontend/client/src/lib/utils/url_search_params.ts
//
// Lightweight wrapper for syncing UI state (e.g. an active tab) to the URL's
// search params via history.replaceState. Used to make tabbed views
// deep-linkable and refresh-safe without a SvelteKit navigation/reload —
// this is a Tauri SPA, so no +page.server.ts data loading is involved.

/** Reads a single search param from the current URL. Returns undefined outside the browser. */
export const readSearchParam = (key: string): string | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return new URLSearchParams(window.location.search).get(key) ?? undefined;
};

/**
 * Sets or removes one or more search params on the current URL via
 * `history.replaceState` — updates the address bar without navigating,
 * reloading, or pushing a new history entry.
 * Pass `undefined` for a value to remove that key.
 */
export const syncSearchParams = (params: Record<string, string | undefined>): void => {
  if (typeof window === 'undefined') {
    return;
  }
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
  }
  window.history.replaceState(window.history.state, '', url);
};
