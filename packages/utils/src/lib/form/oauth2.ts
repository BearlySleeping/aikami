import type {
  FieldValue,
  OAuthProfileData,
  OAuthProviderCreateData,
  OAuthProviderUpdateData,
  ServerTimestamp,
} from '@aikami/types';
import logger from '$logger';
import {
  getDateFromUnixTime,
  getDaysFromNowInUnix,
  getMonthsFromNowInUnix,
} from '../common/utils.ts';

/**
 * Converts the current oauth data to the oauthProvider create data
 *
 * @param options The options
 * @returns The oauthProvider create data
 */
export const toOAuthProviderCreateData = (options: {
  refreshToken: string;
  accessToken: string;
  oauthProvider: string;
  profileData: OAuthProfileData;
  redirectURI: string;
  expiresAt?: number;
  serverTimestamp: ServerTimestamp;
  timestampFromDate: (date: Date) => FieldValue;
}): OAuthProviderCreateData => {
  logger.debug('toOAuthProviderCreateData', options);
  const {
    accessToken,
    expiresAt,
    oauthProvider,
    profileData,
    redirectURI,
    refreshToken,
    serverTimestamp,
    timestampFromDate,
  } = options;
  const { accountId, email, metadata, name, phoneNumber, photoURL, tenantId } = profileData;

  const oauthProviderCreateData: OAuthProviderCreateData = {
    accessToken,
    accountId,
    createdAt: serverTimestamp(),
    expiresAt: timestampFromDate(
      getDateFromUnixTime(
        (expiresAt ?? oauthProvider === 'google')
          ? getMonthsFromNowInUnix(6)
          : getDaysFromNowInUnix(60),
      ),
    ),
    redirectURI,
    refreshToken,
  };
  if (email) {
    oauthProviderCreateData.email = email;
  }
  if (tenantId) {
    oauthProviderCreateData.tenantId = tenantId;
  }
  if (name) {
    oauthProviderCreateData.name = name;
  }
  if (photoURL) {
    oauthProviderCreateData.photoURL = photoURL;
  }
  if (redirectURI) {
    oauthProviderCreateData.redirectURI = redirectURI;
  }
  if (metadata) {
    oauthProviderCreateData.metadata = metadata;
  }
  if (phoneNumber) {
    oauthProviderCreateData.phoneNumber = phoneNumber;
  }

  return oauthProviderCreateData;
};

/**
 * Converts the current oauth data to the oauthProvider update data
 *
 * @param options The options
 * @returns The oauthProvider update data
 */
export const toOAuthProviderUpdateData = (options: {
  refreshToken?: string;
  accessToken: string;
  oauthProvider: string;
  profileData?: OAuthProfileData;
  expiresAt?: number;
  timestampFromDate: (date: Date) => FieldValue;
}): OAuthProviderUpdateData => {
  logger.debug('toOAuthProviderUpdateData', options);

  const { accessToken, expiresAt, oauthProvider, profileData, refreshToken, timestampFromDate } =
    options;

  const oauthProviderUpdateData: OAuthProviderUpdateData = {
    accessToken,
    expiresAt: timestampFromDate(
      getDateFromUnixTime(
        (expiresAt ?? oauthProvider === 'google')
          ? getMonthsFromNowInUnix(6)
          : getDaysFromNowInUnix(60),
      ),
    ),
  };
  if (refreshToken) {
    oauthProviderUpdateData.refreshToken = refreshToken;
  }

  if (!profileData) {
    return oauthProviderUpdateData;
  }

  const { email, metadata, name, phoneNumber, photoURL, tenantId } = profileData;

  if (tenantId) {
    oauthProviderUpdateData.tenantId = tenantId;
  }
  if (email) {
    oauthProviderUpdateData.email = email;
  }
  if (name) {
    oauthProviderUpdateData.name = name;
  }
  if (photoURL) {
    oauthProviderUpdateData.photoURL = photoURL;
  }
  if (metadata) {
    oauthProviderUpdateData.metadata = metadata;
  }
  if (phoneNumber) {
    oauthProviderUpdateData.phoneNumber = phoneNumber;
  }

  return oauthProviderUpdateData;
};

/**
 * Converts the current oauth data to the oauthProvider update data
 *
 * @param options The options
 * @returns The oauthProvider update data
 */
export const toOAuthProfileData = (options: OAuthProfileData): OAuthProfileData => {
  logger.debug('toOAuthProfileData', options);

  const { accountId, email, metadata, name, phoneNumber, photoURL, tenantId } = options;

  const oAuthProfileData: OAuthProfileData = {
    accountId,
  };
  if (tenantId) {
    oAuthProfileData.tenantId = tenantId;
  }
  if (email) {
    oAuthProfileData.email = email;
  }
  if (name) {
    oAuthProfileData.name = name;
  }
  if (photoURL) {
    oAuthProfileData.photoURL = photoURL;
  }
  if (metadata) {
    oAuthProfileData.metadata = metadata;
  }
  if (phoneNumber) {
    oAuthProfileData.phoneNumber = phoneNumber;
  }

  return oAuthProfileData;
};
