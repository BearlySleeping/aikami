// packages/shared/schemas/src/lib/game/rules_command.ts
//
// Typed rules command protocol — the single validated command union through
// which mechanical resolution (skill checks, attack rolls, damage, healing,
// XP, loot, relationship deltas) flows.
//
// Follows the discriminated-union pattern established by npc_dialogue_command.ts:
// every variant has a `kind` discriminant, `additionalProperties: false` on each
// Object, and unknown kinds are rejected at the validation boundary.
//
// Contract: C-336 Extract a Deterministic Rules Kernel and Typed Game Command

import Type, { type Static } from 'typebox';

// ---------------------------------------------------------------------------
// Damage dice pattern (matches content_pack.ts)
// ---------------------------------------------------------------------------

const DAMAGE_DICE_PATTERN = '^\\d+d\\d+(\\+\\d+)?$';

// ---------------------------------------------------------------------------
// Loot table entry — embedded in rollLoot command
// ---------------------------------------------------------------------------

export const LootTableEntrySchema = Type.Object(
  {
    itemId: Type.String({ minLength: 1, description: 'Content-pack item ID' }),
    dropChance: Type.Number({ minimum: 0, maximum: 1, description: 'Drop probability 0–1' }),
    quantity: Type.Integer({ minimum: 1, description: 'Quantity if dropped' }),
  },
  { additionalProperties: false },
);

export type LootTableEntry = Static<typeof LootTableEntrySchema>;

// ---------------------------------------------------------------------------
// Generated loot item — output of a successful loot roll
// ---------------------------------------------------------------------------

