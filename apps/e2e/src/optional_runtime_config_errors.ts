// apps/e2e/src/optional_runtime_config_errors.ts
// C-389 rung 3: a missing same-origin /config.json is a documented fallback.
// Never infer that exception from Chromium's generic resource-error text alone.

export type ObservedResourceFailure = { url: string; status: number };
export type ObservedConsoleError = { url: string; text: string };

/** Only the actual optional document's 404 is an expected HTTP failure. */
export const isOptionalRuntimeConfig404 = (
  response: ObservedResourceFailure,
  appOrigin: string,
): boolean => {
  if (response.status !== 404) {
    return false;
  }
  try {
    const url = new URL(response.url);
    return url.origin === appOrigin && url.pathname === '/config.json' && url.search === '';
  } catch {
    return false;
  }
};

/** Correlates exact URL, observed HTTP status and native console status text. */
export const isObservedOptionalRuntimeConfig404 = (options: {
  error: ObservedConsoleError;
  responses: readonly ObservedResourceFailure[];
  appOrigin: string;
}): boolean => {
  // A previous 404 at this URL must not hide a later 500/403 or a script error.
  if (
    !/^Failed to load resource: the server responded with a status of 404\b/.test(
      options.error.text,
    )
  ) {
    return false;
  }
  return options.responses.some(
    (response) =>
      response.url === options.error.url && isOptionalRuntimeConfig404(response, options.appOrigin),
  );
};
