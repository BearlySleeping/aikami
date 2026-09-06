// .pi/guidance/examples/data_boundary_canonical.ts
//
// Canonical external-data boundary: parse unknown input against a schema,
// return typed output or undefined. This avoids `as unknown as X` / `as any`
// by validating before casting. For cross-project shapes, use a TypeBox
// schema in @aikami/schemas and derive the type via Static<typeof Schema>.
//
// ✅ executable: compiles and lints under the scripts project configuration.

export type UserProfile = {
  readonly id: string;
  readonly displayName: string;
  readonly level: number;
};

/**
 * Safely parses an unknown value into a UserProfile.
 * Returns undefined when the shape does not match expectations —
 * the caller decides how to handle absence.
 */
export const parseUserProfile = (value: unknown): UserProfile | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.id !== 'string' || record.id.length === 0) {
    return undefined;
  }
  if (typeof record.displayName !== 'string') {
    return undefined;
  }
  if (typeof record.level !== 'number' || !Number.isFinite(record.level)) {
    return undefined;
  }

  return {
    id: record.id,
    displayName: record.displayName,
    level: record.level,
  };
};

/**
 * Convenience wrapper that throws on invalid input.
 */
export const parseUserProfileOrThrow = (value: unknown): UserProfile => {
  const result = parseUserProfile(value);
  if (result === undefined) {
    throw new Error('Invalid UserProfile input');
  }
  return result;
};
