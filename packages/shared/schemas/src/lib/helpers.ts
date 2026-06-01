// packages/shared/schemas/src/lib/helpers.ts

import type { TObject } from 'typebox';
import Type, { Composite } from 'typebox';

/**
 * Merges multiple TypeBox object schemas into a single flat TObject using
 * Composite chaining. Preserves .properties and .required for downstream
 * utilities like getDeletableFields.
 */
export const mergeSchemas = (schemas: TObject[]): TObject => {
  if (schemas.length === 0) {
    return Type.Object({});
  }
  let result = schemas[0]!;
  for (let i = 1; i < schemas.length; i++) {
    result = Composite(result, schemas[i]!) as unknown as TObject;
  }
  return result;
};

export { Composite };
