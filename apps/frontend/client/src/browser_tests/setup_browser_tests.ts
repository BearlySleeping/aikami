// apps/frontend/client/src/browser_tests/setup_browser_tests.ts
//
// Browser-lane setup. The Vitest Browser Mode + Vite harness is served from the
// same origin as the test page, so same-origin traffic (module loading, HMR) is
// always allowed. A cross-origin fetch means application code reached for a real
// provider, which this lane must never do — it has no production credentials and
// must not depend on the network. Fail those loudly.

const requestUrlOf = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
};

const originalFetch = window.fetch.bind(window);
const originalPreconnect = window.fetch.preconnect;

const guardedFetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const requestUrl = requestUrlOf(input);
  let origin = window.location.origin;
  try {
    origin = new URL(requestUrl, window.location.href).origin;
  } catch {
    // A malformed URL is passed through so the application's own error surfaces.
  }
  if (origin !== window.location.origin) {
    return Promise.reject(
      new Error(
        `[browser-tests] unexpected cross-origin request: ${requestUrl}. ` +
          'Inject a capability or stub the transport instead of hitting a real endpoint.',
      ),
    );
  }
  return originalFetch(input, init);
};

// `preconnect` is declared on the DOM fetch type but is not implemented by
// Chromium; carry it over only when the runtime actually provides it.
if (typeof originalPreconnect === 'function') {
  Reflect.set(guardedFetch, 'preconnect', originalPreconnect.bind(window));
}

// Reflect.set keeps this assignment independent of the DOM `fetch` type, which
// otherwise requires re-declaring the optional `preconnect` member.
Reflect.set(window, 'fetch', guardedFetch);
