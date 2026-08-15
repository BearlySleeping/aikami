// packages/backend/database/src/lib/pg_errors.ts
//
// C-394: shared Postgres error-code extraction.
//
// Drizzle wraps pg errors in DrizzleQueryError with the original error on
// the `cause` chain, so extracting a SQLSTATE walks the cause chain until a
// 5-char alphanumeric code is found.

/** Extract the Postgres error code (SQLSTATE) from a rejected promise. */
export const pgErrorCode = (error: unknown): string | undefined => {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
      return code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
};
