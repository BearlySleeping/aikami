// packages/shared/schemas/src/lib/fields.ts
import Type from 'typebox';

/**
 * Schema for Firestore Timestamp or Date values.
 * Uses Type.Unsafe to bypass JSON Schema validation for Firestore-specific types.
 */
export const TimestampSchema = Type.Unsafe<any>(Type.Any());

/**
 * Schema for Firestore FieldValue (sentinel values like serverTimestamp).
 * Uses Type.Unsafe to bypass JSON Schema validation for Firestore-specific types.
 */
export const FieldValueSchema = Type.Unsafe<any>(Type.Any());

/**
 * Schema for Firestore GeoPoint.
 * Uses Type.Unsafe to bypass JSON Schema validation for Firestore-specific types.
 */
export const GeoPointSchema = Type.Unsafe<any>(Type.Any());

/**
 * Universal value schema accepting string or number.
 */
export const UniversalValueSchema = Type.Union([Type.String(), Type.Number()]);
