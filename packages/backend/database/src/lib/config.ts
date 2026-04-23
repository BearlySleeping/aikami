import { ConfigCreateSchema, ConfigSchema, ConfigUpdateSchema } from '@aikami/schemas';
import type { RepositoryType } from '@aikami/types';
import { getConfigDocumentPath, getConfigsCollectionPath } from '@aikami/utils';
import { BackendRepository, type BackendRepositoryInterface } from './base-backend-repository.ts';

export type ConfigRepositoryType = RepositoryType<
  typeof ConfigSchema,
  typeof ConfigCreateSchema,
  typeof ConfigUpdateSchema,
  undefined,
  { uid: string }
>;

export type ConfigRepositoryInterface = BackendRepositoryInterface<ConfigRepositoryType>;

export const configRepository: ConfigRepositoryInterface =
  new BackendRepository<ConfigRepositoryType>({
    className: 'ConfigRepository',
    createSchema: ConfigCreateSchema,
    updateSchema: ConfigUpdateSchema,
    getCollectionPath: getConfigsCollectionPath,
    getDocumentPath: getConfigDocumentPath,
    schema: ConfigSchema,
  });
