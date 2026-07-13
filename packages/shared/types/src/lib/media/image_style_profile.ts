// packages/shared/types/src/lib/image_style_profile.ts
//
// Static types derived from TypeBox schemas for the image generation pipeline (C-242).
//
// Contract: C-242 Image Generation Pipeline

import type {
  CompiledPromptSchema,
  ContextualTriggerConfigSchema,
  ContextualTriggerEventSchema,
  GalleryImageSchema,
  ImageStyleProfileSchema,
  ImageTypeSchema,
  PerImageTagsSchema,
  PromptGrammarSchema,
  ReviewConfigSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type PromptGrammar = Static<typeof PromptGrammarSchema>;
export type ImageType = Static<typeof ImageTypeSchema>;
export type PerImageTags = Static<typeof PerImageTagsSchema>;
export type ImageStyleProfile = Static<typeof ImageStyleProfileSchema>;
export type CompiledPrompt = Static<typeof CompiledPromptSchema>;
export type GalleryImage = Static<typeof GalleryImageSchema>;
export type ContextualTriggerEvent = Static<typeof ContextualTriggerEventSchema>;
export type ContextualTriggerConfig = Static<typeof ContextualTriggerConfigSchema>;
export type ReviewConfig = Static<typeof ReviewConfigSchema>;
