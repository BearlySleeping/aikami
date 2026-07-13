// packages/shared/schemas/src/lib/macro.ts
//
// TypeBox schemas for the prompt template macro system (C-237).
// Defines the macro context, prompt sections, prompt presets, and built-in presets.

import Type from 'typebox';

// ── Macro context ────────────────────────────────────────────────────────

/**
 * Context data supplied to macro resolution.
 * All fields are optional — unknown macros passthrough and missing
 * context fields resolve to empty string.
 */
export const MacroContextSchema = Type.Object({
  /** User's display name / identity. */
  userName: Type.Optional(Type.String()),

  /** Character being roleplayed as. */
  characterName: Type.Optional(Type.String()),

  /** Character's detailed description / biography. */
  characterDescription: Type.Optional(Type.String()),

  /** Character's personality traits. */
  characterPersonality: Type.Optional(Type.String()),

  /** Current scenario / world context. */
  scenario: Type.Optional(Type.String()),

  /** The user's persona description. */
  persona: Type.Optional(Type.String()),

  /** Current chat conversation history (plain text). */
  chatHistory: Type.Optional(Type.String()),

  /** Current user message / query. */
  userMessage: Type.Optional(Type.String()),

  /** Other characters present in the scene. */
  otherCharacters: Type.Optional(Type.String()),

  /** Additional free-form context key-value pairs. */
  extraContext: Type.Optional(Type.Record(Type.String(), Type.String())),
});

// ── Prompt section ───────────────────────────────────────────────────────

/**
 * A single section within a prompt preset.
 * Sections are assembled in order and their content is resolved
 * through the macro system before sending to the AI.
 */
export const PromptSectionSchema = Type.Object({
  /** Unique section ID for ordering and reference. */
  id: Type.String(),

  /** Human-readable section name (e.g. "System Prompt", "Character Card"). */
  name: Type.String(),

  /** The raw template content containing macros. */
  content: Type.String(),

  /** Whether this section is enabled (disabled sections are skipped on assembly). */
  enabled: Type.Optional(Type.Boolean()),

  /** Optional section order index for drag-to-reorder. */
  order: Type.Optional(Type.Number()),
});

// ── Prompt preset ────────────────────────────────────────────────────────

/**
 * A complete prompt preset composed of multiple sections.
 * Built-in presets are shipped with the app and cannot be deleted
 * (though they can be duplicated and modified).
 */
export const PromptPresetSchema = Type.Object({
  /** Unique preset identifier. */
  id: Type.String(),

  /** Human-readable preset name. */
  name: Type.String(),

  /** Optional description of what this preset is for. */
  description: Type.Optional(Type.String()),

  /** Ordered list of sections that make up this preset. */
  sections: Type.Array(PromptSectionSchema),

  /** Whether this is a built-in preset (cannot be deleted). */
  isBuiltIn: Type.Optional(Type.Boolean()),

  /** ISO timestamp of last modification. */
  updatedAt: Type.Optional(Type.String()),
});

// ── Inferred types ───────────────────────────────────────────────────────

export type MacroContext = Type.Static<typeof MacroContextSchema>;
export type PromptSection = Type.Static<typeof PromptSectionSchema>;
export type PromptPreset = Type.Static<typeof PromptPresetSchema>;
