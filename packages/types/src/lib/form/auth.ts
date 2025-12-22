import type { z } from 'zod'
import type { RegisterFormSchema } from '@aikami/schemas'

export type RegisterForm = z.infer<typeof RegisterFormSchema>
