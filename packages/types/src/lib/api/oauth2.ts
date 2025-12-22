/* eslint-disable @typescript-eslint/no-invalid-void-type */
import type { OAuthExecuteData } from '../database/oauth2.ts'

/**
 * Some providers uses number as id, some uses string. We don't know which one,
 * so we use this type.
 */
export type UniversalValue = string | number

type OAuthTokenRequest = {
  /** The Application ID that the registration portal) assigned your app. */
  client_id: string
  /**
   * The application secret that you created in the app registration portal
   * for your app. It should not be used in a native app, because
   * client_secrets cannot be reliably stored on devices. It is required for
   * web apps and web APIs, which have the ability to store the client_secret
   * securely on the server side.
   */
  client_secret: string
  /** Must be authorization_code for the authorization code flow. */
  grant_type: 'authorization_code' | 'refresh_token'
  /** The authorization_code that you acquired in the first leg of the flow. */
  code?: string
  /**
   * The same redirect_uri value that was used to acquire the
   * authorization_code.
   */
  redirect_uri: string
}

export type OAuthTokenAuthorizeRequest = OAuthTokenRequest & {
  /** Must be authorization_code for the Authorization Code flow. */
  grant_type: 'authorization_code'
  /** The authorization_code that you acquired in the first leg of the flow. */
  code: string
}

export type OAuthTokenRefreshRequest = Omit<OAuthTokenRequest, 'code'> & {
  /** Must be refresh_token for the refresh token flow. */
  grant_type: 'refresh_token'
  /** The refresh token that you acquired in the first leg of the flow. */
  refresh_token: string
}

export type OAuthTokenResponse = {
  /**
   * A space separated list of the OAuth Graph permissions that the
   * access_token is valid for.
   */
  scope: string
  /**
   * Indicates the token type value. The only type that Azure AD supports is
   * Bearer
   */
  token_type: 'Bearer'
  /** How long the access token is valid (in seconds). */
  expires_in: number
  /**
   * The requested access token. Your app can use this token to call OAuth
   * Graph.
   */
  access_token: string
  /**
   * An OAuth 2.0 refresh token. Your app can use this token to acquire
   * additional access tokens after the current access token expires. Refresh
   * tokens are long-lived, and can be used to retain access to resources for
   * extended periods of time. For more detail, refer to the v2.0 token
   * reference.
   */
  refresh_token?: string

  id_token?: string
}

export type OAuthProfileData<MetaData = Record<string, unknown>> = {
  email?: string
  name?: string
  photoURL?: string
  accountId: UniversalValue

  phoneNumber?: string
  /**
   * The unique identifier for the user in the tenant.
   *
   * In superoffice this would be the customerId
   */
  tenantId?: UniversalValue
  tenantName?: string
  metadata?: MetaData
}

export type CoreOAuthMessageTypes = {
  // Admin
  getAuthVerifyURL: [
    {
      redirectURI: string
      phoneNumber?: string
      isRefreshingCRM?: boolean
    },
    string,
  ]
  saveToken: [
    {
      isRefreshingCRM?: boolean
      phoneNumber?: string
      code: string
      redirectURI: string
    },
    OAuthExecuteData & {
      customFirebaseSignInToken?: string
    },
  ]
  disconnect: [undefined, void]
}
