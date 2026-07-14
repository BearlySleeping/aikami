import { describe, expect, test } from 'bun:test';
import Type from 'typebox';
import { getDeletableFields } from './utils.ts';

describe('getDeletableFields', () => {
  test('should return deletable fields for optional string fields', () => {
    const testSchema = Type.Object({
      requiredField: Type.String(),
      optionalField: Type.Optional(Type.String()),
    });

    const result = getDeletableFields(testSchema);

    expect(result).toHaveProperty('optionalField');
    expect(result.optionalField).toBeDefined();
  });

  test('should not include required fields', () => {
    const testSchema = Type.Object({
      requiredField: Type.String(),
      optionalField: Type.Optional(Type.String()),
    });

    const result = getDeletableFields(testSchema);

    expect(result).not.toHaveProperty('requiredField');
  });

  test('should make optional fields union with FieldValueSchema', () => {
    const testSchema = Type.Object({
      optionalField: Type.Optional(Type.String()),
    });

    const result = getDeletableFields(testSchema);
    expect(result).toHaveProperty('optionalField');
  });

  test('should handle multiple optional fields', () => {
    const testSchema = Type.Object({
      required: Type.String(),
      opt1: Type.Optional(Type.String()),
      opt2: Type.Optional(Type.Number()),
      opt3: Type.Optional(Type.Boolean()),
    });

    const result = getDeletableFields(testSchema);

    expect(Object.keys(result).length).toBe(3);
    expect(result).toHaveProperty('opt1');
    expect(result).toHaveProperty('opt2');
    expect(result).toHaveProperty('opt3');
  });
});
