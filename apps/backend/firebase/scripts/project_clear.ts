import { getAuth, getBucket, getProjectId } from '@aikami/backend/configs';
// @ts-expect-error
import firebase from 'firebase-tools';

/**
 * Clear the entire firestore database.
 *
 * If it fails use
 *
 * firebase firestore:delete --all-collections --project aikami-dev
 *
 * instead
 */
export const clearDatabase = async (): Promise<void> => {
  await firebase.firestore.delete(null, {
    allCollections: true,
    project: getProjectId(),
    recursive: true,
    yes: true,
  });
};

/**
 * Clear the entire firebase storage
 *
 * @param prefix The prefix to delete
 */
export const clearStorage = async (prefix?: string): Promise<void> => {
  const bucket = getBucket();
  await bucket.deleteFiles({ force: true, prefix });
};

/** Deletes all the users from firebase auth */
export const deleteAllUsers = async (): Promise<void> => {
  const auth = getAuth();
  // List batch of users, (if over 1000 users use the hidden function (don't work with jest))
  const listUsersResult = await auth.listUsers();

  if (listUsersResult.users.length === 0) {
    return;
  }

  await auth.deleteUsers(listUsersResult.users.map((userRecord) => userRecord.uid));
};

await Promise.all([clearDatabase(), clearStorage(), deleteAllUsers()]);
