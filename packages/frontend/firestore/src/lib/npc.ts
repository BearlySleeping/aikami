import { NpcCreateSchema, NpcSchema, NpcUpdateSchema } from '@aikami/schemas';
import type { FirestoreRepositoryType } from '@aikami/types';
import { getNpcDocumentPath, getNpcsCollectionPath } from '@aikami/utils';
import {
  FirestoreFrontendRepository,
  type FirestoreFrontendRepositoryInterface,
} from './base_firestore_frontend_repository.ts';

export type NpcFirestoreRepositoryType = FirestoreRepositoryType<
  typeof NpcSchema,
  typeof NpcCreateSchema,
  typeof NpcUpdateSchema,
  undefined,
  { npcId: string }
>;

export type NpcFirestoreRepositoryInterface =
  FirestoreFrontendRepositoryInterface<NpcFirestoreRepositoryType>;

export const npcFirestoreRepository: NpcFirestoreRepositoryInterface =
  new FirestoreFrontendRepository<NpcFirestoreRepositoryType>({
    className: 'NpcFirestoreRepository',
    createSchema: NpcCreateSchema,
    getCollectionPath: getNpcsCollectionPath,
    getDocumentPath: getNpcDocumentPath,
    schema: NpcSchema,
    updateSchema: NpcUpdateSchema,
  });
