import { NpcCreateSchema, NpcSchema, NpcUpdateSchema } from '@aikami/schemas';
import type { RepositoryType } from '@aikami/types';
import { getNpcDocumentPath, getNpcsCollectionPath } from '@aikami/utils';
import {
  FrontendRepository,
  type FrontendRepositoryInterface,
} from './base_frontend_repository.ts';

export type NpcRepositoryType = RepositoryType<
  typeof NpcSchema,
  typeof NpcCreateSchema,
  typeof NpcUpdateSchema,
  undefined,
  { npcId: string }
>;

export type NpcRepositoryInterface = FrontendRepositoryInterface<NpcRepositoryType>;

export const npcRepository: NpcRepositoryInterface = new FrontendRepository<NpcRepositoryType>({
  className: 'NpcRepository',
  createSchema: NpcCreateSchema,
  getCollectionPath: getNpcsCollectionPath,
  getDocumentPath: getNpcDocumentPath,
  schema: NpcSchema,
  updateSchema: NpcUpdateSchema,
});
