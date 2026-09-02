// packages/shared/utils/src/lib/common/type_guards.ts
//
// 🔴 Type-safety utilities: real type guard functions with runtime checks.
//    Every export here is a legitimate guard — it verifies shape at runtime.
//    No "trust me" wrappers (those belong as bare `as` casts with a
//    guard-ignore comment and an explanation of why the cast is unavoidable).

// ---------------------------------------------------------------------------
// Runtime-checked record guards
// ---------------------------------------------------------------------------

/**
 * Type guard: is the value a non-null, non-array object?
 * Use before accessing properties on an `unknown` value.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value);

/**
 * Narrow `unknown` to `Record<string, unknown>` with a runtime check.
 * Throws if the value is not a non-null object (plain or class instance).
 */
export const asRecord = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new TypeError(`Expected a Record, got ${value === null ? 'null' : typeof value}`);
  }
  return value;
};

/**
 * Narrow `unknown` to `Record<string, unknown>` without throwing.
 * Returns `undefined` when the value is not a valid record.
 */
export const asRecordSafe = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

// ---------------------------------------------------------------------------
// String-keyed record guard (every value must be a string)
// ---------------------------------------------------------------------------

/**
 * Type guard: is the value a Record<string, string>?
 */
export const isStringRecord = (value: unknown): value is Record<string, string> => {
  if (!isRecord(value)) {
    return false;
  }
  for (const v of Object.values(value)) {
    if (typeof v !== 'string') {
      return false;
    }
  }
  return true;
};

// ---------------------------------------------------------------------------
// Safe property access on unknown objects
// ---------------------------------------------------------------------------

/**
 * Read a typed property from an unknown object with a fallback.
 * Uses `in` check for safety — returns `fallback` if the key is absent.
 */
export const safeGet = <T>(obj: unknown, key: string, fallback: T): T => {
  if (isRecord(obj) && key in obj) {
    return obj[key] as T;
  }
  return fallback;
};

/**
 * Read a string property from an unknown object.
 * Returns `undefined` if the key is absent or the value is not a string.
 */
export const safeGetString = (obj: unknown, key: string): string | undefined => {
  if (isRecord(obj) && key in obj) {
    const val = obj[key];
    return typeof val === 'string' ? val : undefined;
  }
  return undefined;
};

/**
 * Read a number property from an unknown object.
 * Returns `undefined` if the key is absent or the value is not a number.
 */
export const safeGetNumber = (obj: unknown, key: string): number | undefined => {
  if (isRecord(obj) && key in obj) {
    const val = obj[key];
    return typeof val === 'number' ? val : undefined;
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// JSON.parse wrapper — returns `unknown` so callers must narrow
// ---------------------------------------------------------------------------

/**
 * JSON.parse that returns `unknown` instead of `any`.
 * Forces the caller to use a type guard or schema validator.
 */
export const parseJson = (text: string): unknown => JSON.parse(text) as unknown;

// ---------------------------------------------------------------------------
// bitECS component record guard
// ---------------------------------------------------------------------------

/**
 * Type guard: is the value a Record<string, Array<unknown>>?
 * bitECS stores component data in SoA (Structure of Arrays) where each field
 * is a plain Array. This guard verifies the shape at runtime.
 */
export const isComponentRecord = (value: unknown): value is Record<string, Array<unknown>> => {
  if (!isRecord(value)) {
    return false;
  }
  for (const v of Object.values(value)) {
    if (!Array.isArray(v)) {
      return false;
    }
  }
  return true;
};
