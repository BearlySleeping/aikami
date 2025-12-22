import type {
  FirebaseAuthMetadata,
  FirebaseUser,
  SignInProvider,
  Timestamp,
  UserClaims,
  UserLiteData,
  UserRole,
  UserSessionData,
  UserTokenData,
} from '@aikami/types'
import { toAppError } from '../common/error.ts'
import { toSignInProvider } from '../auth.ts'

export const toUserRole = (role?: string): UserRole => {
  switch (role) {
    case 'superAdmin':
      return 'superAdmin'
    default:
      return 'member'
  }
}

export const toFirebaseAuthMetadata = (
  user: FirebaseAuthMetadata,
): FirebaseAuthMetadata => {
  const firebaseAuthMetadata: FirebaseAuthMetadata = {}

  if (user.displayName) {
    firebaseAuthMetadata.displayName = user.displayName
  }
  if (user.email) {
    firebaseAuthMetadata.email = user.email
  }
  if (user.photoURL) {
    firebaseAuthMetadata.photoURL = user.photoURL
  }
  if (user.phoneNumber) {
    firebaseAuthMetadata.phoneNumber = user.phoneNumber
  }

  return firebaseAuthMetadata
}

export const toUserTokenData = (tokenData: UserTokenData): UserTokenData => {
  const userTokenData: UserTokenData = {}
  if (tokenData.userRole) {
    userTokenData.userRole = toUserRole(tokenData.userRole)
  }
  if (tokenData.status) {
    userTokenData.status = tokenData.status
  }

  return userTokenData
}

export const toUserClaims = ({
  token,
  uid,
}: {
  token: Record<string, unknown>
  uid: string
}): UserClaims => {
  const userLiteData: UserClaims = {
    ...toUserTokenData(token as unknown as UserTokenData),
    id: uid,
  }
  return userLiteData
}

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
  claims: Record<string, unknown>
  createdAt: Date | Timestamp
  displayName?: null | string
  email: null | string | undefined
  phoneNumber?: null | string
  photoURL?: null | string
  signInProviders: SignInProvider[]
  uid: string
}): UserLiteData => {
  const userLiteData: UserLiteData = {
    currentSignInProvider: toSignInProvider(signInProviders[0] ?? 'email'),
    ...toUserClaims({ token: claims, uid }),
    ...toFirebaseAuthMetadata({
      displayName: displayName ?? '',
      email: email ?? undefined,
      phoneNumber: phoneNumber ?? undefined,
      photoURL: photoURL ?? undefined,
    }),
    createdAt,
    id: uid,
    signInProviders,
  }

  return userLiteData
}

export const toUserSessionData = (
  user: Omit<UserSessionData, 'currentSignInProvider'>,
  currentSignInProvider: UserSessionData['currentSignInProvider'],
): UserSessionData => {
  const uid = user.id

  const userLiteData: UserSessionData = {
    currentSignInProvider,
    ...toUserClaims({ token: user, uid }),
    ...toFirebaseAuthMetadata(user),
    id: uid,
  }

  return userLiteData
}

export const getUserLiteData = async ({
  claims,
  user,
}: {
  claims?: Record<string, unknown>
  user: FirebaseUser
}): Promise<UserLiteData> => {
  const creationTime = user.metadata.creationTime
  if (!creationTime) {
    throw toAppError(
      'invalid-argument',
      'getUserLiteData: Creation time is required',
    )
  }
  const email = user.email

  const createdAt = new Date(creationTime)
  claims = claims ?? (await user.getIdTokenResult()).claims

  if (!claims) {
    throw toAppError(
      'invalid-argument',
      'getUserLiteData: Claims are required',
    )
  }

  return toUserLiteData({
    claims,
    createdAt,
    displayName: user.displayName,
    email,

    phoneNumber: user.phoneNumber,
    photoURL: user.photoURL,
    signInProviders: user.providerData.map((provider) => toSignInProvider(provider.providerId)),
    uid: user.uid,
  })
}

/**
 * Check if we should update the firebase tokens.
 *
 * @param beforeUser the exiting user data
 * @param afterUser the new user data
 * @returns true if the new user data has different values in the firebase
 *   tokens.
 */
export const shouldUpdateUserClaims = ({
  afterUser,
  beforeUser,
}: {
  afterUser: UserTokenData
  beforeUser: UserTokenData
}): boolean => {
  return (
    beforeUser.userRole !== afterUser.userRole ||
    beforeUser.status !== afterUser.status
  )
}

/**
 * Check if we should update the firebase auth.
 *
 * @param beforeUser the exiting user data
 * @param afterUser the new user data
 * @returns true if the new user data has different values in the firebase auth
 *   provider.
 */
export const shouldUpdateFirebaseAuthUser = ({
  afterUser,
  beforeUser,
}: {
  afterUser: FirebaseAuthMetadata
  beforeUser: FirebaseAuthMetadata
}): boolean => {
  return (
    beforeUser.displayName !== afterUser.displayName ||
    beforeUser.email !== afterUser.email ||
    beforeUser.phoneNumber !== afterUser.phoneNumber ||
    beforeUser.photoURL !== afterUser.photoURL
  )
}
