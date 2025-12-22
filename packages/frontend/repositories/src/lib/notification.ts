import { NotificationSchema } from '@aikami/schemas';
import { getNotificationDocumentPath, getNotificationsCollectionPath } from '@aikami/utils';
import {
	FrontendRepository,
	type FrontendRepositoryInterface,
} from './base-frontend-repository.ts';
import type { RepositoryType } from '@aikami/types';

type NotificationRepositoryType = RepositoryType<
	typeof NotificationSchema,
	never,
	never,
	{ uid: string },
	{ notificationId: string; uid: string }
>;

export type NotificationRepositoryInterface = FrontendRepositoryInterface<
	NotificationRepositoryType
>;

export const notificationRepository: NotificationRepositoryInterface = new FrontendRepository<
	NotificationRepositoryType
>({
	className: 'NotificationRepository',
	createSchema: undefined,
	getCollectionPath: getNotificationsCollectionPath,
	getDocumentPath: getNotificationDocumentPath,
	schema: NotificationSchema,
	updateSchema: undefined,
});
