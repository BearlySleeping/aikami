import { UserSchema, UserUpdateSchema } from '@aikami/schemas';
import type { FirestoreRepositoryType } from '@aikami/types';
import { getUserDocumentPath, getUsersCollectionPath } from '@aikami/utils';
import {
  FirestoreFrontendRepository,
  type FirestoreFrontendRepositoryInterface,
} from './base_firestore_frontend_repository.ts';

export type UserFirestoreRepositoryType = FirestoreRepositoryType<
  typeof UserSchema,
  never,
  typeof UserUpdateSchema,
  undefined,
  { uid: string }
>;

export type UserFirestoreRepositoryInterface =
  FirestoreFrontendRepositoryInterface<UserFirestoreRepositoryType>;

export const userFirestoreRepository: UserFirestoreRepositoryInterface =
  new FirestoreFrontendRepository<UserFirestoreRepositoryType>({
    className: 'UserFirestoreRepository',
    createSchema: undefined,
    getCollectionPath: getUsersCollectionPath,
    getDocumentPath: getUserDocumentPath,
    schema: UserSchema,
    updateSchema: UserUpdateSchema,
  });
