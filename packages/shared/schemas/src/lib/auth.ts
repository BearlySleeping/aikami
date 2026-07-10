/** biome-ignore-all lint/style/useNamingConvention: Google/Microsoft API uses snake_case fields */
// packages/shared/schemas/src/lib/auth.ts
import Type, { Composite } from 'typebox';
import { SupportedLocaleSchema } from './common/preference.ts';

export const FirebaseAuthMetadataSchema = Type.Object({
  displayName: Type.Optional(Type.String()),
  email: Type.Optional(Type.String({ format: 'email' })),
  phoneNumber: Type.Optional(Type.String()),
  photoURL: Type.Optional(Type.String()),
});

export type FirebaseAuthMetadata = Type.Static<typeof FirebaseAuthMetadataSchema>;
export const SignInSocialProviderSchema = Type.Union([
  Type.Literal('google'),
  Type.Literal('github'),
]);

export type SignInSocialProvider = Type.Static<typeof SignInSocialProviderSchema>;
export const SignInProviderSchema = Type.Union([Type.Literal('email'), SignInSocialProviderSchema]);

export type SignInProvider = Type.Static<typeof SignInProviderSchema>;
export const UserMetadataSchema = Type.Object({
  firstName: Type.Optional(Type.String()),
  lastName: Type.Optional(Type.String()),
  localeCode: Type.Optional(Type.String()),
  phoneNumber: Type.Optional(Type.String()),
  photoURL: Type.Optional(Type.String()),
});

export type UserMetadata = Type.Static<typeof UserMetadataSchema>;
export const RegisterDataSchema = Type.Object({
  email: Type.String(),
  signInProvider: SignInProviderSchema,
  uid: Type.Optional(Type.String()),
  userMetadata: Type.Optional(UserMetadataSchema),
});

export type RegisterData = Type.Static<typeof RegisterDataSchema>;
export const GoogleMetadataSchema = Type.Object({
  email: Type.Optional(Type.String()),
  family_name: Type.Optional(Type.String()),
  given_name: Type.Optional(Type.String()),
  locale: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  picture: Type.Optional(Type.String()),
  verified_email: Type.Optional(Type.Boolean()),
});

export type GoogleMetadata = Type.Static<typeof GoogleMetadataSchema>;
export const MicrosoftMetadataSchema = Type.Object({
  email: Type.Optional(Type.String()),
  family_name: Type.Optional(Type.String()),
  given_name: Type.Optional(Type.String()),
  locale: Type.Optional(Type.String()),
  name: Type.Optional(Type.String()),
  picture: Type.Optional(Type.String()),
  verified_email: Type.Optional(Type.Boolean()),
});

export type MicrosoftMetadata = Type.Static<typeof MicrosoftMetadataSchema>;
// userRoles = ['member', 'superAdmin'] as const
export const UserRoleSchema = Type.Union([Type.Literal('member'), Type.Literal('superAdmin')]);

export type UserRole = Type.Static<typeof UserRoleSchema>;
// firebaseSignInProviderNames = ['google', 'github'] as const
export const FirebaseSignInProviderNameSchema = Type.Union([
  Type.Literal('google'),
  Type.Literal('github'),
]);

export type FirebaseSignInProviderName = Type.Static<typeof FirebaseSignInProviderNameSchema>;
export const UserStatusSchema = Type.Union([
  Type.Literal('unconfirmed-terms'),
  Type.Literal('active'),
]);

export type UserStatus = Type.Static<typeof UserStatusSchema>;
export const UserTokenSchema = Type.Object({
  isBetaTester: Type.Optional(Type.Literal(true)),
  preferredLocale: Type.Optional(SupportedLocaleSchema),
  status: Type.Optional(UserStatusSchema),
  userRole: Type.Optional(UserRoleSchema),
});

export type UserToken = Type.Static<typeof UserTokenSchema>;
export const UserClaimsSchema = Composite(UserTokenSchema, Type.Object({ id: Type.String() }));

export type UserClaims = Type.Static<typeof UserClaimsSchema>;
