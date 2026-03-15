import { randomUUID } from 'node:crypto';
import { getAuth } from '@aikami/backend/configs/auth';
import { getEnvironmentValue } from '@aikami/backend/configs/environment';
import { timestampFromDate } from '@aikami/backend/configs/firestore';
import type {
  AuthCreateRequest,
  AuthUpdateRequest,
  FirebaseUserInfo,
  SupportedLocale,
  UserClaims,
  UserLiteData,
  UserSessionData,
  UserTokenData,
} from '@aikami/types';
import {
  toAppError,
  toFirebaseAuthMetadata,
  toSignInProvider,
  toUserClaims,
  toUserLiteData,
  toUserTokenData,
} from '@aikami/utils';
import type { CreateRequest, DecodedIdToken, UpdateRequest, UserRecord } from 'firebase-admin/auth';
import { logger } from '$logger';

/**
 * Must be a valid E.164 spec compliant phone number.
 *
 * @param phoneNumber the phoneNumber to test
 * @returns true if compliant
 */
export const isValidPhoneForE164 = (phoneNumber: string): boolean => {
  const regEx = /^\+[1-9]\d{10,14}$/;

  return regEx.test(phoneNumber);
};

export const verifyIdToken = async (idToken: string): Promise<DecodedIdToken> => {
  const auth = getAuth();
  return await auth.verifyIdToken(idToken);
};

export const createFirebaseAuthUser = async (options: AuthCreateRequest): Promise<string> => {
  const { displayName, email, password, uid } = options;
  const createRequest: CreateRequest = {
    displayName,
  };
  if (uid) {
    createRequest.uid = uid;
  }

  if (email) {
    createRequest.email = email;
    // There is a bug where if the firebase account is not an email and password user, the email is null in the firebase getAuth().
    // This is a workaround to make sure the email is set to the correct value.
    createRequest.password = password ?? randomUUID();
  }

  // Should we validate that only one phone number pr user?
  // if (phoneNumber && isValidPhoneForE164(phoneNumber)) {
  // 	createRequest.phoneNumber = phoneNumber;
  // }
  logger.log('createFirebaseAuthUser', {
    ...createRequest,
    password: '********',
  });
  const userRecord = await getAuth().createUser(createRequest);
  return userRecord.uid;
};

export const deleteFirebaseAuthUser = async (uid: string): Promise<void> => {
  await getAuth().deleteUser(uid);
};

export const getFirebaseAuthUser = async (uid: string): Promise<UserLiteData> => {
  const userRecord = await getAuth().getUser(uid);
  return toUserLiteDataFromUserRecord(userRecord);
};

export const getFirebaseAuthUserByEmail = async (email: string): Promise<UserLiteData> => {
  const userRecord = await getAuth().getUserByEmail(email);
  return toUserLiteDataFromUserRecord(userRecord);
};

const toUserLiteDataFromUserRecord = (userRecord: UserRecord): UserLiteData => {
  const createdAt = timestampFromDate(new Date(userRecord.metadata.creationTime));
  const signInProviders = userRecord.providerData
    .filter((provider) => provider.providerId)
    .map((provider) => toSignInProvider((provider as FirebaseUserInfo).providerId));

  const email = userRecord.email;

  return toUserLiteData({
    claims: (userRecord.customClaims ?? {}) as Record<string, unknown>,
    createdAt,
    displayName: userRecord.displayName,
    email,
    phoneNumber: userRecord.phoneNumber,
    photoURL: userRecord.photoURL,
    signInProviders,
    uid: userRecord.uid,
  });
};

export const updateFirebaseAuthUser = async (
  uid: string,
  { displayName, email, password, phoneNumber }: AuthUpdateRequest,
): Promise<void> => {
  const updateRequest: UpdateRequest = {};

  if (phoneNumber && isValidPhoneForE164(phoneNumber)) {
    updateRequest.phoneNumber = phoneNumber;
  }
  if (password) {
    updateRequest.password = password;
  }
  if (email) {
    updateRequest.email = email;
  }
  if (displayName) {
    updateRequest.displayName = displayName;
  }

  if (!Object.keys(updateRequest).length) {
    logger.warn('updateFirebaseAuthUser: nothing to update');
    return;
  }

  await getAuth().updateUser(uid, updateRequest);
};

