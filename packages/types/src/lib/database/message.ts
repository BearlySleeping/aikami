import type { MessageCreateSchema, MessageSchema, MessageUpdateSchema } from '@aikami/schemas'
import type { z } from 'zod'

export type MessageCreateData = z.infer<typeof MessageCreateSchema>

export type MessageUpdateData = z.infer<typeof MessageUpdateSchema>

export type MessageData = z.infer<typeof MessageSchema>
