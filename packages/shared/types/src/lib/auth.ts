import type {
  FirebaseSignInProviderNameSchema,
  SignInProviderSchema,
  SignInSocialProviderSchema,
  UserClaimsSchema,
  UserRoleSchema,
  UserStatusSchema,
  UserTokenSchema,
} from '@aikami/schemas';
import type { z } from 'zod';

export type SignInSocialProvider = z.infer<typeof SignInSocialProviderSchema>;

export type SignInProvider = z.infer<typeof SignInProviderSchema>;

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

export type FirebaseSignInProviderName = z.infer<typeof FirebaseSignInProviderNameSchema>;

export type UserClaims = z.infer<typeof UserClaimsSchema>;

export type UserRole = z.infer<typeof UserRoleSchema>;
/**
 * The status of the user.
 *
 * If this is 'unconfirmed-terms' then the user has not confirmed the terms
 *
 * TODO: add more statuses
 */
export type UserStatus = z.infer<typeof UserStatusSchema>;

export type UserTokenData = z.infer<typeof UserTokenSchema>;
