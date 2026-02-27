import { unixLabel } from '@aikami/constants';
import type { CoreData } from '@aikami/types';
import { Timestamp } from 'firebase/firestore';

/**
 * Converts json data back to Timestamp instances.
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
      transformedData[key.replace(unixLabel, '')] = Timestamp.fromMillis(value);
      continue;
    }

    transformedData[key] = value;
  }
  return transformedData as unknown as T;
};

export const getValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((value) => {
      return getValue(value);
    });
  }

  if (typeof value === 'object' && value !== null) {
    return fromJsonData(value as Record<string, unknown>);
  }

  return value;
};
