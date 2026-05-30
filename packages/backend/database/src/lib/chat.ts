import { ChatCreateSchema, ChatSchema, ChatUpdateSchema } from '@aikami/schemas';
import type { RepositoryType } from '@aikami/types';
import { getChatDocumentPath, getChatsCollectionPath } from '@aikami/utils';
import { BackendRepository, type BackendRepositoryInterface } from './base_backend_repository.ts';

export type ChatRepositoryType = RepositoryType<
  typeof ChatSchema,
  typeof ChatCreateSchema,
  typeof ChatUpdateSchema,
  Record<string, never>,
  { chatId: string }
>;

export type ChatRepositoryInterface = BackendRepositoryInterface<ChatRepositoryType>;

export const chatRepository: ChatRepositoryInterface = new BackendRepository<ChatRepositoryType>({
  className: 'ChatRepository',
  createSchema: ChatCreateSchema,
  updateSchema: ChatUpdateSchema,
  getCollectionPath: getChatsCollectionPath,
  getDocumentPath: getChatDocumentPath,
  schema: ChatSchema,
});
