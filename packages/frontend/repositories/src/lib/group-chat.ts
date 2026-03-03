import { GroupChatCreateSchema, GroupChatSchema, GroupChatUpdateSchema } from '@aikami/schemas';
import type { RepositoryType } from '@aikami/types';
import { getGroupChatDocumentPath, getGroupChatsCollectionPath } from '@aikami/utils';
import {
  FrontendRepository,
  type FrontendRepositoryInterface,
} from './base-frontend-repository.ts';

export type GroupChatRepositoryType = RepositoryType<
  typeof GroupChatSchema,
  typeof GroupChatCreateSchema,
  typeof GroupChatUpdateSchema,
  { uid: string },
  { uid: string; groupChatId: string }
>;

export type GroupChatRepositoryInterface = FrontendRepositoryInterface<GroupChatRepositoryType>;

export const groupChatRepository: GroupChatRepositoryInterface =
  new FrontendRepository<GroupChatRepositoryType>({
    className: 'GroupChatRepository',
    createSchema: GroupChatCreateSchema,
    getCollectionPath: getGroupChatsCollectionPath,
    getDocumentPath: getGroupChatDocumentPath,
    schema: GroupChatSchema,
    updateSchema: GroupChatUpdateSchema,
  });
