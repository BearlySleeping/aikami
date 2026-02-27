import { deleteUserData } from '@aikami/backend/database/user.ts';
import { deleteFirebaseAuthUser } from '@aikami/backend/utils/auth.ts';
import type { AuthMessageResponse } from '@aikami/types';

/**
 * Removes the user firebase and firestore
 *
 * @param uid the user id
 */
export const deleteAccount = async (uid: string): Promise<AuthMessageResponse<'deleteAccount'>> => {
  await deleteFirebaseAuthUser(uid);
  await deleteUserData(uid);
  return undefined;
};
