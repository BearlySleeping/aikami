// packages/backend/database/src/lib/message.ts
import { MessageCreateSchema, MessageSchema, MessageUpdateSchema } from '@aikami/schemas';
import type { RepositoryType } from '@aikami/types';
import { getMessageDocumentPath, getMessagesCollectionPath } from '@aikami/utils';
import { BackendRepository, type BackendRepositoryInterface } from './base_backend_repository.ts';

export type MessageRepositoryType = RepositoryType<
  typeof MessageSchema,
  typeof MessageCreateSchema,
  typeof MessageUpdateSchema,
  { chatId: string },
  { chatId: string; messageId: string }
>;

export type MessageRepositoryInterface = BackendRepositoryInterface<MessageRepositoryType>;

export const messageRepository: MessageRepositoryInterface =
  new BackendRepository<MessageRepositoryType>({
    className: 'MessageRepository',
    createSchema: MessageCreateSchema,
    updateSchema: MessageUpdateSchema,
    getCollectionPath: getMessagesCollectionPath,
    getDocumentPath: getMessageDocumentPath,
    schema: MessageSchema,
  });
