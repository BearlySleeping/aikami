// packages/shared/schemas/src/lib/image_style_profile.ts
//
// TypeBox schemas for the image generation pipeline (C-242).
// Covers style profiles, gallery images, prompt compilation, and contextual trigger configs.
//
// Contract: C-242 Image Generation Pipeline

import { type Static, Type } from 'typebox';

// ── Prompt grammar ─────────────────────────────────────────────────────

export const PromptGrammarSchema = Type.Union([
  Type.Literal('naturalLanguage'),
  Type.Literal('danbooru'),
  Type.Literal('commaTags'),
]);

export type PromptGrammar = Static<typeof PromptGrammarSchema>;

// ── Image type ─────────────────────────────────────────────────────────

export const ImageTypeSchema = Type.Union([
  Type.Literal('background'),
  Type.Literal('portrait'),
  Type.Literal('illustration'),
  Type.Literal('sprite'),
  Type.Literal('selfie'),
]);

export type ImageType = Static<typeof ImageTypeSchema>;

// ── Per-image tags ──────────────────────────────────────────────────────

export const PerImageTagsSchema = Type.Object({
  background: Type.Optional(Type.String()),
  portrait: Type.Optional(Type.String()),
  illustration: Type.Optional(Type.String()),
  sprite: Type.Optional(Type.String()),
  selfie: Type.Optional(Type.String()),
});

export type PerImageTags = Static<typeof PerImageTagsSchema>;

// ── Image style profile ────────────────────────────────────────────────

export const ImageStyleProfileSchema = Type.Object({
  id: Type.String({ description: 'Unique profile identifier' }),
  name: Type.String({ description: 'Human-readable profile name' }),
  isBuiltIn: Type.Boolean({ description: 'Whether this profile is built-in (immutable)' }),
  promptGrammar: PromptGrammarSchema,
  positiveTags: Type.String({ description: 'Base positive prompt tags' }),
  negativeTags: Type.String({ description: 'Base negative prompt tags' }),
  perImageTags: PerImageTagsSchema,
});

export type ImageStyleProfile = Static<typeof ImageStyleProfileSchema>;

// ── Compiled prompt output ─────────────────────────────────────────────

export const CompiledPromptSchema = Type.Object({
  positive: Type.String({ description: 'Cleaned positive prompt text' }),
  negative: Type.String({ description: 'Cleaned negative prompt text' }),
});

export type CompiledPrompt = Static<typeof CompiledPromptSchema>;

// ── Gallery image ──────────────────────────────────────────────────────

export const GalleryImageSchema = Type.Object({
  id: Type.String({ description: 'Unique image identifier' }),
  chatId: Type.String({ description: 'Chat/encounter this image belongs to' }),
  url: Type.String({ description: 'Image blob URL or data URL' }),
  prompt: Type.String({ description: 'Prompt used to generate the image' }),
  imageType: ImageTypeSchema,
  generatedAt: Type.String({ description: 'ISO-8601 timestamp of generation' }),
  characterName: Type.Optional(Type.String({ description: 'Associated NPC/character name' })),
});

export type GalleryImage = Static<typeof GalleryImageSchema>;

// ── Contextual trigger event ──────────────────────────────────────────

export const ContextualTriggerEventSchema = Type.Union([
  Type.Literal('location_changed'),
  Type.Literal('combat_started'),
  Type.Literal('npc_introduced'),
  Type.Literal('dramatic_moment'),
  Type.Literal('quest_completed'),
]);

export type ContextualTriggerEvent = Static<typeof ContextualTriggerEventSchema>;

// ── Contextual trigger config ──────────────────────────────────────────

export const ContextualTriggerConfigSchema = Type.Object({
  event: ContextualTriggerEventSchema,
  imageType: ImageTypeSchema,
  /** Debounce window in milliseconds — minimum time between triggers of the same event. */
  debounceMs: Type.Number({ default: 30000 }),
  /** Whether this trigger type is enabled. */
  enabled: Type.Boolean({ default: true }),
});

export type ContextualTriggerConfig = Static<typeof ContextualTriggerConfigSchema>;

// ── Review config ──────────────────────────────────────────────────────

export const ReviewConfigSchema = Type.Object({
  /** Global toggle — when enabled, shows review modal before every generation. */
  enabled: Type.Boolean({ default: false }),
});

export type ReviewConfig = Static<typeof ReviewConfigSchema>;
