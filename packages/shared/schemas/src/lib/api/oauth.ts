import { z } from "zod";
import {
	FieldValueSchema,
	TimestampSchema,
	UniversalValueSchema,
} from "../fields.ts";

/**
 * The user role in the CRM.
 *
 * - admin: The user is an admin of the CRM.
 * - member: The user is a member of the CRM.
 * - creator: The user is the creator of the CRM. In superoffice this means the
 */
export const OAuthRoleSchema = z.enum(["admin", "member", "creator"]);

/** Represents OAuth profile data. */
export const OAuthProfileDataSchema = z.object({
	/** The account ID of the user. */
	accountId: UniversalValueSchema,

	/** The email of the user. */
	email: z.string().optional(),

	/** The metadata associated with the user. */
	metadata: z.record(z.string(), z.unknown()).optional(),

	/** The name of the user. */
	name: z.string().optional(),

	/** The phone number of the user. */
	phoneNumber: z.string().optional(),

	/** The photo URL of the user. */
	photoURL: z.string().optional(),

	/**
	 * The unique identifier for the user in the tenant. In superoffice this
	 * would be the customerId
	 */
	tenantId: UniversalValueSchema.optional(),

	/** The name of the tenant. */
	tenantName: z.string().optional(),

	/** The role of the user in CRM. */
	userRole: OAuthRoleSchema,
});

export const OAuthValidationSchema = z.object({
	/** The o auth2 refresh token. */
	accessToken: z.string(),
	/**
	 * A timestamp of when the user's token was first created.
	 *
	 * Note if this is more than 365 days old and it is a microsoft account, the
	 * auth token needs to be deleted and the user must reauthenticate.
	 */
	createdAt: TimestampSchema,
	/**
	 * A timestamp of when the user's refresh token will expire and needs to be
	 * refreshed.
	 *
	 * This is 6 months since last used for google:
	 * https://developers.google.com/identity/protocols/Coreoauth2#expiration
	 *
	 * This is 60 days for microsoft:
	 * https://docs.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens#:~:text=By%20default%2C%20access%20tokens%20are,application%20when%20refresh%20tokens%20expire.
	 */
	expiresAt: TimestampSchema,
	/**
	 * If the access token is expired / invalid then this will be true and the
	 * user will need to reauthenticate.
	 */
	needsReAuthentication: z.boolean().optional(),
	/** the redirect url for when the user verified their account. */
	redirectURI: z.string(),
	/** The o auth2 refresh token. */
	refreshToken: z.string(),
});

export const OAuthExecuteSchema = OAuthValidationSchema.omit({
	createdAt: true,
	// expiresAt: true,
}).extend(OAuthProfileDataSchema.shape);

export const OAuthProviderLiteSchema = OAuthProfileDataSchema.extend(
	OAuthValidationSchema.omit({ createdAt: true, expiresAt: true }).shape,
);

export const OAuthProviderSchema = OAuthProfileDataSchema.extend(
	OAuthValidationSchema.shape,
);

export const OAuthProviderCreateSchema = OAuthProviderSchema.omit({
	createdAt: true,
	expiresAt: true,
}).extend(
	z.object({
		createdAt: FieldValueSchema,
		expiresAt: FieldValueSchema,
	}).shape,
);

export const OAuthProviderUpdateSchema = OAuthProviderSchema.omit({
	accountId: true,
	createdAt: true,
	expiresAt: true,
	redirectURI: true,
	refreshToken: true,
}).extend({
	expiresAt: TimestampSchema,
	refreshToken: z.string().optional(),
});

export const OAuthProvidersSchema = z
	.record(z.string(), OAuthProviderSchema)
	.optional();

export const OAuthProvidersLiteSchema = z
	.record(z.string(), OAuthProfileDataSchema)
	.optional();

export const OAuthProvidersCreateSchema = OAuthProviderCreateSchema.optional();

export const OAuthProvidersUpdateSchema = OAuthProviderUpdateSchema.optional();
