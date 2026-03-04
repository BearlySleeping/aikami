import { firebaseSignInProviderNames, userRoles } from "@aikami/constants";
import { z } from "zod";
import { SupportedLocaleSchema } from "./common/preference.ts";

export const FirebaseAuthMetadataSchema = z.object({
	displayName: z.string().optional(),
	email: z.string().email().optional(),
	phoneNumber: z.string().optional(),
	photoURL: z.string().optional(),
});

export const SignInSocialProviderSchema = z.enum(["google", "github"]);

export const SignInProviderSchema = z
	.enum(["email"])
	.or(SignInSocialProviderSchema);

export const UserMetadataSchema = z.object({
	firstName: z.string().optional(),
	lastName: z.string().optional(),
	localeCode: z.string().optional(),
	phoneNumber: z.string().optional(),
	photoURL: z.string().optional(),
});

export const RegisterDataSchema = z.object({
	email: z.string(),
	signInProvider: SignInProviderSchema,
	uid: z.string().optional(),
	userMetadata: UserMetadataSchema.optional(),
});

export const GoogleMetadataSchema = z.object({
	email: z.string().optional(),
	family_name: z.string().optional(),
	given_name: z.string().optional(),
	locale: z.string().optional(),
	name: z.string().optional(),
	picture: z.string().optional(),
	verified_email: z.boolean().optional(),
});

export const MicrosoftMetadataSchema = z.object({
	email: z.string().optional(),
	family_name: z.string().optional(),
	given_name: z.string().optional(),
	locale: z.string().optional(),
	name: z.string().optional(),
	picture: z.string().optional(),
	verified_email: z.boolean().optional(),
});

export const UserRoleSchema = z.enum(userRoles);

export const FirebaseSignInProviderNameSchema = z.enum(
	firebaseSignInProviderNames,
);

/**
 * The status of the user.
 *
 * If this is 'unconfirmed-terms' then the user has not confirmed the terms
 *
 * TODO: add more statuses
 */
export const UserStatusSchema = z.enum(["unconfirmed-terms", "active"]);

/**
 * Fields in the user token data only created by createCustomToken. These fields
 * are not stored globally in the database.
 */

export const UserTokenSchema = z.object({
	/**
	 * If this is true show beta features.
	 *
	 * @default undefined
	 */
	isBetaTester: z.literal(true).optional(),

	/**
	 * The status of the user.
	 *
	 * If this is 'unconfirmed-terms' then the user has not confirmed the terms
	 *
	 * TODO: add all statuses and make required
	 */

	/**
	 * The supported language codes on the frontend.
	 * https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes
	 */
	preferredLocale: SupportedLocaleSchema.optional(),

	status: UserStatusSchema.optional(),

	/** If this is undefined, then the user has not finished the registration. */
	userRole: UserRoleSchema.optional(),
});

export const UserClaimsSchema = UserTokenSchema.extend({
	id: z.string(),
});
