import type { z } from 'zod'
import type { CoreCreateSchema, CoreSchema, CoreUpdateSchema } from '@aikami/schemas'

export type CoreData = z.infer<typeof CoreSchema>

export type CoreCreateData = z.infer<typeof CoreCreateSchema>
export type CoreUpdateData = z.infer<typeof CoreUpdateSchema>
