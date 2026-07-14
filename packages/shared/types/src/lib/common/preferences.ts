// packages/shared/types/src/lib/common/preferences.ts
//
// Schema-derived names re-exported from @aikami/schemas; hand-authored types remain.

import type { SupportedLocale } from '@aikami/schemas';

export type { SupportedLocale };

export type LangData = {
  [Key in SupportedLocale]?: string;
};
