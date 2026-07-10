// apps/frontend/client/src/lib/services/agent/agent_schemas.ts
//
// TypeBox schemas for agent pipeline output validation. These define
// the expected JSON shapes returned by each background LLM agent.
//
// Contract: C-236 Agent Pipeline System

import type { CyoaChoice } from '@aikami/types';
import { type Static, Type } from 'typebox';

// ── Scene Direction (Narrative Director adapter) ────────────────────────

/**
 * Schema for narrative director scene direction output.
 * Adapts C-235 narrative director format for the agent pipeline.
 */
export const sceneDirectionSchema = Type.Object({
  description: Type.String({ minLength: 1, description: 'A 2-4 sentence scene description' }),
  playerGuidance: Type.Optional(
    Type.String({ description: 'Optional hint about what the player might do next' }),
  ),
});

export type SceneDirectionOutput = Static<typeof sceneDirectionSchema>;

// ── World State Extraction ──────────────────────────────────────────────

/**
 * Schema for world state agent output — extracts structured world
 * state from the evolving narrative.
 */
export const worldStateExtractionSchema = Type.Object({
  locationName: Type.String({ minLength: 1, description: 'Current location name' }),
  locationDescription: Type.String({ minLength: 1, description: 'Current location description' }),
  timeOfDay: Type.String({ description: 'Narrative time of day (e.g. "morning", "dusk")' }),
  weather: Type.String({ description: 'Weather description' }),
  notableChanges: Type.Array(Type.String(), {
    description: 'Notable world changes since last extraction',
  }),
});

export type WorldStateExtractionOutput = Static<typeof worldStateExtractionSchema>;

// ── Quest Update ─────────────────────────────────────────────────────────

/**
 * Schema for quest tracker agent output — detects quest-relevant
 * narrative events and proposes state changes.
 */
export const questUpdateSchema = Type.Object({
  questUpdates: Type.Array(
    Type.Object({
      questId: Type.String({ description: 'Quest identifier' }),
      questName: Type.String({ description: 'Human-readable quest name' }),
      status: Type.Union([
        Type.Literal('active'),
        Type.Literal('completed'),
        Type.Literal('failed'),
        Type.Literal('updated'),
      ]),
      objective: Type.Optional(Type.String({ description: 'New or updated objective' })),
      reason: Type.String({ description: 'Why this status change is warranted' }),
    }),
    { description: 'Quest status changes detected in the narrative' },
  ),
  newQuests: Type.Array(
    Type.Object({
      name: Type.String({ description: 'Proposed quest name' }),
      description: Type.String({ description: 'Quest description' }),
      objective: Type.String({ description: 'Primary objective' }),
    }),
    { description: 'New quests proposed based on narrative' },
  ),
});

export type QuestUpdateOutput = Static<typeof questUpdateSchema>;

// ── Expression ───────────────────────────────────────────────────────────

/**
 * Schema for expression agent output — evaluates all characters'
 * emotional states from dialogue and recommends expression changes.
 * Multi-character format: returns an array of name/expression pairs.
 */
export const expressionSchema = Type.Object({
  characters: Type.Array(
    Type.Object({
      name: Type.String({ description: 'Character name' }),
      expression: Type.String({ description: 'Detected expression (e.g. happy, angry, neutral)' }),
    }),
    { description: 'List of characters with their detected expressions' },
  ),
});

export type ExpressionOutput = Static<typeof expressionSchema>;

// ── Prose Guardian ───────────────────────────────────────────────────────

/**
 * Schema for prose guardian agent output — evaluates dialogue quality
 * and suggests improvements.
 */
export const proseGuardianSchema = Type.Object({
  qualityScore: Type.Number({
    minimum: 0,
    maximum: 100,
    description: 'Overall prose quality score (0-100)',
  }),
  issues: Type.Array(
    Type.Object({
      type: Type.Union([
        Type.Literal('repetition'),
        Type.Literal('cliche'),
        Type.Literal('pacing'),
        Type.Literal('voice'),
        Type.Literal('formatting'),
      ]),
      description: Type.String(),
      suggestion: Type.String(),
    }),
    { description: 'Detected prose issues with suggestions' },
  ),
  styleNotes: Type.Array(Type.String(), { description: 'Notable style characteristics' }),
  rewriteSuggestion: Type.Optional(
    Type.String({ description: 'Proposed rewrite if quality score is below threshold' }),
  ),
});

export type ProseGuardianOutput = Static<typeof proseGuardianSchema>;

// ── CYOA Choices (C-245) ─────────────────────────────────────────────────

/**
 * CYOA agent result — tagged output carrying 2–4 structured player
 * choices. Schema source of truth lives in `@aikami/schemas` (`CyoaChoiceResultSchema`).
 */
export type CyoaAgentOutput = {
  /** Result type discriminator for the agent result union. */
  type: 'cyoa_choices';
  /** Proposed player choices (0–4; 0 = no-op, 1 = prompt-advance). */
  choices: CyoaChoice[];
};

// ── Music Cue (C-249) ───────────────────────────────────────────────────

/**
 * Music DJ agent output — the MusicCue schema is the source of truth
 * in `@aikami/schemas` (`MusicCueSchema`). Re-exported here for the
 * agent pipeline's output union.
 */
export { MusicCueSchema, type MusicCueValidated } from '@aikami/schemas';

export type MusicCueOutput = {
  /** Result type discriminator for the agent result union. */
  type: 'music_cue';
  action: {
    type: string;
    trackId?: string;
    fadeInMs?: number;
    durationMs?: number;
    fadeOutMs?: number;
    target?: string;
    level?: number;
    reason?: string;
  };
  reasoning: string;
  sceneTags: string[];
};

// ── Union type for all agent outputs ────────────────────────────────────

export type AgentOutput =
  | SceneDirectionOutput
  | WorldStateExtractionOutput
  | QuestUpdateOutput
  | ExpressionOutput
  | ProseGuardianOutput
  | CyoaAgentOutput
  | MusicCueOutput;
