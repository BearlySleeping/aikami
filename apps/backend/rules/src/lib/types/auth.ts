export type MockAuth = {
	token?: {
		/** Custom claims set by the developer */
		[claim: string]: unknown;
		/**
		 * Set to PROJECT_ID by default. In rare cases, you may want to specify
		 * an override.
		 */
		aud?: string;
		/** The time the user authenticated, normally 'iat' */
		auth_time?: number;
		/** The user's primary email */
		email?: string;
		/** The user's email verification status */
		email_verified?: boolean;
		/** The token expiry time, normally 'iat' + 3600 */
		exp?: number;
		/** Information on all identities linked to this user */
		firebase?: {
			/**
			 * A map of providers to the user's list of unique identifiers from
			 * each provider
			 */
			identities?: {
				[provider in FirebaseSignInProvider]?: string[];
			};
			/** The primary sign-in provider */
			sign_in_provider: FirebaseSignInProvider;
		};
		/** The token issue time, in seconds since epoch */
		iat?: number;
		/**
		 * Set to https://securetoken.google.com/PROJECT_ID by default. In rare
		 * cases, you may want to specify an override.
		 */
		iss?: string;
		/** The user's display name */
		name?: string;
		/** The user's primary phone number */
		phone_number?: string;
		/** The user's profile photo URL */
		picture?: string;
		/** The sign in provider, only set when the provider is 'anonymous' */
		provider_id?: 'anonymous';
	};
	uid: string;
};

type FirebaseSignInProvider = 'email';