export const GeneratedLootItemSchema = Type.Object(
  {
    itemId: Type.String({ minLength: 1 }),
    quantity: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export type GeneratedLootItem = Static<typeof GeneratedLootItemSchema>;

// ---------------------------------------------------------------------------
// Command variants — discriminated on `kind`
// ---------------------------------------------------------------------------

/** Rolls a d20 skill check against a difficulty class. */
export const RollSkillCheckCommandSchema = Type.Object(
  {
    kind: Type.Literal('rollSkillCheck'),
    skill: Type.String({ minLength: 1, description: 'Skill name (e.g. "Persuasion")' }),
    abilityModifier: Type.Integer({
      description: 'Ability score modifier (e.g. +3 for 16 CHA)',
    }),
    proficiencyBonus: Type.Integer({ minimum: 2, description: 'Proficiency bonus' }),
    difficultyClass: Type.Integer({
      minimum: 5,
      maximum: 30,
      description: 'Difficulty class, schema-enforced 5–30',
    }),
    advantage: Type.Boolean({ description: 'Whether this roll has advantage' }),
  },
  { additionalProperties: false },
);

/** Rolls a d20 attack against a target armor class. */
export const RollAttackCommandSchema = Type.Object(
  {
    kind: Type.Literal('rollAttack'),
    attackBonus: Type.Integer({ description: 'Total attack bonus' }),
    targetArmorClass: Type.Integer({ minimum: 0, description: 'Target AC' }),
    advantage: Type.Boolean({ description: 'Whether the attacker has advantage' }),
    disadvantage: Type.Boolean({ description: 'Whether the attacker has disadvantage' }),
  },
  { additionalProperties: false },
);

/** Rolls damage dice (e.g. "1d6+2"). */
export const RollDamageCommandSchema = Type.Object(
  {
    kind: Type.Literal('rollDamage'),
    damageDice: Type.String({
      pattern: DAMAGE_DICE_PATTERN,
      description: 'Damage dice notation e.g. "1d6+2"',
    }),
    isCritical: Type.Boolean({ description: 'Whether this is a critical hit (double dice)' }),
  },
  { additionalProperties: false },
);

/** Applies damage to a target, clamping HP at 0. */
export const ApplyDamageCommandSchema = Type.Object(
  {
    kind: Type.Literal('applyDamage'),
    targetCurrentHp: Type.Integer({ minimum: 0, description: 'Current HP before damage' }),
    amount: Type.Integer({ minimum: 0, description: 'Damage amount' }),
    targetMaxHp: Type.Integer({ minimum: 1, description: 'Max HP of target' }),
  },
  { additionalProperties: false },
);

/** Applies healing to a target, clamping HP at max. */
export const ApplyHealingCommandSchema = Type.Object(
  {
    kind: Type.Literal('applyHealing'),
    targetCurrentHp: Type.Integer({ minimum: 0, description: 'Current HP before healing' }),
    amount: Type.Integer({ minimum: 0, description: 'Healing amount' }),
    targetMaxHp: Type.Integer({ minimum: 1, description: 'Max HP of target' }),
  },
  { additionalProperties: false },
);

/** Grants XP to a character, with level-up detection. */
export const GrantXpCommandSchema = Type.Object(
  {
    kind: Type.Literal('grantXp'),
    currentXp: Type.Integer({ minimum: 0, description: 'XP before grant' }),
    amount: Type.Integer({ minimum: 0, description: 'XP to grant' }),
    xpToNextLevel: Type.Integer({ minimum: 1, description: 'XP threshold for next level' }),
    currentLevel: Type.Integer({ minimum: 1, description: 'Current character level' }),
  },
  { additionalProperties: false },
);

/** Rolls on a loot table to determine dropped items. */
export const RollLootCommandSchema = Type.Object(
  {
    kind: Type.Literal('rollLoot'),
    lootTable: Type.Array(LootTableEntrySchema, {
      minItems: 0,
      description: 'Loot table entries to roll against',
    }),
  },
  { additionalProperties: false },
);

/** Applies trust/affinity deltas from quest outcomes or dialogue choices. */
export const ApplyRelationshipDeltaCommandSchema = Type.Object(
  {
    kind: Type.Literal('applyRelationshipDelta'),
    currentTrust: Type.Integer({
      minimum: -100,
      maximum: 100,
      description: 'Current trust value',
    }),
    currentAffinity: Type.Integer({
      minimum: -100,
      maximum: 100,
      description: 'Current affinity value',
    }),
    trustDelta: Type.Integer({ description: 'Trust change (positive or negative)' }),
    affinityDelta: Type.Integer({ description: 'Affinity change (positive or negative)' }),
    eventDescription: Type.String({ description: 'Narrative description of the event' }),
  },
  { additionalProperties: false },
);

/**
 * Discriminated union of every mechanical rules resolution command.
 * Unknown `kind` values and extra fields fail validation.
 */
export const RulesCommandSchema = Type.Union([
  RollSkillCheckCommandSchema,
  RollAttackCommandSchema,
  RollDamageCommandSchema,
  ApplyDamageCommandSchema,
  ApplyHealingCommandSchema,
  GrantXpCommandSchema,
  RollLootCommandSchema,
  ApplyRelationshipDeltaCommandSchema,
]);

export type RulesCommand = Static<typeof RulesCommandSchema>;

/** The `kind` discriminator values of {@link RulesCommandSchema}. */
export type RulesCommandKind = RulesCommand['kind'];

// ---------------------------------------------------------------------------
// Event variants — mechanical outcomes, discriminated on `kind`
// ---------------------------------------------------------------------------

/** Outcome of a skill check roll. */
export const SkillCheckResolvedEventSchema = Type.Object(
  {
    kind: Type.Literal('skillCheckResolved'),
    naturalRoll: Type.Integer({ minimum: 1, maximum: 20 }),
    totalRoll: Type.Integer(),
    success: Type.Boolean(),
    isCriticalSuccess: Type.Boolean(),
    isCriticalFailure: Type.Boolean(),
  },
  { additionalProperties: false },
);

/** Outcome of an attack roll. */
export const AttackResolvedEventSchema = Type.Object(
  {
    kind: Type.Literal('attackResolved'),
    naturalRoll: Type.Integer({ minimum: 1, maximum: 20 }),
    totalRoll: Type.Integer(),
    hit: Type.Boolean(),
    isCriticalHit: Type.Boolean(),
  },
  { additionalProperties: false },
);

/** Outcome of a damage roll. */
export const DamageResolvedEventSchema = Type.Object(
  {
    kind: Type.Literal('damageResolved'),
    naturalDamage: Type.Integer({ minimum: 0 }),
    totalDamage: Type.Integer({ minimum: 0 }),
    targetHpAfter: Type.Integer({ minimum: 0 }),
    isDefeated: Type.Boolean(),
  },
  { additionalProperties: false },
);

/** Outcome of a healing action. */
export const HealingResolvedEventSchema = Type.Object(
  {
    kind: Type.Literal('healingResolved'),
    amountHealed: Type.Integer({ minimum: 0 }),
    targetHpAfter: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

/** Outcome of an XP grant. */
export const XpGrantedEventSchema = Type.Object(
  {
    kind: Type.Literal('xpGranted'),
    xpAfter: Type.Integer({ minimum: 0 }),
    leveledUp: Type.Boolean(),
    newLevel: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);

/** Outcome of a loot roll. */
export const LootGeneratedEventSchema = Type.Object(
  {
    kind: Type.Literal('lootGenerated'),
    items: Type.Array(GeneratedLootItemSchema),
  },
  { additionalProperties: false },
);

/** Outcome of a relationship delta application. */
export const RelationshipUpdatedEventSchema = Type.Object(
  {
    kind: Type.Literal('relationshipUpdated'),
    trustAfter: Type.Integer({ minimum: -100, maximum: 100 }),
    affinityAfter: Type.Integer({ minimum: -100, maximum: 100 }),
  },
  { additionalProperties: false },
);

/**
 * Discriminated union of every mechanical rules event.
 */
export const RulesEventSchema = Type.Union([
  SkillCheckResolvedEventSchema,
  AttackResolvedEventSchema,
  DamageResolvedEventSchema,
  HealingResolvedEventSchema,
  XpGrantedEventSchema,
  LootGeneratedEventSchema,
  RelationshipUpdatedEventSchema,
]);

export type RulesEvent = Static<typeof RulesEventSchema>;

/** The `kind` discriminator values of {@link RulesEventSchema}. */
export type RulesEventKind = RulesEvent['kind'];

// ---------------------------------------------------------------------------
// Mechanical Snapshot — the replay artifact
// ---------------------------------------------------------------------------

/** One entry in the command log. */
export const CommandLogEntrySchema = Type.Object(
  {
    index: Type.Integer({ minimum: 0, description: 'Logical command index (not wall-clock time)' }),
    commandKind: Type.String({ description: 'The `kind` of the RulesCommand executed' }),
    /** Optional serialized RNG state for mid-log save/resume. */
    rngState: Type.Optional(
      Type.Object(
        {
          seed: Type.Integer(),
          state: Type.Integer(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export type CommandLogEntry = Static<typeof CommandLogEntrySchema>;

/**
 * A mechanical snapshot capturing the replay artifact:
 * seed + command log + final state.
 *
 * Used by the replay CI gate (C-335 AC) to assert that a recorded
 * combat/skill-check sequence produces the same outcome every run.
 */
export const MechanicalSnapshotSchema = Type.Object(
  {
    version: Type.Integer({ minimum: 1, description: 'Schema version for migration' }),
    seed: Type.Integer({ description: 'Campaign seed used for RNG' }),
    commandLog: Type.Array(CommandLogEntrySchema, {
      description: 'Ordered log of executed commands',
    }),
    finalState: Type.Record(Type.String(), Type.Unknown(), {
      description: 'Mechanical state after all commands (HP, XP, quest progress, etc.)',
    }),
  },
  { additionalProperties: false },
);

export type MechanicalSnapshot = Static<typeof MechanicalSnapshotSchema>;
