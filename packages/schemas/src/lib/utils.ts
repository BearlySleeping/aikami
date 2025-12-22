// deno-lint-ignore-file no-explicit-any
import type { ZodObject, ZodOptional, ZodUnion } from 'zod'
import { FieldValueSchema } from './fields.ts'

/**
 * Creates a shape object from a Zod schema where optional fields are made "deletable"
 * by allowing them to be a `FieldValue` (e.g., for Firestore's `FieldValue.delete()`).
 *
 * This returns a type-safe object with specific keys, avoiding type inference issues with `z.extend`.
 *
 * @param schema The input Zod object schema.
 * @returns A new shape object with optional fields modified, for use with `.extend()`.
 */
export function getDeletableFields<T extends ZodObject<any>>(
  schema: T,
): {
  [
    K in keyof T['shape'] as T['shape'][K] extends ZodOptional<any> ? K
      : never
  ]: ZodUnion<[T['shape'][K], typeof FieldValueSchema]>
} {
  const shape = schema.shape
  const deletableShape: any = {}

  for (const key in shape) {
    const field = shape[key]

    if (field.isOptional()) {
      deletableShape[key] = field.or(FieldValueSchema)
    }
  }

  return deletableShape as any
}
