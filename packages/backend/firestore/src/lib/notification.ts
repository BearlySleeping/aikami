import { NotificationCreateSchema, NotificationSchema } from '@aikami/schemas';
import type { FirestoreRepositoryType } from '@aikami/types';
import { getNotificationDocumentPath, getNotificationsCollectionPath } from '@aikami/utils';
import {
  FirestoreBackendRepository,
  type FirestoreBackendRepositoryInterface,
} from './base_firestore_backend_repository.ts';

export type NotificationFirestoreRepositoryType = FirestoreRepositoryType<
  typeof NotificationSchema,
  typeof NotificationCreateSchema,
  never,
  { uid: string },
  {
    notificationId: string;
    uid: string;
  }
>;

export type NotificationFirestoreRepositoryInterface =
  FirestoreBackendRepositoryInterface<NotificationFirestoreRepositoryType>;

export const notificationFirestoreRepository: NotificationFirestoreRepositoryInterface =
  new FirestoreBackendRepository<NotificationFirestoreRepositoryType>({
    className: 'NotificationFirestoreRepository',
    createSchema: NotificationCreateSchema,
    getCollectionPath: getNotificationsCollectionPath,
    getDocumentPath: getNotificationDocumentPath,
    schema: NotificationSchema,
    updateSchema: undefined,
  });
