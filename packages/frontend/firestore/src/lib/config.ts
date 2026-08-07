import { ConfigCreateSchema, ConfigSchema, ConfigUpdateSchema } from '@aikami/schemas';
import type { FirestoreRepositoryType } from '@aikami/types';
import { getConfigDocumentPath, getConfigsCollectionPath } from '@aikami/utils';
import {
  FirestoreFrontendRepository,
  type FirestoreFrontendRepositoryInterface,
} from './base_firestore_frontend_repository.ts';

export type ConfigFirestoreRepositoryType = FirestoreRepositoryType<
  typeof ConfigSchema,
  typeof ConfigCreateSchema,
  typeof ConfigUpdateSchema,
  undefined,
  { uid: string }
>;

export type ConfigFirestoreRepositoryInterface =
  FirestoreFrontendRepositoryInterface<ConfigFirestoreRepositoryType>;

export const configFirestoreRepository: ConfigFirestoreRepositoryInterface =
  new FirestoreFrontendRepository<ConfigFirestoreRepositoryType>({
    className: 'ConfigFirestoreRepository',
    createSchema: ConfigCreateSchema,
    getCollectionPath: getConfigsCollectionPath,
    getDocumentPath: getConfigDocumentPath,
    schema: ConfigSchema,
    updateSchema: ConfigUpdateSchema,
  });
