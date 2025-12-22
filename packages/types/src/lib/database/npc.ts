import type { NpcCreateSchema, NpcSchema, NpcUpdateSchema } from '@aikami/schemas'
import type { z } from 'zod'

export type NpcData = z.infer<typeof NpcSchema>

export type NpcCreateData = z.infer<typeof NpcCreateSchema>

export type NpcUpdateData = z.infer<typeof NpcUpdateSchema>
