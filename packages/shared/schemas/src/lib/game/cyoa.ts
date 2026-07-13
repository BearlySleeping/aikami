// packages/shared/schemas/src/lib/cyoa.ts
//
// TypeBox schemas for the CYOA (Choose Your Own Adventure) agent system (C-245).
// Defines the structured choice output produced by the CYOA post-processing
// agent and the per-chat choice history entries injected into GM context.

import Type from 'typebox';

// ── Skill check ──────────────────────────────────────────────────────────

/**
 * Optional D&D-style skill check hint attached to a CYOA choice.
 * Purely informational — no dice integration (that's C-ME-005 scope).
 */
export const CyoaSkillCheckSchema = Type.Object({
  /** Ability score name: STR, DEX, CON, INT, WIS, CHA, or a skill like Persuasion. */
  ability: Type.String({ minLength: 1, description: 'Ability or skill name' }),

  /** Difficulty class for the skill check. */
  dc: Type.Number({ minimum: 1, maximum: 40, description: 'Difficulty class' }),
});

// ── CYOA choice ──────────────────────────────────────────────────────────

/**
 * A single structured player choice proposed by the CYOA agent.
 */
export const CyoaChoiceSchema = Type.Object({
  /** Unique identifier within this choice set. */
  id: Type.String({ minLength: 1 }),

  /** The action text displayed on the button (1–8 words). */
  label: Type.String({ minLength: 1 }),

  /** Optional longer description shown on hover/focus. */
  description: Type.Optional(Type.String()),

  /** Optional D&D-style skill check hint. */
  skillCheck: Type.Optional(CyoaSkillCheckSchema),
});

/**
 * CYOA agent structured output — 2–4 choices.
 * Zero choices is a valid no-op (no meaningful choices for this scene).
 */
export const CyoaChoiceResultSchema = Type.Object({
  /** Proposed player choices. */
  choices: Type.Array(CyoaChoiceSchema, { maxItems: 4 }),
});

// ── Choice history ───────────────────────────────────────────────────────

/**
 * A recorded player choice — tracked per chat, injected into GM context
 * so the GM can reference past decisions.
 */
export const CyoaChoiceHistoryEntrySchema = Type.Object({
  /** The choice ID. */
  choiceId: Type.String({ minLength: 1 }),

  /** The label the user selected. */
  label: Type.String({ minLength: 1 }),

  /** Timestamp (epoch ms) when the choice was made. */
  selectedAt: Type.Number(),

  /** Optional: what influenced this choice (impersonation, dice roll, etc.). */
  context: Type.Optional(Type.String()),
});

// ── Derived types ────────────────────────────────────────────────────────

export type CyoaSkillCheck = Type.Static<typeof CyoaSkillCheckSchema>;
export type CyoaChoice = Type.Static<typeof CyoaChoiceSchema>;
export type CyoaChoiceResult = Type.Static<typeof CyoaChoiceResultSchema>;
export type CyoaChoiceHistoryEntry = Type.Static<typeof CyoaChoiceHistoryEntrySchema>;
