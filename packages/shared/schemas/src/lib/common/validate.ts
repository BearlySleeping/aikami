// packages/shared/schemas/src/lib/validate.ts
//
// Parse-level-aware schema validation wrapper for TypeBox schemas.
// Callers supply their own ParseLevel (from frontend PUBLIC_PARSE_LEVEL
// or backend PARSE_LEVEL) instead of reading env directly.

import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';

/**
 * Controls validation strictness.
 *
 * - `off`  — skip validation entirely.
 * - `safe` — validate, return `false` on failure (no side effects).
 * - `on`   — validate, throw on failure.
 */
export type ParseLevel = 'off' | 'safe' | 'on';

/**
 * Validates a value against a TypeBox schema, honoring `parseLevel`.
 *
 * Behavior per level:
 * - `off`  → returns `true` immediately (no check).
 * - `safe` → runs `Value.Check`, returns `false` on failure (caller decides whether to warn).
 * - `on`   → runs `Value.Check`, throws `Error` on failure.
 *
 * @returns `true` when validation passed or was skipped, `false` only in safe mode.
 */
export const validateWithLevel = (options: {
  /** TypeBox schema to validate against. */
  schema: TSchema;
  /** Untrusted value to validate. */
  value: unknown;
  /** Validation strictness level. */
  parseLevel: ParseLevel;
  /** Optional label included in warning/error messages for traceability. */
  context?: string;
}): boolean => {
  const { schema, value, parseLevel, context } = options;

  if (parseLevel === 'off') {
    return true;
  }

  const valid = Value.Check(schema, value);

  if (valid) {
    return true;
  }

  const errors = Value.Errors(schema, value);
  const prefix = context ? `[${context}] ` : '';
  const details = errors.map((e) => e.message).join('; ');
  const message = `${prefix}Schema validation failed: ${details}`;

  if (parseLevel === 'on') {
    throw new Error(message);
  }

  // 'safe' mode: return false, caller decides whether to warn.
  return false;
};
