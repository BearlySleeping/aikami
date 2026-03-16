import { ChatCreateSchema, ChatSchema, ChatUpdateSchema } from '@aikami/schemas';
import type { RepositoryType } from '@aikami/types';
import { getChatDocumentPath, getChatsCollectionPath } from '@aikami/utils';
import {
  FrontendRepository,
  type FrontendRepositoryInterface,
} from './base-frontend-repository.ts';

export type ChatRepositoryType = RepositoryType<
  typeof ChatSchema,
  typeof ChatCreateSchema,
  typeof ChatUpdateSchema,
  undefined,
  { chatId: string }
>;

export type ChatRepositoryInterface = FrontendRepositoryInterface<ChatRepositoryType>;

export const chatRepository: ChatRepositoryInterface = new FrontendRepository<ChatRepositoryType>({
  className: 'NpcChatRepository',
  createSchema: ChatCreateSchema,
  getCollectionPath: getChatsCollectionPath,
  getDocumentPath: getChatDocumentPath,
  schema: ChatSchema,
  updateSchema: ChatUpdateSchema,
});
