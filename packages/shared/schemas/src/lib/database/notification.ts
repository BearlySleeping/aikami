// packages/shared/schemas/src/lib/database/notification.ts
import Type, { Composite } from 'typebox';
import { CoreOmitKeys, CoreSchema } from '../core.ts';

export const NotificationGenericSchema = Type.Object({
  title: Type.String(),
  description: Type.Number(),
});

export const NotificationTypesSchema = Type.Object({
  generic: NotificationGenericSchema,
});

export const NotificationTextSchema = Type.Object({
  subtitle: Type.Optional(Type.String()),
  title: Type.String(),
});

export const NotificationTypeSchema = Type.Union([
  Type.Literal('ctaClicked'),
  Type.Literal('videoViewed'),
]);

export const NotificationSchema = Composite(
  CoreSchema,
  Type.Object({
    notificationPayload: NotificationGenericSchema,
    notificationType: NotificationTypeSchema,
    uid: Type.String(),
  }),
);

export const NotificationCreateSchema = Type.Intersect([
  Type.Omit(NotificationSchema, [...CoreOmitKeys]),
  Type.Object({ createdAt: Type.Optional(Type.Unsafe<any>(Type.Any())) }),
]);