export const createCustomFirebaseToken = async (
  uid: string,
  createCustomToken?: UserTokenData,
): Promise<string> => {
  try {
    logger.log('createCustomFirebaseToken', { createCustomToken, uid });
    return await getAuth().createCustomToken(uid, createCustomToken);
  } catch (error) {
    logger.error('createCustomFirebaseToken', error);
    throw error;
  }
};

/**
 * Updates the user claims
 *
 * @param user the user claims
 */
export const updateUserClaims = async (user: UserClaims): Promise<boolean> => {
  try {
    const tokenData = toUserTokenData(user);
    logger.log('updateUserClaims:tokenData', tokenData);
    await getAuth().setCustomUserClaims(user.id, tokenData);
    return true;
  } catch (error) {
    logger.error('updateUserClaims', error);
    return false;
  }
};

export const getPasswordResetLink = async ({
  email,
  isFirstTime = false,
  supportedLocale,
}: {
  email: string;
  isFirstTime?: boolean;
  supportedLocale: SupportedLocale;
}): Promise<string> => {
  const link = await getAuth().generatePasswordResetLink(email);
  return `${convertLink(link, supportedLocale)}&first=${isFirstTime}&email=${email}`;
};

export const getEmailVerificationLink = async ({
  email,
  supportedLocale,
}: {
  email: string;
  supportedLocale: SupportedLocale;
}): Promise<string | undefined> => {
  try {
    const link = await getAuth().generateEmailVerificationLink(email);
    return convertLink(link, supportedLocale);
  } catch (error) {
    logger.error('getEmailVerificationLink', {
      email,
      error,
      supportedLocale,
    });
    return;
  }
};

const convertLink = (link: string, supportedLocale: SupportedLocale) => {
  return link.replace(
    `https://${getEnvironmentValue('GCP_PROJECT_ID')}.firebaseapp.com/__/auth/action`,
    `${getEnvironmentValue('PWA_URL')}/${toSupportedLocaleURLPrefix(supportedLocale)}auth/userMgmt`,
  );
};

const toSupportedLocaleURLPrefix = (supportedLocale: SupportedLocale) => {
  switch (supportedLocale) {
    case 'en':
      return '/';
    default:
      return '';
  }
};

/**
 * Throws a 'permission-denied' HttpsError if the user that want to manage the
 * other user is unauthorized.
 */
export const canManageUser = ({ currentUserClaims }: { currentUserClaims: UserClaims }): void => {
  const currentUserRole = currentUserClaims.userRole;

  if (currentUserRole !== 'superAdmin') {
    throw toAppError('permission-denied', 'unauthorized_user_role');
  }
};

export const getAllAuthUsers = async (): Promise<UserLiteData[]> => {
  const users = await getAuth().listUsers();
  return users.users.map(toUserLiteDataFromUserRecord);
};

export const toUserSessionDataFromToken = (decodedIdToken: DecodedIdToken): UserSessionData => {
  const uid = decodedIdToken.uid;
  const email = decodedIdToken.email;

  const displayName = decodedIdToken.name;
  const phoneNumber = decodedIdToken.phone_number;
  const photoURL = decodedIdToken.picture;
  const claims = decodedIdToken;
  const currentSignInProvider = toSignInProvider(decodedIdToken.firebase.sign_in_provider);

  const userLiteData: UserSessionData = {
    currentSignInProvider,
    ...toUserClaims({ token: claims, uid }),
    ...toFirebaseAuthMetadata({
      displayName: displayName ?? '',
      email: email ?? undefined,
      phoneNumber: phoneNumber ?? undefined,
      photoURL: photoURL ?? undefined,
    }),
    id: uid,
  };

  return userLiteData;
};
