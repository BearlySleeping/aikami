import { NpcCreateSchema, NpcSchema, NpcUpdateSchema } from '@aikami/schemas';
import type { RepositoryType } from '@aikami/types';
import { getNpcDocumentPath, getNpcsCollectionPath } from '@aikami/utils';
import { BackendRepository, type BackendRepositoryInterface } from './base-backend-repository.ts';

export type NpcRepositoryType = RepositoryType<
  typeof NpcSchema,
  typeof NpcCreateSchema,
  typeof NpcUpdateSchema,
  Record<string, never>,
  { npcId: string }
>;

export type NpcRepositoryInterface = BackendRepositoryInterface<NpcRepositoryType>;

export const npcRepository: NpcRepositoryInterface = new BackendRepository<NpcRepositoryType>({
  className: 'NpcRepository',
  createSchema: NpcCreateSchema,
  updateSchema: NpcUpdateSchema,
  getCollectionPath: getNpcsCollectionPath,
  getDocumentPath: getNpcDocumentPath,
  schema: NpcSchema,
});
