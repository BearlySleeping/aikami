import { z } from 'zod'
import { CoreCreateSchema, CoreOmitSchema, CoreSchema } from '../core.ts'

export const NotificationGenericSchema = z.object({
  title: z.string(),
  description: z.number(),
})

export const NotificationTypesSchema = z.object({
  generic: NotificationGenericSchema,
})

export const NotificationTextSchema = z.object({
  subtitle: z.string().optional(),
  title: z.string(),
})
export const NotificationTypeSchema = z.enum(['ctaClicked', 'videoViewed'])

export const NotificationSchema = CoreSchema.extend({
  notificationPayload: z.union([
    NotificationGenericSchema,
  ]),
  notificationType: NotificationTypeSchema,
  uid: z.string(),
})

export const NotificationCreateSchema = NotificationSchema.omit(CoreOmitSchema).extend(
  CoreCreateSchema.shape,
)
