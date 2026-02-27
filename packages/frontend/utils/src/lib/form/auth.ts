import type {
  FirebaseAuthUserCredential,
  FirebaseUser,
  GoogleMetadata,
  MicrosoftMetadata,
  RegisterData,
  UserMetadata,
} from '@aikami/types';
import { toSignInProvider } from '@aikami/utils';
import { getAdditionalUserInfo } from 'firebase/auth';
export const getRegisterDataFromUser = (user: FirebaseUser): RegisterData => {
  const signInProvider = toSignInProvider(user.providerData[0]?.providerId ?? 'email');
  const email = user.email;

  if (!email) {
    throw new Error('Email is required');
  }
  const uid = user.uid;

  const displayName = user.displayName;
  let firstName;
  let lastName = '';
  if (displayName) {
    const names = displayName.split(' ');
    firstName = names.shift();
    if (names.length > 0) {
      lastName = names.join(' ');
    }
  }

  return {
    email,
    signInProvider,
    uid,
    userMetadata: {
      firstName,
      lastName,
    },
  };
};

export const getRegisterDataFromCredential = (
  userCredential: FirebaseAuthUserCredential,
): RegisterData => {
  const signInProvider = toSignInProvider(userCredential.providerId ?? 'email');
  const email = userCredential.user.email;

  if (!email) {
    throw new Error('Email is required');
  }
  const registerData: RegisterData = {
    email,
    signInProvider,
    uid: userCredential.user.uid,
  };
  switch (signInProvider) {
    case 'google':
      return {
        ...registerData,
        userMetadata: getGoogleMetadata(userCredential),
      };
    case 'github':
      return {
        ...registerData,
        userMetadata: getMicrosoftMetadata(userCredential),
      };
    default:
      return registerData;
  }
};

const getGoogleMetadata = (userCredential: FirebaseAuthUserCredential): UserMetadata => {
  const profile = getAdditionalUserInfo(userCredential)?.profile as GoogleMetadata | undefined;
  const displayName = userCredential.user.displayName;

  let firstName = profile?.given_name;
  let lastName = profile?.family_name;
  if (displayName && !firstName && !lastName) {
    const names = displayName.split(' ');
    firstName = names.shift();
    if (names.length > 0) {
      lastName = names.join(' ');
    }
  }

  return {
    firstName,
    lastName,
    localeCode: profile?.locale,
  };
};

const getMicrosoftMetadata = (userCredential: FirebaseAuthUserCredential): UserMetadata => {
  const profile = getAdditionalUserInfo(userCredential)?.profile as MicrosoftMetadata | undefined;

  const displayName = userCredential.user.displayName;

  let firstName = profile?.given_name;
  let lastName = profile?.family_name;
  if (displayName && !firstName && !lastName) {
    const names = displayName.split(' ');
    firstName = names.shift();
    if (names.length > 0) {
      lastName = names.join(' ');
    }
  }

  return {
    firstName,
    lastName,
    localeCode: profile?.locale,
  };
};
