import { ConfigCreateSchema, ConfigSchema, ConfigUpdateSchema } from '@aikami/schemas';
import type { FirestoreRepositoryType } from '@aikami/types';
import { getConfigDocumentPath, getConfigsCollectionPath } from '@aikami/utils';
import {
  FirestoreBackendRepository,
  type FirestoreBackendRepositoryInterface,
} from './base_firestore_backend_repository.ts';

export type ConfigFirestoreRepositoryType = FirestoreRepositoryType<
  typeof ConfigSchema,
  typeof ConfigCreateSchema,
  typeof ConfigUpdateSchema,
  undefined,
  { uid: string }
>;

export type ConfigFirestoreRepositoryInterface =
  FirestoreBackendRepositoryInterface<ConfigFirestoreRepositoryType>;

export const configFirestoreRepository: ConfigFirestoreRepositoryInterface =
  new FirestoreBackendRepository<ConfigFirestoreRepositoryType>({
    className: 'ConfigFirestoreRepository',
    createSchema: ConfigCreateSchema,
    updateSchema: ConfigUpdateSchema,
    getCollectionPath: getConfigsCollectionPath,
    getDocumentPath: getConfigDocumentPath,
    schema: ConfigSchema,
  });
