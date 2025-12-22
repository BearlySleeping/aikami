import { z } from 'zod'
import { CoreCreateSchema, CoreOmitSchema, CoreSchema, CoreUpdateSchema } from '../core.ts'
import { getDeletableFields } from '../utils.ts'

export const MessageSchema = CoreSchema.extend({
  text: z.string(),
  sender: z.enum(['user', 'ai']),
})

export const MessageCreateSchema = MessageSchema.omit(CoreOmitSchema).extend(
  CoreCreateSchema.shape,
)

export const MessageUpdateSchema = MessageSchema
  .extend(getDeletableFields(MessageSchema)).omit(CoreOmitSchema)
  .extend(CoreUpdateSchema.shape)
