// packages/shared/schemas/src/lib/game/combat/combat_participation.ts
//
// Combat-08 participation and morale wire contract.
//
// This module introduces ONE morale authority: bounded integer morale (0–100)
// carried per combatant in `ParticipationState`. The pre-existing qualitative
// `CombatMorale` band (`'steady' | 'shaken' | 'wavering' | 'broken'`, defined
// in `combat_ai_decision.ts` and consumed by AI decisions) is a *derived view*
// of this number through `MORALE_BAND_THRESHOLDS` in
// `@aikami/utils` (`combat_morale.ts`). The band never mutates mechanical
// morale — it is a projection, and the mapping is documented in one place.
//
// Contract: C-532 AC-2

import Type, { type Static } from 'typebox';

/** Hard caps for the participation/morale vocabulary. */
export const COMBAT_MORALE_BOUNDS = {
  idChars: 96,
  /** Lowest and highest legal morale. */
  moraleMin: 0,
  moraleMax: 100,
  /** Maximum authored morale trigger rules. */
  triggers: 8,
  /** Maximum authored morale response rules. */
  responses: 4,
  /** Maximum recorded applied-trigger ids per combatant. */
  appliedTriggers: 32,
  /** Maximum authored exit zones. */
  exitZones: 8,
  /** Maximum cells in one authored exit zone. */
  exitZoneCells: 64,
} as const;

const BoundedIdSchema = Type.String({ minLength: 1, maxLength: COMBAT_MORALE_BOUNDS.idChars });

// ---------------------------------------------------------------------------
// Participation
// ---------------------------------------------------------------------------

/**
 * Whether a combatant still participates in the encounter.
 *
 * `retreating` is NOT a terminal state: a fleeing actor still on the
 * battlefield remains a participant until it exits or surrenders.
 */
export const ParticipationStatusSchema = Type.Union([
  Type.Literal('active'),
  Type.Literal('retreating'),
  Type.Literal('escaped'),
  Type.Literal('surrendered'),
  Type.Literal('defeated'),
]);

export type ParticipationStatus = Static<typeof ParticipationStatusSchema>;

/** Every participation status, in canonical order. */
export const PARTICIPATION_STATUSES: readonly ParticipationStatus[] = [
  'active',
  'retreating',
  'escaped',
  'surrendered',
  'defeated',
] as const;

/**
 * Reaction policy for the supported reaction. `ask` opens the decision
 * surface, `auto` applies the configured legal policy, `never` declines.
 */
export const ReactionPolicySchema = Type.Union([
  Type.Literal('ask'),
  Type.Literal('auto'),
  Type.Literal('never'),
]);

export type ReactionPolicy = Static<typeof ReactionPolicySchema>;

export const ParticipationStateSchema = Type.Object(
  {
    status: ParticipationStatusSchema,
    /** Bounded mechanical morale, 0–100. The single morale authority. */
    morale: Type.Integer({
      minimum: COMBAT_MORALE_BOUNDS.moraleMin,
      maximum: COMBAT_MORALE_BOUNDS.moraleMax,
    }),
    /**
     * Ids of morale trigger sources already applied to this combatant. Bound
     * the history so exactly-once semantics survive compaction: a trigger id
     * is applied at most once per combatant for the whole encounter.
     */
    appliedTriggerIds: Type.Array(BoundedIdSchema, {
      maxItems: COMBAT_MORALE_BOUNDS.appliedTriggers,
    }),
    /** Per-actor reaction policy. Defaults to `ask`. */
    reactionPolicy: ReactionPolicySchema,
  },
  { additionalProperties: false },
);

export type ParticipationState = Static<typeof ParticipationStateSchema>;

/** Default participation for an actor with no authored morale history. */
export const defaultParticipationState = (morale: number): ParticipationState => ({
  status: 'active',
  morale,
  appliedTriggerIds: [],
  reactionPolicy: 'ask',
});

// ---------------------------------------------------------------------------
// Morale rules
// ---------------------------------------------------------------------------

