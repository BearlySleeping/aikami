import { ChatCreateSchema, ChatSchema, ChatUpdateSchema } from '@aikami/schemas';
import type { FirestoreRepositoryType } from '@aikami/types';
import { getChatDocumentPath, getChatsCollectionPath } from '@aikami/utils';
import {
  FirestoreFrontendRepository,
  type FirestoreFrontendRepositoryInterface,
} from './base_firestore_frontend_repository.ts';

export type ChatFirestoreRepositoryType = FirestoreRepositoryType<
  typeof ChatSchema,
  typeof ChatCreateSchema,
  typeof ChatUpdateSchema,
  undefined,
  { chatId: string }
>;

export type ChatFirestoreRepositoryInterface =
  FirestoreFrontendRepositoryInterface<ChatFirestoreRepositoryType>;

export const chatFirestoreRepository: ChatFirestoreRepositoryInterface =
  new FirestoreFrontendRepository<ChatFirestoreRepositoryType>({
    className: 'NpcChatFirestoreRepository',
    createSchema: ChatCreateSchema,
    getCollectionPath: getChatsCollectionPath,
    getDocumentPath: getChatDocumentPath,
    schema: ChatSchema,
    updateSchema: ChatUpdateSchema,
  });
