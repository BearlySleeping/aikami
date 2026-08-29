// apps/frontend/client/src/hooks.client.ts
//
// Client-side hooks — runs in the browser on every page navigation.
//
// Suppresses harmless `DOMException: The operation was aborted`
// unhandled promise rejections. These are thrown when the transport
// cancels pending requests (normal behavior during concurrent
// queries or page transitions).

import '$lib/services/tauri_console_log';

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason;
    // Aborted requests during concurrent queries or page navigation are harmless.
    if (error instanceof DOMException && error.name === 'AbortError') {
      event.preventDefault();
    }
  });
}
