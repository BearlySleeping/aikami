// apps/frontend/hub/src/hooks.client.ts
//
// Client-side hooks — runs in the browser on every page navigation.
//
// Suppresses harmless Firestore SDK `DOMException: The operation was aborted`
// unhandled promise rejections. These are thrown by the Firestore WebChannel
// transport when it cancels pending requests (normal behavior during concurrent
// queries or page transitions).
// Also suppresses Auth Emulator signInWithPopup abort errors during popup cleanup.

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    const error = event.reason;
    // Firestore SDK internally aborts WebChannel requests when concurrent
    // queries race or during page navigation. This is harmless.
    if (
      (error instanceof DOMException && error.name === 'AbortError') ||
      (error != null && /The operation was aborted/i.test(error.message || ''))
    ) {
      event.preventDefault();
    }
  });
}
