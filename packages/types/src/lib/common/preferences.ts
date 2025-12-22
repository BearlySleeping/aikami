import type { SupportedLocaleSchema } from '@aikami/schemas'
import type { z } from 'zod'

export type SupportedLocale = z.infer<typeof SupportedLocaleSchema>

export type LangData = {
  [key in SupportedLocale]?: string
}
