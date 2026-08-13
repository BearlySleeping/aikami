import { deleteFirebaseAuthUser } from '@aikami/backend/utils/auth.ts';
import type { AuthMessageResponse } from '@aikami/types';

/**
 * Removes the user's Firebase Auth account.
 *
 * The Firestore user document was deleted (C-386 OQ1) — only the Auth record
 * remains to delete.
 *
 * @param uid the user id
 */
export const deleteAccount = async (uid: string): Promise<AuthMessageResponse<'deleteAccount'>> => {
  await deleteFirebaseAuthUser(uid);
  return undefined;
};
