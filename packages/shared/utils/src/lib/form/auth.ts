import type {
  AuthMetadata,
  SignInProvider,
  Timestamp,
  UserClaims,
  UserLiteData,
  UserRole,
  UserSessionData,
  UserTokenData,
} from '@aikami/types';
import { toSignInProvider } from '../auth.ts';

export const toUserRole = (role?: string): UserRole => {
  switch (role) {
    case 'superAdmin':
      return 'superAdmin';
    default:
      return 'member';
  }
};

export const toAuthMetadata = (user: AuthMetadata): AuthMetadata => {
  const authMetadata: AuthMetadata = {};

  if (user.displayName) {
    authMetadata.displayName = user.displayName;
  }
  if (user.email) {
    authMetadata.email = user.email;
  }
  if (user.photoURL) {
    authMetadata.photoURL = user.photoURL;
  }
  if (user.phoneNumber) {
    authMetadata.phoneNumber = user.phoneNumber;
  }

  return authMetadata;
};

export const toUserTokenData = (tokenData: UserTokenData): UserTokenData => {
  const userTokenData: UserTokenData = {};
  if (tokenData.userRole) {
    userTokenData.userRole = toUserRole(tokenData.userRole);
  }
  if (tokenData.status) {
    userTokenData.status = tokenData.status;
  }

  return userTokenData;
};

export const toUserClaims = ({
  token,
  uid,
}: {
  token: Record<string, unknown>;
  uid: string;
}): UserClaims => {
  const userLiteData: UserClaims = {
    ...toUserTokenData(token as unknown as UserTokenData), // guard-ignore lint/type-safety/casting: JSON.parse result - TypeBox schema validation precedes this cast
    id: uid,
  };
  return userLiteData;
};

export const toUserLiteData = ({
  claims,
  createdAt,
  displayName,
  email,
  phoneNumber,
  photoURL,
  signInProviders,
  uid,
}: {
  claims: Record<string, unknown>;
  createdAt: Date | Timestamp;
  displayName?: null | string;
  email: null | string | undefined;
  phoneNumber?: null | string;
  photoURL?: null | string;
  signInProviders: SignInProvider[];
  uid: string;
}): UserLiteData => {
  const userLiteData: UserLiteData = {
    currentSignInProvider: toSignInProvider(signInProviders[0] ?? 'email'),
    ...toUserClaims({ token: claims, uid }),
    ...toAuthMetadata({
      displayName: displayName ?? '',
      email: email ?? undefined,
      phoneNumber: phoneNumber ?? undefined,
      photoURL: photoURL ?? undefined,
    }),
    createdAt,
    id: uid,
    signInProviders,
  };

  return userLiteData;
};

export const toUserSessionData = (
  user: Omit<UserSessionData, 'currentSignInProvider'>,
  currentSignInProvider: UserSessionData['currentSignInProvider'],
): UserSessionData => {
  const uid = user.id;

  const userLiteData: UserSessionData = {
    currentSignInProvider,
    ...toUserClaims({ token: user, uid }),
    ...toAuthMetadata(user),
    id: uid,
  };

  return userLiteData;
};

/**
 * Check if we should update the auth tokens.
 *
 * @param beforeUser the exiting user data
 * @param afterUser the new user data
 * @returns true if the new user data has different values in the auth
 *   tokens.
 */
export const shouldUpdateUserClaims = ({
  afterUser,
  beforeUser,
}: {
  afterUser: UserTokenData;
  beforeUser: UserTokenData;
}): boolean => beforeUser.userRole !== afterUser.userRole || beforeUser.status !== afterUser.status;

/**
 * Check if we should update the auth provider.
 *
 * @param beforeUser the exiting user data
 * @param afterUser the new user data
 * @returns true if the new user data has different values in the auth auth
 *   provider.
 */
export const shouldUpdateAuthUser = ({
  afterUser,
  beforeUser,
}: {
  afterUser: AuthMetadata;
  beforeUser: AuthMetadata;
}): boolean =>
  beforeUser.displayName !== afterUser.displayName ||
  beforeUser.email !== afterUser.email ||
  beforeUser.phoneNumber !== afterUser.phoneNumber ||
  beforeUser.photoURL !== afterUser.photoURL;
