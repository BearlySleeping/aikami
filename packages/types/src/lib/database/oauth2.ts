import type { FieldValue, Timestamp } from '../api/firestore.ts'
import type { OAuthProfileData } from '../api/oauth2.ts'

export type OAuthValidationData = {
  /** The o auth2 refresh token. */
  refreshToken: string

  /** The o auth2 refresh token. */
  accessToken: string

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
  expiresAt: Timestamp

  /**
   * A timestamp of when the user's token was first created.
   *
   * Note if this is more than 365 days old and it is a microsoft account, the
   * auth token needs to be deleted and the user must reauthenticate.
   */
  createdAt: Timestamp

  /** the redirect url for when the user verified their account. */
  redirectURI: string

  /**
   * If the access token is expired / invalid then this will be true and the
   * user will need to reauthenticate.
   */
  needsReAuthentication?: boolean
}

export type OAuthExecuteData<MetaData = Record<string, unknown>> =
  & Omit<
    OAuthValidationData,
    'expiresAt' | 'createdAt'
  >
  & OAuthProfileData<MetaData>

export type OAuthProviderLiteData<MetaData = Record<string, unknown>> =
  & OAuthProfileData<MetaData>
  & Omit<OAuthValidationData, 'expiresAt' | 'createdAt'>

/** Data used to access the user's Oath2 account. */
export type OAuthProviderData<MetaData = Record<string, unknown>> =
  & OAuthProfileData<MetaData>
  & OAuthValidationData

/** Data used to access the user's Oath2 account. */
export type OAuthProvidersData<OAuthProviderName extends string = string> = {
  [key in OAuthProviderName]?: OAuthProviderData
}

/** Data used to access the user's Oath2 account. */
export type OAuthProviderCreateData = {
  /** A timestamp of when the user's token was last refreshed. */
  expiresAt: FieldValue
  createdAt: FieldValue
} & Omit<OAuthProviderData, 'expiresAt' | 'createdAt'>

export type OAuthProvidersCreateData<
  OAuthProviderName extends string = string,
> = {
  [key in OAuthProviderName]?: OAuthProviderCreateData
}

/** Data used to access the user's Oath2 account. */
export type OAuthProviderUpdateData =
  & {
    /** A timestamp of when the user's token was last refreshed. */
    expiresAt: FieldValue
    refreshToken?: string
  }
  & Omit<
    OAuthProviderData,
    | 'expiresAt'
    | 'createdAt'
    | 'provider'
    | 'redirectURI'
    | 'accountId'
    | 'refreshToken'
  >

export type OAuthProvidersUpdateData<
  OAuthProviderName extends string = string,
> = {
  [key in OAuthProviderName]?: OAuthProviderUpdateData
}
