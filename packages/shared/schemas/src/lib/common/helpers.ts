// packages/shared/schemas/src/lib/helpers.ts

import type { TObject } from 'typebox';
import Type, { Composite } from 'typebox';

/**
 * Merges multiple TypeBox object schemas into a single flat TObject using
 * Composite chaining. Preserves .properties and .required for downstream
 * utilities like getDeletableFields.
 */
export const mergeSchemas = (schemas: TObject[]): TObject => {
  const first = schemas[0];
  if (!first) {
    return Type.Object({});
  }
  let result = first;
  for (let i = 1; i < schemas.length; i++) {
    const next = schemas[i];
    if (next) {
      result = Composite(result, next) as unknown as TObject;
    }
  }
  return result;
};

export { Composite };
