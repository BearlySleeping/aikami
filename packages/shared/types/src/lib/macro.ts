// packages/shared/types/src/lib/macro.ts
//
// Inferred TypeScript types for the prompt template macro system (C-237).
// Derived from TypeBox schemas in @aikami/schemas.

import type { MacroContextSchema, PromptPresetSchema, PromptSectionSchema } from '@aikami/schemas';
import type { Type } from 'typebox';

export type MacroContext = Type.Static<typeof MacroContextSchema>;
export type PromptSection = Type.Static<typeof PromptSectionSchema>;
export type PromptPreset = Type.Static<typeof PromptPresetSchema>;
