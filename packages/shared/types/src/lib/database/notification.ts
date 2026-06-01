// packages/shared/types/src/lib/database/notification.ts
import type {
  NotificationCreateSchema,
  NotificationSchema,
  NotificationTextSchema,
  NotificationTypesSchema,
} from '@aikami/schemas';
import type { Type } from 'typebox';

export type NotificationCreateData = Type.Static<typeof NotificationCreateSchema>;

export type NotificationData = Type.Static<typeof NotificationSchema>;

export type NotificationPayload<T extends NotificationType = NotificationType> =
  NotificationTypes[T];

export type NotificationText = Type.Static<typeof NotificationTextSchema>;

export type NotificationType = keyof NotificationTypes;

type NotificationTypes = Type.Static<typeof NotificationTypesSchema>;
