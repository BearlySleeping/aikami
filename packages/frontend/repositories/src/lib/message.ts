import { MessageCreateSchema, MessageSchema, MessageUpdateSchema } from '@aikami/schemas';
import { getMessageDocumentPath, getMessagesCollectionPath } from '@aikami/utils';
import {
	FrontendRepository,
	type FrontendRepositoryInterface,
} from './base-frontend-repository.ts';
import type { RepositoryType } from '@aikami/types';

export type MessageRepositoryType = RepositoryType<
	typeof MessageSchema,
	typeof MessageCreateSchema,
	typeof MessageUpdateSchema,
	{ uid: string },
	{ uid: string; chatId: string }
>;

export type MessageRepositoryInterface = FrontendRepositoryInterface<MessageRepositoryType>;

export const messageRepository: MessageRepositoryInterface = new FrontendRepository<
	MessageRepositoryType
>({
	className: 'MessageRepository',
	createSchema: MessageCreateSchema,
	updateSchema: MessageUpdateSchema,
	getCollectionPath: getMessagesCollectionPath,
	getDocumentPath: getMessageDocumentPath,
	schema: MessageSchema,
});
