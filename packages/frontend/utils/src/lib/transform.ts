import { unixLabel } from '@aikami/constants';
import type { CoreData } from '@aikami/types';

/**
 * Converts json data back to timestamp instances.
 *
 * Firestore was removed from the product (C-386); unix-suffixed numeric
 * values are now converted to a plain Date so the shape stays JSON-safe.
 *
 * @param data The data to convert.
 * @returns The converted data.
 */
export const fromJsonData = <T extends Omit<CoreData, 'createdAt'>>(
  data: Record<string, unknown>,
): T => {
  const transformedData: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      transformedData[key] = value.map(getValue);
      continue;
    }

    if (typeof value === 'object' && value !== null) {
      transformedData[key] = fromJsonData(value as Record<string, unknown>);
      continue;
    }

    if (key.endsWith(unixLabel) && typeof value === 'number') {
      // Strip only the trailing unixLabel suffix so earlier occurrences in the
      // key (e.g. `lastUnixUpdatedUnix` → `lastUnixUpdated`) are preserved.
      transformedData[key.slice(0, -unixLabel.length)] = new Date(value);
      continue;
    }

    transformedData[key] = value;
  }
  return transformedData as unknown as T; // guard-ignore lint/type-safety/casting: generic transform helper - caller guarantees type safety
};

export const getValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => getValue(item));
  }

  if (typeof value === 'object' && value !== null) {
    return fromJsonData(value as Record<string, unknown>);
  }

  return value;
};
