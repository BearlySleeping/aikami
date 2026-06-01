/** biome-ignore-all lint/suspicious/noExplicitAny: Type.Unsafe<any> required for Firestore-specific types */
// packages/shared/schemas/src/lib/database/user.ts
import Type, { Composite } from 'typebox';
import {
  FirebaseAuthMetadataSchema,
  SignInProviderSchema,
  UserClaimsSchema,
  UserRoleSchema,
} from '../auth.ts';
import { CountryCodeSchema } from '../common/position.ts';
import { CoreOmitKeys, CoreSchema } from '../core.ts';
import { FieldValueSchema, TimestampSchema } from '../fields.ts';
import { getDeletableFields } from '../utils.ts';

/** The user data in firebase auth */
export const UserSessionSchema = Composite(
  Composite(UserClaimsSchema, FirebaseAuthMetadataSchema),
  Type.Object({ currentSignInProvider: SignInProviderSchema }),
);

/** The user data in firebase auth */
export const UserLiteSchema = Composite(
  UserSessionSchema,
  Type.Object({
    createdAt: Type.Union([TimestampSchema, Type.Unsafe<any>(Type.Any())]),
    signInProviders: Type.Optional(Type.Array(SignInProviderSchema)),
  }),
);

export const UserSchema = Composite(
  Composite(Type.Omit(UserLiteSchema, ['createdAt', 'currentSignInProvider']), CoreSchema),
  Type.Object({
    agreedAt: Type.Optional(TimestampSchema),
    connectedEmails: Type.Optional(Type.Array(Type.String())),
    countryCode: Type.Optional(CountryCodeSchema),
    firstName: Type.Optional(Type.String()),
    lastName: Type.Optional(Type.String()),
    localeCode: Type.Optional(Type.String()),
    monthlyUploadedDuration: Type.Optional(Type.Number()),
  }),
);

export const UserCreateSchema = Type.Intersect([
  Type.Omit(UserSchema, [...CoreOmitKeys]),
  Type.Object({ createdAt: Type.Optional(FieldValueSchema) }),
  Type.Object({
    agreedAt: Type.Union([UserSchema.properties.agreedAt as Type.TSchema, FieldValueSchema]),
  }),
]);

export const UserUpdateSchema = Type.Intersect([
  Type.Omit(UserSchema, [...CoreOmitKeys]),
  Type.Object(getDeletableFields(UserSchema as unknown as Record<string, unknown>)),
  Type.Object({ updatedAt: FieldValueSchema }),
]);

export const UserLiteCreateSchema = Type.Object({
  displayName: Type.Optional(Type.String()),
  email: Type.String({ format: 'email' }),
  errorMessage: Type.Optional(Type.String()),
  userRole: UserRoleSchema,
});
