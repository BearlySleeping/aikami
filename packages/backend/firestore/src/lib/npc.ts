import { NpcCreateSchema, NpcSchema, NpcUpdateSchema } from '@aikami/schemas';
import type { FirestoreRepositoryType } from '@aikami/types';
import { getNpcDocumentPath, getNpcsCollectionPath } from '@aikami/utils';
import {
  FirestoreBackendRepository,
  type FirestoreBackendRepositoryInterface,
} from './base_firestore_backend_repository.ts';

export type NpcFirestoreRepositoryType = FirestoreRepositoryType<
  typeof NpcSchema,
  typeof NpcCreateSchema,
  typeof NpcUpdateSchema,
  Record<string, never>,
  { npcId: string }
>;

export type NpcFirestoreRepositoryInterface =
  FirestoreBackendRepositoryInterface<NpcFirestoreRepositoryType>;

export const npcFirestoreRepository: NpcFirestoreRepositoryInterface =
  new FirestoreBackendRepository<NpcFirestoreRepositoryType>({
    className: 'NpcFirestoreRepository',
    createSchema: NpcCreateSchema,
    updateSchema: NpcUpdateSchema,
    getCollectionPath: getNpcsCollectionPath,
    getDocumentPath: getNpcDocumentPath,
    schema: NpcSchema,
  });
