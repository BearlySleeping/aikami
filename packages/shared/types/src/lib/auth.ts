/** biome-ignore-all lint/style/useNamingConvention: Firebase Auth API uses snake_case fields */
// packages/shared/types/src/lib/auth.ts
//
// Schema-derived names re-exported from @aikami/schemas; hand-authored types remain.

import type {
  FirebaseSignInProviderName,
  SignInProvider,
  SignInSocialProvider,
  UserClaims,
  UserRole,
  UserStatus,
  UserToken,
} from '@aikami/schemas';

export type {
  FirebaseSignInProviderName,
  SignInProvider,
  SignInSocialProvider,
  UserClaims,
  UserRole,
  UserStatus,
  UserToken as UserTokenData,
};

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
