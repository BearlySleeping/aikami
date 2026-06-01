// packages/shared/schemas/src/lib/api/oauth.ts
import Type from 'typebox';
import { FieldValueSchema, TimestampSchema, UniversalValueSchema } from '../fields.ts';

/**
 * The user role in the CRM.
 */
export const OAuthRoleSchema = Type.Union([
  Type.Literal('admin'),
  Type.Literal('member'),
  Type.Literal('creator'),
]);

/** Represents OAuth profile data. */
export const OAuthProfileDataSchema = Type.Object({
  /** The account ID of the user. */
  accountId: UniversalValueSchema,

  /** The email of the user. */
  email: Type.Optional(Type.String()),

  /** The metadata associated with the user. */
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),

  /** The name of the user. */
  name: Type.Optional(Type.String()),

  /** The phone number of the user. */
  phoneNumber: Type.Optional(Type.String()),

  /** The photo URL of the user. */
  photoURL: Type.Optional(Type.String()),

  /**
   * The unique identifier for the user in the tenant.
   */
  tenantId: Type.Optional(UniversalValueSchema),

  /** The name of the tenant. */
  tenantName: Type.Optional(Type.String()),

  /** The role of the user in CRM. */
  userRole: OAuthRoleSchema,
});

export const OAuthValidationSchema = Type.Object({
  /** The oauth2 access token. */
  accessToken: Type.String(),
  /**
   * A timestamp of when the user's token was first created.
   */
  createdAt: TimestampSchema,
  /**
   * A timestamp of when the user's refresh token will expire.
   */
  expiresAt: TimestampSchema,
  /**
   * If the access token is expired / invalid then this will be true.
   */
  needsReAuthentication: Type.Optional(Type.Boolean()),
  /** the redirect url for when the user verified their account. */
  redirectURI: Type.String(),
  /** The oauth2 refresh token. */
  refreshToken: Type.String(),
});

export const OAuthExecuteSchema = Type.Intersect([
  Type.Omit(OAuthValidationSchema, ['createdAt']),
  OAuthProfileDataSchema,
]);

export const OAuthProviderLiteSchema = Type.Intersect([
  OAuthProfileDataSchema,
  Type.Omit(OAuthValidationSchema, ['createdAt', 'expiresAt']),
]);

export const OAuthProviderSchema = Type.Intersect([OAuthProfileDataSchema, OAuthValidationSchema]);

export const OAuthProviderCreateSchema = Type.Intersect([
  Type.Omit(OAuthProviderSchema, ['createdAt', 'expiresAt']),
  Type.Object({
    createdAt: FieldValueSchema,
    expiresAt: FieldValueSchema,
  }),
]);

export const OAuthProviderUpdateSchema = Type.Intersect([
  Type.Omit(OAuthProviderSchema, [
    'accountId',
    'createdAt',
    'expiresAt',
    'redirectURI',
    'refreshToken',
  ]),
  Type.Object({
    expiresAt: TimestampSchema,
    refreshToken: Type.Optional(Type.String()),
  }),
]);

export const OAuthProvidersSchema = Type.Optional(Type.Record(Type.String(), OAuthProviderSchema));

export const OAuthProvidersLiteSchema = Type.Optional(
  Type.Record(Type.String(), OAuthProfileDataSchema),
);

export const OAuthProvidersCreateSchema = Type.Optional(OAuthProviderCreateSchema);

export const OAuthProvidersUpdateSchema = Type.Optional(OAuthProviderUpdateSchema);
