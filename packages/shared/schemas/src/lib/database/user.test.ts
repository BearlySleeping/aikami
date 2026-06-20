import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import {
  UserCreateSchema,
  UserLiteCreateSchema,
  UserLiteSchema,
  UserSchema,
  UserSessionSchema,
  UserUpdateSchema,
} from './user.ts';

describe('UserSessionSchema', () => {
  test('should parse valid user session data', () => {
    const validData = {
      id: 'user-123',
      isBetaTester: true,
      preferredLocale: 'en',
      status: 'active',
      userRole: 'member',
      displayName: 'John Doe',
      email: 'john@example.com',
      currentSignInProvider: 'google',
    };
    const result = Value.Parse(UserSessionSchema, validData);
    expect(result.id).toBe('user-123');
    expect(result.userRole).toBe('member');
  });
});

describe('UserLiteSchema', () => {
  test('should parse valid user lite data', () => {
    const validData = {
      id: 'user-123',
      displayName: 'John Doe',
      email: 'john@example.com',
      currentSignInProvider: 'google',
      createdAt: {
        seconds: 1700000000,
        nanoseconds: 0,
        toDate: () => new Date(),
        toMillis: () => 1700000000000,
      },
    };
    const result = Value.Parse(UserLiteSchema, validData);
    expect(result.id).toBe('user-123');
  });
});

describe('UserSchema', () => {
  test('should parse valid user data', () => {
    const validData = {
      id: 'user-123',
      displayName: 'John Doe',
      email: 'john@example.com',
      currentSignInProvider: 'google',
      createdAt: {
        seconds: 1700000000,
        nanoseconds: 0,
        toDate: () => new Date(),
        toMillis: () => 1700000000000,
      },
      firstName: 'John',
      lastName: 'Doe',
      countryCode: 'US',
      localeCode: 'en',
    };
    const result = Value.Parse(UserSchema, validData);
    expect(result.id).toBe('user-123');
    expect(result.firstName).toBe('John');
  });

  test('should parse with optional fields undefined', () => {
    const validData = {
      id: 'user-123',
      displayName: 'John Doe',
      email: 'john@example.com',
      currentSignInProvider: 'google',
      createdAt: {
        seconds: 1700000000,
        nanoseconds: 0,
        toDate: () => new Date(),
        toMillis: () => 1700000000000,
      },
    };
    const result = Value.Parse(UserSchema, validData);
    expect(result.firstName).toBeUndefined();
    expect(result.countryCode).toBeUndefined();
  });
});

describe('UserCreateSchema', () => {
  test('should parse valid user create data', () => {
    const validData = {
      displayName: 'John Doe',
      email: 'john@example.com',
      currentSignInProvider: 'google',
      createdAt: { seconds: 1700000000, nanoseconds: 0 },
      firstName: 'John',
    };
    const result = Value.Parse(UserCreateSchema, validData);
    expect(result.firstName).toBe('John');
  });

  test('should parse with only optional fields', () => {
    const data = {
      displayName: 'John Doe',
    };
    const result = Value.Parse(UserCreateSchema, data);
    expect(result.displayName).toBe('John Doe');
  });
});

describe('UserUpdateSchema', () => {
  test('should parse valid user update data', () => {
    const validData = {
      updatedAt: { seconds: 1700000000, nanoseconds: 0 },
      firstName: 'John Updated',
    };
    const result = Value.Parse(UserUpdateSchema, validData);
    expect(result.firstName).toBe('John Updated');
  });
});

describe('UserLiteCreateSchema', () => {
  test('should parse valid user lite create data', () => {
    const validData = {
      displayName: 'John Doe',
      email: 'john@example.com',
      userRole: 'member',
    };
    const result = Value.Parse(UserLiteCreateSchema, validData);
    expect(result.email).toBe('john@example.com');
    expect(result.userRole).toBe('member');
  });

  test('should reject invalid email', () => {
    const invalidData = {
      displayName: 'John Doe',
      email: 'not-an-email',
      userRole: 'member',
    };
    expect(() => Value.Parse(UserLiteCreateSchema, invalidData)).toThrow();
  });
});
