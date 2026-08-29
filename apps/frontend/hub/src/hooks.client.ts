// apps/frontend/hub/src/hooks.client.ts
//
// Client-side hooks — runs in the browser on every page navigation.
//
// Suppresses harmless `DOMException: The operation was aborted`
// unhandled promise rejections. These are thrown when the transport
// cancels pending requests (normal behavior during concurrent
// queries or page transitions).
// Also suppresses Auth Emulator signInWithPopup abort errors during popup cleanup.

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason;
    // Aborted requests during concurrent queries or page navigation are harmless.
    if (
      (error instanceof DOMException && error.name === 'AbortError') ||
      (error != null && /The operation was aborted/i.test(error.message || ''))
    ) {
      event.preventDefault();
    }
  });
}
