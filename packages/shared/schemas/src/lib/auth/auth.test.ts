import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
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
    const result = Value.Parse(FirebaseAuthMetadataSchema, validData);
    expect(result.displayName).toBe('John Doe');
    expect(result.email).toBe('john@example.com');
  });

  test('should parse with all optional fields undefined', () => {
    const validData = {};
    const result = Value.Parse(FirebaseAuthMetadataSchema, validData);
    expect(result.displayName).toBeUndefined();
  });
});

describe('SignInSocialProviderSchema', () => {
  test('should parse google provider', () => {
    expect(Value.Parse(SignInSocialProviderSchema, 'google')).toBe('google');
  });

  test('should parse github provider', () => {
    expect(Value.Parse(SignInSocialProviderSchema, 'github')).toBe('github');
  });

  test('should reject invalid provider', () => {
    expect(() => Value.Parse(SignInSocialProviderSchema, 'facebook')).toThrow();
  });
});

describe('SignInProviderSchema', () => {
  test('should parse email provider', () => {
    expect(Value.Parse(SignInProviderSchema, 'email')).toBe('email');
  });

  test('should parse social providers', () => {
    expect(Value.Parse(SignInProviderSchema, 'google')).toBe('google');
    expect(Value.Parse(SignInProviderSchema, 'github')).toBe('github');
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
    const result = Value.Parse(UserMetadataSchema, validData);
    expect(result.firstName).toBe('John');
    expect(result.lastName).toBe('Doe');
  });

  test('should parse with empty object', () => {
    const result = Value.Parse(UserMetadataSchema, {});
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
    const result = Value.Parse(RegisterDataSchema, validData);
    expect(result.email).toBe('john@example.com');
    expect(result.signInProvider).toBe('email');
  });

  test('should parse register data with any string email', () => {
    const validData = {
      email: 'not-an-email',
      signInProvider: 'email',
    };
    const result = Value.Parse(RegisterDataSchema, validData);
    expect(result.email).toBe('not-an-email');
  });
});

describe('GoogleMetadataSchema', () => {
  test('should parse valid google metadata', () => {
    const validData = {
      email: 'john@gmail.com',
      // biome-ignore lint/style/useNamingConvention: Google API field name
      family_name: 'Doe',
      // biome-ignore lint/style/useNamingConvention: Google API field name
      given_name: 'John',
      locale: 'en',
      name: 'John Doe',
      picture: 'https://example.com/photo.jpg',
      // biome-ignore lint/style/useNamingConvention: Google API field name
      verified_email: true,
    };
    const result = Value.Parse(GoogleMetadataSchema, validData);
    expect(result.email).toBe('john@gmail.com');
    expect(result.verified_email).toBe(true);
  });
});

describe('MicrosoftMetadataSchema', () => {
  test('should parse valid microsoft metadata', () => {
    const validData = {
      email: 'john@outlook.com',
      // biome-ignore lint/style/useNamingConvention: Microsoft API field name
      family_name: 'Doe',
      // biome-ignore lint/style/useNamingConvention: Microsoft API field name
      given_name: 'John',
      locale: 'en',
      name: 'John Doe',
      picture: 'https://example.com/photo.jpg',
      // biome-ignore lint/style/useNamingConvention: Microsoft API field name
      verified_email: true,
    };
    const result = Value.Parse(MicrosoftMetadataSchema, validData);
    expect(result.email).toBe('john@outlook.com');
  });
});

describe('UserRoleSchema', () => {
  test('should parse member role', () => {
    expect(Value.Parse(UserRoleSchema, 'member')).toBe('member');
  });

  test('should parse superAdmin role', () => {
    expect(Value.Parse(UserRoleSchema, 'superAdmin')).toBe('superAdmin');
  });

  test('should reject invalid role', () => {
    expect(() => Value.Parse(UserRoleSchema, 'admin')).toThrow();
  });
});

describe('FirebaseSignInProviderNameSchema', () => {
  test('should parse google provider name', () => {
    expect(Value.Parse(FirebaseSignInProviderNameSchema, 'google')).toBe('google');
  });

  test('should parse github provider name', () => {
    expect(Value.Parse(FirebaseSignInProviderNameSchema, 'github')).toBe('github');
  });
});

describe('UserStatusSchema', () => {
  test('should parse unconfirmed-terms status', () => {
    expect(Value.Parse(UserStatusSchema, 'unconfirmed-terms')).toBe('unconfirmed-terms');
  });

  test('should parse active status', () => {
    expect(Value.Parse(UserStatusSchema, 'active')).toBe('active');
  });

  test('should reject invalid status', () => {
    expect(() => Value.Parse(UserStatusSchema, 'pending')).toThrow();
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
    const result = Value.Parse(UserTokenSchema, validData);
    expect(result.isBetaTester).toBe(true);
    expect(result.preferredLocale).toBe('en');
    expect(result.status).toBe('active');
    expect(result.userRole).toBe('member');
  });

  test('should parse with all optional fields undefined', () => {
    const validData = {};
    const result = Value.Parse(UserTokenSchema, validData);
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
    const result = Value.Parse(UserClaimsSchema, validData);
    expect(result.id).toBe('user-123');
    expect(result.userRole).toBe('member');
  });

  test('should reject without id', () => {
    const invalidData = {
      userRole: 'member',
    };
    expect(() => Value.Parse(UserClaimsSchema, invalidData)).toThrow();
  });
});
