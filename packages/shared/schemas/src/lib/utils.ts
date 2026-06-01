// packages/shared/schemas/src/lib/utils.ts
import Type, { type TSchema } from 'typebox';
import { FieldValueSchema } from './fields.ts';

/**
 * Creates a shape object from a TypeBox schema where optional fields are made "deletable"
 * by allowing them to be a `FieldValue` (e.g., for Firestore's `FieldValue.delete()`).
 *
 * In TypeBox, optionality is tracked via the Object's `required` array rather than
 * per-property flags. This function uses `schema.required` to identify optional fields.
 *
 * @param schema - The input TypeBox object schema (or Intersect/Composite result).
 * @returns A new properties object with optional fields modified, for use with `Type.Object()`.
 */
export const getDeletableFields = (schema: Record<string, unknown>): Record<string, TSchema> => {
  const properties = (schema as { properties?: Record<string, TSchema> }).properties ?? {};
  const requiredSet = new Set((schema as { required?: string[] }).required ?? []);
  const deletableProperties: Record<string, TSchema> = {};

  for (const key in properties) {
    if (!requiredSet.has(key)) {
      const prop = properties[key];
      if (prop) {
        deletableProperties[key] = Type.Union([prop, FieldValueSchema]);
      }
    }
  }

  return deletableProperties;
};
