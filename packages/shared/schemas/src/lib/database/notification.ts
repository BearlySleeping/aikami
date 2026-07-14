/** biome-ignore-all lint/suspicious/noExplicitAny: Type.Unsafe<any> required for Firestore-specific types */
// packages/shared/schemas/src/lib/database/notification.ts
import Type, { Composite } from 'typebox';
import { CoreOmitKeys, CoreSchema } from '../core/core.ts';

export const NotificationGenericSchema = Type.Object({
  title: Type.String(),
  description: Type.Number(),
});

export type NotificationGeneric = Type.Static<typeof NotificationGenericSchema>;
export const NotificationTypesSchema = Type.Object({
  generic: NotificationGenericSchema,
});

export type NotificationTypes = Type.Static<typeof NotificationTypesSchema>;
export const NotificationTextSchema = Type.Object({
  subtitle: Type.Optional(Type.String()),
  title: Type.String(),
});

export type NotificationText = Type.Static<typeof NotificationTextSchema>;
export const NotificationTypeSchema = Type.Union([
  Type.Literal('ctaClicked'),
  Type.Literal('videoViewed'),
]);

export type NotificationType = Type.Static<typeof NotificationTypeSchema>;
export const NotificationSchema = Composite(
  CoreSchema,
  Type.Object({
    notificationPayload: NotificationGenericSchema,
    notificationType: NotificationTypeSchema,
    uid: Type.String(),
  }),
);

export type Notification = Type.Static<typeof NotificationSchema>;
export const NotificationCreateSchema = Type.Intersect([
  Type.Omit(NotificationSchema, [...CoreOmitKeys]),
  Type.Object({ createdAt: Type.Optional(Type.Unsafe<any>(Type.Any())) }),
]);

export type NotificationCreate = Type.Static<typeof NotificationCreateSchema>;
