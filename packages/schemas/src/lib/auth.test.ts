import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import {
  FirebaseAuthMetadataSchema,
  FirebaseSignInProviderNameSchema,
  GoogleMetadataSchema,
  MicrosoftMetadataSchema,
  RegisterDataSchema,
  SignInProviderSchema,
  SignInSocialProviderSchema,
  UserClaimsSchema,
  UserMetadataSchema,
  UserRoleSchema,
  UserStatusSchema,
  UserTokenSchema,
} from './auth.ts';

describe('FirebaseAuthMetadataSchema', () => {
  test('should parse valid firebase auth metadata', () => {
    const validData = {
      displayName: 'John Doe',
      email: 'john@example.com',
      phoneNumber: '+1234567890',
      photoURL: 'https://example.com/photo.jpg',
    };
    const result = FirebaseAuthMetadataSchema.parse(validData);
    expect(result.displayName).toBe('John Doe');
    expect(result.email).toBe('john@example.com');
  });

  test('should parse with all optional fields undefined', () => {
    const validData = {};
    const result = FirebaseAuthMetadataSchema.parse(validData);
    expect(result.displayName).toBeUndefined();
  });
});

describe('SignInSocialProviderSchema', () => {
  test('should parse google provider', () => {
    expect(SignInSocialProviderSchema.parse('google')).toBe('google');
  });

  test('should parse github provider', () => {
    expect(SignInSocialProviderSchema.parse('github')).toBe('github');
  });

  test('should reject invalid provider', () => {
    expect(() => SignInSocialProviderSchema.parse('facebook')).toThrow(z.ZodError);
  });
});

describe('SignInProviderSchema', () => {
  test('should parse email provider', () => {
    expect(SignInProviderSchema.parse('email')).toBe('email');
  });

  test('should parse social providers', () => {
    expect(SignInProviderSchema.parse('google')).toBe('google');
    expect(SignInProviderSchema.parse('github')).toBe('github');
  });
});

describe('UserMetadataSchema', () => {
  test('should parse valid user metadata', () => {
    const validData = {
      firstName: 'John',
      lastName: 'Doe',
      localeCode: 'en',
      phoneNumber: '+1234567890',
      photoURL: 'https://example.com/photo.jpg',
    };
    const result = UserMetadataSchema.parse(validData);
    expect(result.firstName).toBe('John');
    expect(result.lastName).toBe('Doe');
  });

  test('should parse with empty object', () => {
    const result = UserMetadataSchema.parse({});
    expect(result.firstName).toBeUndefined();
  });
});

describe('RegisterDataSchema', () => {
  test('should parse valid register data', () => {
    const validData = {
      email: 'john@example.com',
      signInProvider: 'email',
      uid: 'user-123',
      userMetadata: {
        firstName: 'John',
      },
    };
    const result = RegisterDataSchema.parse(validData);
    expect(result.email).toBe('john@example.com');
    expect(result.signInProvider).toBe('email');
  });

  test('should parse register data with any string email', () => {
    const validData = {
      email: 'not-an-email',
      signInProvider: 'email',
    };
    const result = RegisterDataSchema.parse(validData);
    expect(result.email).toBe('not-an-email');
  });
});

describe('GoogleMetadataSchema', () => {
  test('should parse valid google metadata', () => {
    const validData = {
      email: 'john@gmail.com',
      family_name: 'Doe',
      given_name: 'John',
      locale: 'en',
      name: 'John Doe',
      picture: 'https://example.com/photo.jpg',
      verified_email: true,
    };
    const result = GoogleMetadataSchema.parse(validData);
    expect(result.email).toBe('john@gmail.com');
    expect(result.verified_email).toBe(true);
  });
});

describe('MicrosoftMetadataSchema', () => {
  test('should parse valid microsoft metadata', () => {
    const validData = {
      email: 'john@outlook.com',
      family_name: 'Doe',
      given_name: 'John',
      locale: 'en',
      name: 'John Doe',
      picture: 'https://example.com/photo.jpg',
      verified_email: true,
    };
    const result = MicrosoftMetadataSchema.parse(validData);
    expect(result.email).toBe('john@outlook.com');
  });
});

describe('UserRoleSchema', () => {
  test('should parse member role', () => {
    expect(UserRoleSchema.parse('member')).toBe('member');
  });

  test('should parse superAdmin role', () => {
    expect(UserRoleSchema.parse('superAdmin')).toBe('superAdmin');
  });

  test('should reject invalid role', () => {
    expect(() => UserRoleSchema.parse('admin')).toThrow(z.ZodError);
  });
});

describe('FirebaseSignInProviderNameSchema', () => {
  test('should parse google provider name', () => {
    expect(FirebaseSignInProviderNameSchema.parse('google')).toBe('google');
  });

  test('should parse github provider name', () => {
    expect(FirebaseSignInProviderNameSchema.parse('github')).toBe('github');
  });
});

describe('UserStatusSchema', () => {
  test('should parse unconfirmed-terms status', () => {
    expect(UserStatusSchema.parse('unconfirmed-terms')).toBe('unconfirmed-terms');
  });

  test('should parse active status', () => {
    expect(UserStatusSchema.parse('active')).toBe('active');
  });

  test('should reject invalid status', () => {
    expect(() => UserStatusSchema.parse('pending')).toThrow(z.ZodError);
  });
});

describe('UserTokenSchema', () => {
  test('should parse valid token data', () => {
    const validData = {
      isBetaTester: true,
      preferredLocale: 'en',
      status: 'active',
      userRole: 'member',
    };
    const result = UserTokenSchema.parse(validData);
    expect(result.isBetaTester).toBe(true);
    expect(result.preferredLocale).toBe('en');
    expect(result.status).toBe('active');
    expect(result.userRole).toBe('member');
  });

  test('should parse with all optional fields undefined', () => {
    const validData = {};
    const result = UserTokenSchema.parse(validData);
    expect(result.isBetaTester).toBeUndefined();
    expect(result.preferredLocale).toBeUndefined();
  });
});

describe('UserClaimsSchema', () => {
  test('should parse valid claims with id', () => {
    const validData = {
      id: 'user-123',
      userRole: 'member',
    };
    const result = UserClaimsSchema.parse(validData);
    expect(result.id).toBe('user-123');
    expect(result.userRole).toBe('member');
  });

  test('should reject without id', () => {
    const invalidData = {
      userRole: 'member',
    };
    expect(() => UserClaimsSchema.parse(invalidData)).toThrow(z.ZodError);
  });
});
