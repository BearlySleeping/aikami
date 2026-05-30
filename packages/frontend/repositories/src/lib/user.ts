import { UserSchema, UserUpdateSchema } from '@aikami/schemas';
import type { RepositoryType } from '@aikami/types';
import { getUserDocumentPath, getUsersCollectionPath } from '@aikami/utils';
import {
  FrontendRepository,
  type FrontendRepositoryInterface,
} from './base_frontend_repository.ts';

export type UserRepositoryType = RepositoryType<
  typeof UserSchema,
  never,
  typeof UserUpdateSchema,
  undefined,
  { uid: string }
>;

export type UserRepositoryInterface = FrontendRepositoryInterface<UserRepositoryType>;

export const userRepository: UserRepositoryInterface = new FrontendRepository<UserRepositoryType>({
  className: 'UserRepository',
  createSchema: undefined,
  getCollectionPath: getUsersCollectionPath,
  getDocumentPath: getUserDocumentPath,
  schema: UserSchema,
  updateSchema: UserUpdateSchema,
});
