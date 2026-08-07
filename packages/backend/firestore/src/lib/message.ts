// packages/backend/firestore/src/lib/message.ts
import { MessageCreateSchema, MessageSchema, MessageUpdateSchema } from '@aikami/schemas';
import type { FirestoreRepositoryType } from '@aikami/types';
import { getMessageDocumentPath, getMessagesCollectionPath } from '@aikami/utils';
import {
  FirestoreBackendRepository,
  type FirestoreBackendRepositoryInterface,
} from './base_firestore_backend_repository.ts';

export type MessageFirestoreRepositoryType = FirestoreRepositoryType<
  typeof MessageSchema,
  typeof MessageCreateSchema,
  typeof MessageUpdateSchema,
  { chatId: string },
  { chatId: string; messageId: string }
>;

export type MessageFirestoreRepositoryInterface =
  FirestoreBackendRepositoryInterface<MessageFirestoreRepositoryType>;

export const messageFirestoreRepository: MessageFirestoreRepositoryInterface =
  new FirestoreBackendRepository<MessageFirestoreRepositoryType>({
    className: 'MessageFirestoreRepository',
    createSchema: MessageCreateSchema,
    updateSchema: MessageUpdateSchema,
    getCollectionPath: getMessagesCollectionPath,
    getDocumentPath: getMessageDocumentPath,
    schema: MessageSchema,
  });
