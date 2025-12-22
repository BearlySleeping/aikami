import type { RepositoryType } from '@aikami/types'

import { NotificationCreateSchema, NotificationSchema } from '@aikami/schemas'
import { getNotificationDocumentPath, getNotificationsCollectionPath } from '@aikami/utils'
import { BackendRepository, type BackendRepositoryInterface } from './base-backend-repository.ts'

export type NotificationRepositoryType = RepositoryType<
  typeof NotificationSchema,
  typeof NotificationCreateSchema,
  never,
  { uid: string },
  {
    notificationId: string
    uid: string
  }
>

export type NotificationRepositoryInterface = BackendRepositoryInterface<
  NotificationRepositoryType
>

export const notificationRepository: NotificationRepositoryInterface = new BackendRepository<
  NotificationRepositoryType
>({
  className: 'NotificationRepository',
  createSchema: NotificationCreateSchema,
  getCollectionPath: getNotificationsCollectionPath,
  getDocumentPath: getNotificationDocumentPath,
  schema: NotificationSchema,
  updateSchema: undefined,
})
