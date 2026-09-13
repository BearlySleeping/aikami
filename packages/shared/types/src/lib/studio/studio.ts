// packages/shared/types/src/lib/studio/studio.ts
//
// C-512: Creator Studio types, derived from the TypeBox schemas in
// `@aikami/schemas` (Static Inference Law — never hand-written duplicates).
//
// Contract: C-512 Creator Studio and Runtime Asset Generation

import type {
  LibraryEntrySchema,
  StudioDraftSchema,
  StudioGeneratedResultSchema,
  StudioRecipeOptionSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type StudioRecipeOption = Static<typeof StudioRecipeOptionSchema>;
export type StudioGeneratedResult = Static<typeof StudioGeneratedResultSchema>;
export type StudioDraft = Static<typeof StudioDraftSchema>;
export type LibraryEntry = Static<typeof LibraryEntrySchema>;

/** Runtime-neutral result of a Studio library mutation. */
export type StudioMutationOutcome = {
  deleted?: boolean;
  reason?: string;
  references: readonly string[];
};
