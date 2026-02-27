import { z } from 'zod';
import {
  FirebaseAuthMetadataSchema,
  SignInProviderSchema,
  UserClaimsSchema,
  UserRoleSchema,
} from '../auth.ts';
import { CountryCodeSchema } from '../common/position.ts';
import { CoreCreateSchema, CoreOmitSchema, CoreSchema, CoreUpdateSchema } from '../core.ts';
import { FieldValueSchema, TimestampSchema } from '../fields.ts';
import { getDeletableFields } from '../utils.ts';

/** The user data in firebase auth */
export const UserSessionSchema = UserClaimsSchema.extend(FirebaseAuthMetadataSchema.shape).extend({
  currentSignInProvider: SignInProviderSchema,
});

/** The user data in firebase auth */
export const UserLiteSchema = UserSessionSchema.extend({
  createdAt: TimestampSchema.or(z.date()),
  signInProviders: z.array(SignInProviderSchema).optional(),
});

export const UserSchema = UserLiteSchema.omit({
  createdAt: true,
  currentSignInProvider: true,
})
  .extend(CoreSchema.shape)
  .extend({
    agreedAt: TimestampSchema.optional(),
    connectedEmails: z.array(z.string()).optional(),
    /**
     * Example: DK, (Denmark)
     *
     * Two-letter country code ([ISO 3166-1
     * alpha-2](https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2)).
     */
    countryCode: CountryCodeSchema.optional(),
    firstName: z.string().optional(),

    lastName: z.string().optional(),

    /**
     * Example: da, (Danish)
     * https://www.science.co.il/language/Locale-codes.php
     */
    localeCode: z.string().optional(),

    /**
     * The duration of all the videos the user has uploaded of the current
     * month
     */
    monthlyUploadedDuration: z.number().optional(),
  });

export const UserCreateSchema = UserSchema.omit(CoreOmitSchema)
  .extend(CoreCreateSchema.shape)
  .extend({
    agreedAt: UserSchema.shape.agreedAt.or(FieldValueSchema),
  });

export const UserUpdateSchema = UserSchema.extend(getDeletableFields(UserSchema))
  .omit(CoreOmitSchema)
  .extend(CoreUpdateSchema.shape);

export const UserLiteCreateSchema = z.object({
  displayName: z.string().optional(),
  email: z.string().email(),
  errorMessage: z.string().optional(),
  userRole: UserRoleSchema,
});