/** The morale trigger sources supported in this release. */
export const MoraleTriggerKindSchema = Type.Union([
  Type.Literal('leader_defeated'),
  Type.Literal('ally_removed'),
  Type.Literal('objective_failed'),
]);

export type MoraleTriggerKind = Static<typeof MoraleTriggerKindSchema>;

/** Every supported morale trigger kind, in canonical order. */
export const MORALE_TRIGGER_KINDS: readonly MoraleTriggerKind[] = [
  'leader_defeated',
  'ally_removed',
  'objective_failed',
] as const;

export const MoraleTriggerRuleSchema = Type.Object(
  {
    triggerKind: MoraleTriggerKindSchema,
    /** Morale delta magnitude applied when the source fires. */
    magnitude: Type.Integer({ minimum: 1, maximum: COMBAT_MORALE_BOUNDS.moraleMax }),
  },
  { additionalProperties: false },
);

export type MoraleTriggerRule = Static<typeof MoraleTriggerRuleSchema>;

/** The nonlethal responses a crossing actor may be authored to choose. */
export const MoraleResponseKindSchema = Type.Union([
  Type.Literal('retreat'),
  Type.Literal('surrender'),
]);

export type MoraleResponseKind = Static<typeof MoraleResponseKindSchema>;

export const MoraleResponseRuleSchema = Type.Object(
  {
    responseKind: MoraleResponseKindSchema,
    /**
     * Authored exit zone a `retreat` response must legally reach. Required for
     * `retreat` (movement must be legal), ignored for `surrender`.
     */
    exitZoneId: Type.Union([BoundedIdSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export type MoraleResponseRule = Static<typeof MoraleResponseRuleSchema>;

/**
 * Authored exit zone: the legal destination for a retreating actor.
 * A retreating actor that reaches any exit-zone cell is `escaped`.
 */
export const MoraleExitZoneSchema = Type.Object(
  {
    zoneId: BoundedIdSchema,
    cells: Type.Array(
      Type.Object({ x: Type.Integer(), y: Type.Integer() }, { additionalProperties: false }),
      { minItems: 1, maxItems: COMBAT_MORALE_BOUNDS.exitZoneCells },
    ),
  },
  { additionalProperties: false },
);

export type MoraleExitZone = Static<typeof MoraleExitZoneSchema>;

/**
 * The pinned morale rules input for one encounter. Travels inside
 * `CombatState` so a replay never reads the latest mutable content pack.
 */
export const MoraleRulesSchema = Type.Object(
  {
    /** Authored starting morale for every actor without an explicit override. */
    startingMorale: Type.Integer({
      minimum: COMBAT_MORALE_BOUNDS.moraleMin,
      maximum: COMBAT_MORALE_BOUNDS.moraleMax,
    }),
    /**
     * Morale at or below which an actor may choose an authored nonlethal
     * response. Crossing the threshold *permits* a response; it never declares
     * an outcome on its own.
     */
    breakThreshold: Type.Integer({
      minimum: COMBAT_MORALE_BOUNDS.moraleMin,
      maximum: COMBAT_MORALE_BOUNDS.moraleMax,
    }),
    triggers: Type.Array(MoraleTriggerRuleSchema, {
      maxItems: COMBAT_MORALE_BOUNDS.triggers,
    }),
    responses: Type.Array(MoraleResponseRuleSchema, {
      maxItems: COMBAT_MORALE_BOUNDS.responses,
    }),
    exitZones: Type.Array(MoraleExitZoneSchema, {
      maxItems: COMBAT_MORALE_BOUNDS.exitZones,
    }),
    /** Combatant ids whose defeat fires `leader_defeated`. */
    leaderIds: Type.Array(BoundedIdSchema, { maxItems: 8 }),
  },
  { additionalProperties: false },
);

export type MoraleRules = Static<typeof MoraleRulesSchema>;

/**
 * Empty morale rules — no triggers, no responses, morale pinned at a steady
 * 100. An encounter authored before Combat-08 keeps its previous behaviour.
 */
export const emptyMoraleRules = (): MoraleRules => ({
  startingMorale: 100,
  breakThreshold: 0,
  triggers: [],
  responses: [],
  exitZones: [],
  leaderIds: [],
});
