import type {
  NotificationCreateSchema,
  NotificationSchema,
  NotificationTextSchema,
  NotificationTypesSchema,
} from '@aikami/schemas';
import type { z } from 'zod';

export type NotificationCreateData = z.infer<typeof NotificationCreateSchema>;

export type NotificationData = z.infer<typeof NotificationSchema>;

export type NotificationPayload<T extends NotificationType = NotificationType> =
  NotificationTypes[T];

export type NotificationText = z.infer<typeof NotificationTextSchema>;

export type NotificationType = keyof NotificationTypes;

type NotificationTypes = z.infer<typeof NotificationTypesSchema>;
