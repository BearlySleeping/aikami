// packages/shared/schemas/src/lib/core.ts
import Type, { type TObject, type TProperties, type TSchema } from 'typebox';
import { FieldValueSchema, TimestampSchema } from '../common/fields.ts';

export const CoreFormSchema = Type.Object({
  id: Type.Optional(Type.String()),
});

export type CoreForm = Type.Static<typeof CoreFormSchema>;
export const CoreSchema = Type.Object({
  createdAt: Type.Optional(Type.Union([TimestampSchema, Type.Null()])),
  id: Type.String(),
  priority: Type.Optional(Type.Number()),
  updatedAt: Type.Optional(Type.Union([TimestampSchema, Type.Null()])),
});

export type Core = Type.Static<typeof CoreSchema>;
export const CoreOmitKeys = ['id', 'createdAt', 'updatedAt'] as const;

export const CoreCreateSchema = Type.Intersect([
  Type.Omit(CoreSchema, [...CoreOmitKeys]),
  Type.Object({ createdAt: Type.Optional(FieldValueSchema) }),
]);

export type CoreCreate = Type.Static<typeof CoreCreateSchema>;
export const CoreUpdateSchema = Type.Intersect([
  Type.Omit(CoreSchema, [...CoreOmitKeys]),
  Type.Object({ updatedAt: FieldValueSchema }),
]);

export type CoreUpdate = Type.Static<typeof CoreUpdateSchema>;
/**
 * Given an object schema, converts all optional fields to nullable FieldValue
 * for server-side deletion support.
 */
export const makeOptionalFieldsToServerDelete = <Schema extends TObject>(
  schema: Schema,
): TObject => {
  const rawProperties = (schema as TObject).properties as TProperties;
  const required = new Set((schema as TObject).required ?? []);

  const newProperties: Record<string, TSchema> = {};
  for (const [key, value] of Object.entries(rawProperties)) {
    if (!required.has(key)) {
      newProperties[key] = Type.Optional(Type.Union([value as TSchema, FieldValueSchema]));
    } else {
      newProperties[key] = value as TSchema;
    }
  }

  return Type.Object(newProperties);
};
