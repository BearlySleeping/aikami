// packages/shared/types/src/lib/common/preferences.ts
import type { SupportedLocaleSchema } from '@aikami/schemas';
import type { Type } from 'typebox';

export type SupportedLocale = Type.Static<typeof SupportedLocaleSchema>;

export type LangData = {
  [key in SupportedLocale]?: string;
};
