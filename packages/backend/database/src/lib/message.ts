import { MessageCreateSchema, MessageSchema, MessageUpdateSchema } from '@aikami/schemas';
import type { RepositoryType } from '@aikami/types';
import { getMessageDocumentPath, getMessagesCollectionPath } from '@aikami/utils';
import { BackendRepository, type BackendRepositoryInterface } from './base-backend-repository.ts';

export type MessageRepositoryType = RepositoryType<
  typeof MessageSchema,
  typeof MessageCreateSchema,
  typeof MessageUpdateSchema,
  { uid: string },
  { uid: string; chatId: string }
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
