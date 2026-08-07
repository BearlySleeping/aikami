import { NotificationSchema } from '@aikami/schemas';
import type { FirestoreRepositoryType } from '@aikami/types';
import { getNotificationDocumentPath, getNotificationsCollectionPath } from '@aikami/utils';
import {
  FirestoreFrontendRepository,
  type FirestoreFrontendRepositoryInterface,
} from './base_firestore_frontend_repository.ts';

type NotificationFirestoreRepositoryType = FirestoreRepositoryType<
  typeof NotificationSchema,
  never,
  never,
  { uid: string },
  { notificationId: string; uid: string }
>;

export type NotificationFirestoreRepositoryInterface =
  FirestoreFrontendRepositoryInterface<NotificationFirestoreRepositoryType>;

export const notificationFirestoreRepository: NotificationFirestoreRepositoryInterface =
  new FirestoreFrontendRepository<NotificationFirestoreRepositoryType>({
    className: 'NotificationFirestoreRepository',
    createSchema: undefined,
    getCollectionPath: getNotificationsCollectionPath,
    getDocumentPath: getNotificationDocumentPath,
    schema: NotificationSchema,
    updateSchema: undefined,
  });
