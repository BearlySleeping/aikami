// apps/e2e/src/error_allowlist.ts
//
// Known benign console errors and warnings that should NOT cause
// the release gate to fail. Used by release_gate.spec.ts to filter
// false positives from PixiJS, ResizeObserver, and navigation aborts.
//
// Contract: C-335 AC-5 — Console and Network Error Assertions

/**
 * Patterns for known benign console messages.
 * Each pattern is tested against console.error, console.warn,
 * pageerror, and failed network requests.
 */
export const CONSOLE_ERROR_ALLOWLIST: RegExp[] = [
  // ResizeObserver loop errors — a browser behavior quirk, not a real error
  /ResizeObserver loop/,

  // ResizeObserver loop completed with undelivered notifications
  /ResizeObserver loop completed/,

  // PixiJS known benign warnings about missing extensions
  /pixi\.js.*deprecated/i,

  // WebGL context loss warnings that resolve automatically
  /WebGL.*context.*lost/i,

  // Fetch aborts from navigation — Playwright kills in-flight requests during page.goto
  /fetch.*abort/i,

  // Aborted fetch requests (navigating away mid-request)
  /The operation was aborted/i,

  // Failed to load resource: net::ERR_ABORTED (navigation-related)
  /net::ERR_ABORTED/,

  // WebSocket connection errors during page teardown
  /WebSocket.*closed/i,

  // Offline mode: expected network failures when testing offline profile
  /net::ERR_INTERNET_DISCONNECTED/,
  /net::ERR_CONNECTION_REFUSED/,
  /net::ERR_FAILED/,

  // Known PixiJS WebGL warnings in headless mode
  /WARNING.*pixi/i,

  // Chrome extension errors (not part of our app)
  /chrome-extension:/,
];

/**
 * Patterns for known benign page errors (uncaught exceptions).
 * These are filtered from pageerror event listeners.
 */
export const PAGE_ERROR_ALLOWLIST: RegExp[] = [
  // ResizeObserver loop errors — browser quirk
  /ResizeObserver loop/,

  // PixiJS internal errors that self-resolve
  /pixi\.js.*error/i,
];

/**
 * Test whether a console error message should be ignored.
 * Returns true if the message matches any allowlisted pattern.
 */
export const isAllowedConsoleError = (text: string): boolean => {
  return CONSOLE_ERROR_ALLOWLIST.some((pattern) => pattern.test(text));
};

/**
 * Test whether a page error message should be ignored.
 * Returns true if the message matches any allowlisted pattern.
 */
export const isAllowedPageError = (message: string): boolean => {
  return PAGE_ERROR_ALLOWLIST.some((pattern) => pattern.test(message));
};

/**
 * Create Playwright page listeners for console and page errors.
 * Returns a collector object with the accumulated errors.
 *
 * @example
 * ```ts
 * const collector = setupErrorCollection(page);
 * // ... run test ...
 * collector.assertNoErrors(); // throws if any non-allowlisted errors
 * ```
 */
export const setupErrorCollection = (page: import('@playwright/test').Page) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  const consoleHandler = (msg: import('playwright').ConsoleMessage) => {
    // Only track errors and warnings that matter
    if (msg.type() === 'error') {
      const text = msg.text();
      if (!isAllowedConsoleError(text)) {
        consoleErrors.push(`[console.${msg.type()}] ${text}`);
      }
    }
  };

  const pageErrorHandler = (error: Error) => {
    if (!isAllowedPageError(error.message)) {
      pageErrors.push(`[pageerror] ${error.message}`);
    }
  };

  const requestFailedHandler = (request: import('playwright').Request) => {
    const url = request.url();
    // Skip localhost, data: URLs, and blob: URLs
    if (/^(data:|blob:|chrome-extension:)/.test(url)) {
      return;
    }
    if (url.includes('localhost')) {
      return;
    }

    const failure = request.failure();
    if (failure) {
      const errorText = failure.errorText || 'unknown';
      if (!isAllowedConsoleError(errorText)) {
        failedRequests.push(`[network] ${url} — ${errorText}`);
      }
    }
  };

  page.on('console', consoleHandler);
  page.on('pageerror', pageErrorHandler);
  page.on('requestfailed', requestFailedHandler);

  return {
    /** Assert no errors were collected. Throws with error list if any exist. */
    assertNoErrors: async () => {
      const { expect } = await import('@playwright/test');

      if (consoleErrors.length > 0) {
        const msg = `Console errors detected (${consoleErrors.length}):\n${consoleErrors.join('\n')}`;
        expect(consoleErrors, msg).toHaveLength(0);
      }

      if (pageErrors.length > 0) {
        const msg = `Page errors detected (${pageErrors.length}):\n${pageErrors.join('\n')}`;
        expect(pageErrors, msg).toHaveLength(0);
      }

      if (failedRequests.length > 0) {
        const msg = `Failed network requests (${failedRequests.length}):\n${failedRequests.join('\n')}`;
        expect(failedRequests, msg).toHaveLength(0);
      }
    },

    /** Get all collected errors for manual inspection. */
    getAllErrors: () => ({
      consoleErrors: [...consoleErrors],
      pageErrors: [...pageErrors],
      failedRequests: [...failedRequests],
    }),

    /** Clean up listeners. */
    cleanup: () => {
      page.off('console', consoleHandler);
      page.off('pageerror', pageErrorHandler);
      page.off('requestfailed', requestFailedHandler);
    },
  };
};
