import { ChatCreateSchema, ChatSchema, ChatUpdateSchema } from '@aikami/schemas';
import type { FirestoreRepositoryType } from '@aikami/types';
import { getChatDocumentPath, getChatsCollectionPath } from '@aikami/utils';
import {
  FirestoreBackendRepository,
  type FirestoreBackendRepositoryInterface,
} from './base_firestore_backend_repository.ts';

export type ChatFirestoreRepositoryType = FirestoreRepositoryType<
  typeof ChatSchema,
  typeof ChatCreateSchema,
  typeof ChatUpdateSchema,
  Record<string, never>,
  { chatId: string }
>;

export type ChatFirestoreRepositoryInterface =
  FirestoreBackendRepositoryInterface<ChatFirestoreRepositoryType>;

export const chatFirestoreRepository: ChatFirestoreRepositoryInterface =
  new FirestoreBackendRepository<ChatFirestoreRepositoryType>({
    className: 'ChatFirestoreRepository',
    createSchema: ChatCreateSchema,
    updateSchema: ChatUpdateSchema,
    getCollectionPath: getChatsCollectionPath,
    getDocumentPath: getChatDocumentPath,
    schema: ChatSchema,
  });
