import { ConfigCreateSchema, ConfigSchema, ConfigUpdateSchema } from '@aikami/schemas';
import type { RepositoryType } from '@aikami/types';
import { getConfigDocumentPath, getConfigsCollectionPath } from '@aikami/utils';
import {
  FrontendRepository,
  type FrontendRepositoryInterface,
} from './base-frontend-repository.ts';

export type ConfigRepositoryType = RepositoryType<
  typeof ConfigSchema,
  typeof ConfigCreateSchema,
  typeof ConfigUpdateSchema,
  undefined,
  { uid: string }
>;

export type ConfigRepositoryInterface = FrontendRepositoryInterface<ConfigRepositoryType>;

export const configRepository: ConfigRepositoryInterface =
  new FrontendRepository<ConfigRepositoryType>({
    className: 'ConfigRepository',
    createSchema: ConfigCreateSchema,
    getCollectionPath: getConfigsCollectionPath,
    getDocumentPath: getConfigDocumentPath,
    schema: ConfigSchema,
    updateSchema: ConfigUpdateSchema,
  });
