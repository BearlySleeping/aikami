import { getFirestore } from '@aikami/backend/configs/database';
import { serverTimestamp } from '@aikami/backend/configs/firestore';

import { updateUserClaims } from '@aikami/backend/utils/auth';
import { UserCreateSchema, UserSchema, UserUpdateSchema } from '@aikami/schemas';
import type {
  RegisterForm,
  RepositoryType,
  UserClaims,
  UserCreateData,
  UserData,
  UserRole,
  UserUpdateData,
} from '@aikami/types';
import {
  getNotificationsCollectionPath,
  getUserDocumentPath,
  getUserFCMTokensCollectionPath,
  getUsersCollectionPath,
  toDisplayUsername,
  toUserRole,
} from '@aikami/utils';
import { logger } from '$logger';
import { BackendRepository, type BackendRepositoryInterface } from './base-backend-repository.ts';
import { deleteQuery } from './utils.ts';

export type UserRepositoryType = RepositoryType<
  typeof UserSchema,
  typeof UserCreateSchema,
  typeof UserUpdateSchema,
  undefined,
  {
    uid: string;
  }
>;

export type UserRepositoryInterface = BackendRepositoryInterface<UserRepositoryType>;

export const userRepository: UserRepositoryInterface = new BackendRepository<UserRepositoryType>({
  className: 'UserRepository',
  createSchema: UserCreateSchema,
  getCollectionPath: getUsersCollectionPath,
  getDocumentPath: getUserDocumentPath,
  schema: UserSchema,
  updateSchema: UserUpdateSchema,
});

/**
 * Read the user document from Firestore
 *
 * @param uid the id of the user
 */
export const getUserData = async (uid: string): Promise<undefined | UserData> => {
  try {
    return await userRepository.getDocument({ uid });
  } catch (error) {
    logger.error('getUserData', { error, uid });
    return;
  }
};

/**
 * Updates the user claims
 *
 * @param uid the id of the user
 * @param newClaims the user claims
 */
export const updateUserClaimsOptional = async (
  uid: string,
  newClaims: Partial<UserClaims>,
): Promise<boolean> => {
  const user = await getUserData(uid);
  if (!user) {
    return false;
  }

  return updateUserClaims({
    ...user,
    ...newClaims,
  });
};

/**
 * Updates the user document non-destructively
 *
 * @param uid the id of the user
 * @param userData the data to update
 * @param options the options
 */
export const updateUserData = async (
  uid: string,
  userData: Omit<Partial<UserUpdateData>, 'updatedAt'>,
  options: { merge?: boolean; rethrow?: boolean } = {},
): Promise<boolean> => {
  try {
    logger.log('updateUserData', { options, userData });

    await userRepository.updateDocument({
      getDocumentPathArgument: { uid },
      options,
      updateData: userData,
    });

    return true;
  } catch (error) {
    logger.error('updateUserData', error);
    if (options.rethrow) {
      throw error;
    }
    return false;
  }
};

/**
 * Set the user document.
 *
 * @param uid the id of the user
 * @param userData the data to set
 */
export const setUserData = async (uid: string, userData: UserCreateData): Promise<void> => {
  try {
    await userRepository.setDocument({
      getDocumentPathArgument: { uid },
      setData: userData,
    });
  } catch (error) {
    logger.error('setUserData', { error, uid });
  }
};

/**
 * Set the user document.
 *
 * @param uid the id of the user
 */
export const deleteUserData = async (uid: string): Promise<boolean> => {
  try {
    await userRepository.deleteDocument({
      uid,
    });
    return true;
  } catch (error) {
    logger.error('deleteUserData', { error, uid });
    return false;
  }
};

/**
 * Check if the user exists.
 *
 * @param uid the id of the user
 */
export const userExists = async (uid: string): Promise<boolean> => {
  try {
    const user = await getUserData(uid);
    return !!user;
  } catch (error) {
    logger.error('userExists', { error, uid });
    return false;
  }
};

/**
 * Check if the user exists.
 *
 * @param email the email of the user
 */
export const getUserByEmail = async (email: string): Promise<undefined | UserData> => {
  try {
    const users = await userRepository.getDocumentsByQuery({
      filters: [
        {
          field: 'email',
          operator: '==',
          value: email.toLocaleLowerCase(),
        },
      ],
      getCollectionPathArgument: undefined,
      limit: 1,
    });
    return users[0];
  } catch (error) {
    logger.error('getUserByEmail', { email, error });
    return;
  }
};

export const toUserCreateData = (options: {
  userCreateForm: Omit<RegisterForm, 'password'>;
  userRole?: UserRole;
}): UserCreateData => {
  logger.log('toUserCreateData', options);
  const { userCreateForm, userRole } = options;

  const userCreateData: UserCreateData = {
    agreedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    displayName: toDisplayUsername(userCreateForm),
    signInProviders: [userCreateForm.signInProvider],
    userRole: toUserRole(userRole),
  };

  if (userCreateForm.email) {
    userCreateData.email = userCreateForm.email.toLocaleLowerCase();
  }

  if (userCreateForm.displayName) {
    userCreateData.displayName = userCreateForm.displayName;
  }

  return userCreateData;
};

/**
 * Check if the user has created a team
 *
 * @param uid the id of the user
 * @returns true if the teams collections has a document where creatorUID ===
 *   uid
 */
export const deleteUserSubCollections = async (uid: string): Promise<boolean> => {
  try {
    const getUserTokensCollectionReference = (uid: string) =>
      getFirestore().collection(getUserFCMTokensCollectionPath({ uid }));

    const getUserNotificationsCollectionReference = (uid: string) =>
      getFirestore().collection(getNotificationsCollectionPath({ uid }));

    await deleteQuery(getUserTokensCollectionReference(uid));
    await deleteQuery(getUserNotificationsCollectionReference(uid));

    return true;
  } catch (error) {
    logger.error('deleteUserSubCollections', { error, uid });
    return false;
  }
};
