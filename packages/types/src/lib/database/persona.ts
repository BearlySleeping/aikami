import type { PersonaCreateSchema, PersonaSchema, PersonaUpdateSchema } from '@aikami/schemas'
import type { z } from 'zod'

export type PersonaData = z.infer<typeof PersonaSchema>

export type PersonaCreateData = z.infer<typeof PersonaCreateSchema>

export type PersonaUpdateData = z.infer<typeof PersonaUpdateSchema>
