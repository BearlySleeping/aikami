// packages/shared/schemas/src/lib/game/content_pack_encounter.ts
//
// Encounter authoring schemas for content packs (C-316, extended by C-531).
//
// Extracted from `content_pack.ts` so the manifest module stays under the
// source-file-size hard limit. `content_pack.ts` re-exports every symbol here,
// so the public surface is unchanged.
//
// Contract: C-316, C-531 AC-6, C-532 AC-1, AC-2, AC-3

import Type, { type Static } from 'typebox';
import {
  MoraleRulesSchema,
  ObjectiveRulesSchema,
  ReactionRegistrySchema,
} from './combat/combat_state.ts';
import { ContentPackEncounterEnvironmentSchema } from './content_pack_environment.ts';

// ---------------------------------------------------------------------------
// ContentPackSkillStat — skill stat for skill checks (C-316)
// ---------------------------------------------------------------------------

export const ContentPackSkillStatSchema = Type.Union([
  Type.Literal('strength'),
  Type.Literal('dexterity'),
  Type.Literal('intelligence'),
  Type.Literal('charisma'),
  Type.Literal('wisdom'),
]);

export type ContentPackSkillStat = Static<typeof ContentPackSkillStatSchema>;

// ---------------------------------------------------------------------------
// ContentPackSkillCheck — a skill check definition (C-316)
// ---------------------------------------------------------------------------

export const ContentPackSkillCheckSchema = Type.Object({
  /** Skill label e.g. "persuasion" */
  skill: Type.String({ minLength: 1, description: 'Skill label e.g. "persuasion"' }),
  /** Difficulty class — d20 must meet or exceed */
  dc: Type.Number({ minimum: 1, description: 'Difficulty class' }),
  /** Stat modifier applied to the roll */
  statModifier: ContentPackSkillStatSchema,
  /** Dialogue on skill check success */
  successDialogueKey: Type.String({ description: 'Dialogue on skill check success' }),
  /** Dialogue on skill check failure */
  failureDialogueKey: Type.String({ description: 'Dialogue on skill check failure' }),
});

export type ContentPackSkillCheck = Static<typeof ContentPackSkillCheckSchema>;

// ---------------------------------------------------------------------------
// ContentPackLootEntry — a loot drop entry (C-316)
// ---------------------------------------------------------------------------

export const ContentPackLootEntrySchema = Type.Object({
  /** Item ID dropped */
  itemId: Type.String({ minLength: 1, description: 'Item ID dropped' }),
  /** Quantity dropped */
  quantity: Type.Number({ minimum: 1, description: 'Quantity dropped' }),
  /** Drop probability 0.0–1.0 */
  dropChance: Type.Number({
    minimum: 0,
    maximum: 1,
    description: 'Drop probability 0.0–1.0',
  }),
});

export type ContentPackLootEntry = Static<typeof ContentPackLootEntrySchema>;

export const ContentPackEncounterEntrySchema = Type.Object({
  /** Unique encounter identifier */
  id: Type.String({ minLength: 1, description: 'Unique encounter identifier' }),
  /** Map ID where this encounter triggers */
  mapId: Type.String({ minLength: 1, description: 'Map ID where this encounter triggers' }),
  /** Encounter display name */
  name: Type.String({ minLength: 1, description: 'Encounter display name' }),
  /** NPC IDs that participate as enemies */
  enemyNpcIds: Type.Array(Type.String(), {
    minItems: 1,
    description: 'NPC IDs that participate as enemies',
  }),
  /** Whether non-combat resolution is available */
  allowNonCombatResolution: Type.Boolean({
    description: 'Whether non-combat resolution is available',
  }),
  /** Skill check for non-combat resolution */
  nonCombatSkillCheck: Type.Optional(ContentPackSkillCheckSchema),
  /** Dialogue on encounter start */
  startDialogueKey: Type.String({ description: 'Dialogue on encounter start' }),
  /** Dialogue on combat victory */
  victoryDialogueKey: Type.String({ description: 'Dialogue on combat victory' }),
  /** Dialogue on non-combat success */
  nonCombatSuccessDialogueKey: Type.Optional(
    Type.String({ description: 'Dialogue on non-combat success' }),
  ),
  /** Loot dropped on victory */
  loot: Type.Array(ContentPackLootEntrySchema, { description: 'Loot dropped on victory' }),
  /** C-531: authored battlefield objects and impact zones. */
  environment: Type.Optional(ContentPackEncounterEnvironmentSchema),
  /**
   * C-532: authored encounter objectives and their protected-actor constraint.
   *
   * The SAME closed vocabulary the kernel evaluates — content never carries a
   * bespoke rule shape. Absent means the empty rules: the encounter's only
   * termination is the legacy defeat-group outcome.
   */
  objectiveRules: Type.Optional(ObjectiveRulesSchema),
  /**
   * C-532: authored morale rules — starting value, break threshold, trigger
   * magnitudes, available responses and the exit zones a retreat must reach.
   * Absent means no triggers and morale pinned at a steady 100.
   */
  moraleRules: Type.Optional(MoraleRulesSchema),
  /**
   * C-532: authored registered reactions. Absent means no reactions are
   * offered, and an opportunity attack can never open a window.
   */
  reactionRegistry: Type.Optional(ReactionRegistrySchema),
});

export type ContentPackEncounterEntry = Static<typeof ContentPackEncounterEntrySchema>;
