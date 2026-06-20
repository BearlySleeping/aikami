import { describe, expect, test } from 'bun:test';
import Type from 'typebox';
import { Value } from 'typebox/value';
import {
  CoreCreateSchema,
  CoreFormSchema,
  CoreSchema,
  CoreUpdateSchema,
  makeOptionalFieldsToServerDelete,
} from './core.ts';

describe('CoreSchema', () => {
  test('should parse valid core data', () => {
    const validData = {
      id: 'test-id-123',
      createdAt: {
        seconds: 1700000000,
        nanoseconds: 0,
        toDate: () => new Date(),
        toMillis: () => 1700000000000,
      },
      updatedAt: {
        seconds: 1700000000,
        nanoseconds: 0,
        toDate: () => new Date(),
        toMillis: () => 1700000000000,
      },
      priority: 1,
    };
    const result = Value.Parse(CoreSchema, validData);
    expect(result.id).toBe('test-id-123');
    expect(result.priority).toBe(1);
  });

  test('should parse with optional createdAt as null', () => {
    const validData = {
      id: 'test-id-123',
      createdAt: null,
      updatedAt: null,
    };
    const result = Value.Parse(CoreSchema, validData);
    expect(result.id).toBe('test-id-123');
    expect(result.createdAt).toBeNull();
  });

  test('should reject missing id', () => {
    const invalidData = {
      createdAt: {
        seconds: 1700000000,
        nanoseconds: 0,
        toDate: () => new Date(),
        toMillis: () => 1700000000000,
      },
    };
    expect(() => Value.Assert(CoreSchema, invalidData)).toThrow();
  });
});

describe('CoreFormSchema', () => {
  test('should parse with optional id', () => {
    const withId = { id: 'test-id' };
    const result = Value.Parse(CoreFormSchema, withId);
    expect(result.id).toBe('test-id');

    const withoutId = {};
    const result2 = Value.Parse(CoreFormSchema, withoutId);
    expect(result2.id).toBeUndefined();
  });
});

describe('CoreCreateSchema', () => {
  test('should parse valid create data', () => {
    const validData = {
      createdAt: { seconds: 1700000000, nanoseconds: 0 },
      priority: 1,
    };
    const result = Value.Parse(CoreCreateSchema, validData);
    expect(result.priority).toBe(1);
  });

  test('should allow optional createdAt', () => {
    const validData = { priority: 1 };
    const result = Value.Parse(CoreCreateSchema, validData);
    expect(result.priority).toBe(1);
  });
});

describe('CoreUpdateSchema', () => {
  test('should parse valid update data', () => {
    const validData = {
      updatedAt: { seconds: 1700000000, nanoseconds: 0 },
      priority: 1,
    };
    const result = Value.Parse(CoreUpdateSchema, validData);
    expect(result.priority).toBe(1);
  });
});

describe('makeOptionalFieldsToServerDelete', () => {
  test('should make optional fields deletable', () => {
    const testSchema = Type.Object({
      requiredField: Type.String(),
      optionalField: Type.Optional(Type.String()),
    });

    const resultSchema = makeOptionalFieldsToServerDelete(testSchema);

    const validData = {
      requiredField: 'test',
    };
    const result = Value.Parse(resultSchema, validData);
    expect(result.requiredField).toBe('test');
  });
});
