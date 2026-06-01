/** biome-ignore-all lint/style/useNamingConvention: Firebase Auth API uses snake_case fields */
// packages/shared/types/src/lib/auth.ts
import type {
  FirebaseSignInProviderNameSchema,
  SignInProviderSchema,
  SignInSocialProviderSchema,
  UserClaimsSchema,
  UserRoleSchema,
  UserStatusSchema,
  UserTokenSchema,
} from '@aikami/schemas';
import type { Type } from 'typebox';

export type SignInSocialProvider = Type.Static<typeof SignInSocialProviderSchema>;

export type SignInProvider = Type.Static<typeof SignInProviderSchema>;

export type UserMetadata = {
  firstName?: string;
  lastName?: string;
  localeCode?: string;
  photoURL?: string;
  phoneNumber?: string;
};

export type RegisterData = {
  email: string;
  signInProvider: SignInProvider;
  userMetadata?: UserMetadata;
  uid?: string;
};

export type GoogleMetadata = {
  given_name?: string;
  family_name?: string;
  locale?: string;
  email?: string;
  picture?: string;
  name?: string;
  verified_email?: boolean;
};

export type MicrosoftMetadata = {
  given_name?: string;
  family_name?: string;
  locale?: string;
  email?: string;
  picture?: string;
  name?: string;
  verified_email?: boolean;
};

export type FirebaseSignInProviderName = Type.Static<typeof FirebaseSignInProviderNameSchema>;

export type UserClaims = Type.Static<typeof UserClaimsSchema>;

export type UserRole = Type.Static<typeof UserRoleSchema>;

export type UserStatus = Type.Static<typeof UserStatusSchema>;

export type UserTokenData = Type.Static<typeof UserTokenSchema>;
