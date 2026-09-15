// packages/shared/schemas/src/lib/game/combat/combat_state.ts
//
// Versioned combat state — the single mechanical authority's wire contract.
//
// Deliberate narrowing of `docs/architecture/combat_2.md` §8.1, recorded so
// implementers do not "restore" it: `phase` omits `'reaction'` (reactions are
// Combat-08) and the flat `seed`/`rngState` pair is replaced by the
// named-substream `rng` object (§25.3). Every other §8.1 field is present.
//
// Contract: C-509 AC-1

import Type, { type Static } from 'typebox';
import { DamageTypeKeySchema } from '../damage_type';
import {
  CombatEnvironmentBundleSchema,
  EnvironmentalStateSchema,
  emptyEnvironmentalState,
  emptyEnvironmentBundle,
} from './combat_environment';
import { GridPointSchema } from './combat_grid';
import { emptyObjectiveRules, ObjectiveRulesSchema } from './combat_objective';
import {
  emptyMoraleRules,
  MoraleRulesSchema,
  type ParticipationState,
  ParticipationStateSchema,
} from './combat_participation';
import {
  emptyReactionRegistry,
  emptyReactionState,
  ReactionRegistrySchema,
  ReactionStateSchema,
} from './combat_reaction';
import {
  type EncounterSettlement,
  EncounterSettlementSchema,
  settlementToVictoryProjection,
} from './combat_settlement';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

// `GridPointSchema` lives in the leaf `combat_grid.ts` so the environmental
// schemas can depend on it without closing a module cycle. Re-exported here
// because every existing consumer imports it from `combat_state`.
// Contract: C-531 AC-1
export {
  compareGridPoints,
  type GridPoint,
  GridPointSchema,
  gridPointKey,
} from './combat_grid';

/** Distance band an ability operates within. */
export const RangeBandSchema = Type.Union([
  Type.Literal('melee'),
  Type.Literal('reach'),
  Type.Literal('ranged'),
]);

export type RangeBand = Static<typeof RangeBandSchema>;

/**
 * Combat phase.
 *
 * `'reaction'` represents an explicit reaction suspension: the active
 * combatant's command is paused mid-flight and a reaction window owns the
 * encounter until it resolves. Contract: C-532 AC-3.
 */
export const CombatPhaseSchema = Type.Union([
  Type.Literal('starting'),
  Type.Literal('active'),
  Type.Literal('reaction'),
  Type.Literal('ended'),
]);

export type CombatPhase = Static<typeof CombatPhaseSchema>;

/** Per-turn action economy. */
export const TurnBudgetSchema = Type.Object(
  {
    movementRemaining: Type.Integer({ minimum: 0, description: 'Movement cells left this turn' }),
    actionAvailable: Type.Boolean(),
    quickActionAvailable: Type.Boolean(),
    /**
     * Whether this combatant still has its reaction. Reset at the start of the
     * combatant's own normal turn; consumed by an accepted reaction attack
     * whether it hits or misses. Contract: C-532 AC-3.
     */
    reactionAvailable: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type TurnBudget = Static<typeof TurnBudgetSchema>;

// ---------------------------------------------------------------------------
// RNG state — named deterministic substreams (architecture §25.3)
// ---------------------------------------------------------------------------

/** Serialized single-stream RNG state (seed + internal mulberry32 state). */
export const SerializedRngSchema = Type.Object(
  {
    seed: Type.Integer(),
    state: Type.Integer(),
  },
  { additionalProperties: false },
);

export type SerializedRng = Static<typeof SerializedRngSchema>;

/** Encounter RNG identity: one seed, three independent named substreams. */
export const CombatRngStateSchema = Type.Object(
  {
    seed: Type.Integer({ description: 'Encounter seed all substreams derive from' }),
    streams: Type.Object(
      {
        initiative: SerializedRngSchema,
        actions: SerializedRngSchema,
        loot: SerializedRngSchema,
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export type CombatRngState = Static<typeof CombatRngStateSchema>;

/** The named substream keys available on {@link CombatRngState}. */
export const CombatRngStreamKeySchema = Type.Union([
  Type.Literal('initiative'),
  Type.Literal('actions'),
  Type.Literal('loot'),
]);

export type CombatRngStreamKey = Static<typeof CombatRngStreamKeySchema>;

// ---------------------------------------------------------------------------
// Ability catalog
// ---------------------------------------------------------------------------

const DAMAGE_DICE_PATTERN = '^\\d+d\\d+(\\+\\d+)?$';

export const CombatAbilityKindSchema = Type.Union([
  Type.Literal('melee_attack'),
  Type.Literal('ranged_attack'),
  Type.Literal('defend'),
  Type.Literal('utility'),
]);

export type CombatAbilityKind = Static<typeof CombatAbilityKindSchema>;

export const CombatActionCostSchema = Type.Union([
  Type.Literal('action'),
  Type.Literal('quick'),
  Type.Literal('reaction'),
  Type.Literal('free'),
]);

export type CombatActionCost = Static<typeof CombatActionCostSchema>;

/**
 * Self-contained rules input — the catalog travels inside `CombatState` so a
 * replay never needs an external rules lookup (Open Question Q2).
 */
export const CombatAbilityDefinitionSchema = Type.Object(
  {
    abilityId: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    kind: CombatAbilityKindSchema,
    actionCost: CombatActionCostSchema,
    attackBonus: Type.Integer({ description: 'Flat bonus added to the attack roll' }),
    damageDice: Type.Union([
      Type.String({ pattern: DAMAGE_DICE_PATTERN, description: 'e.g. "1d8"' }),
      Type.Null(),
    ]),
    damageType: Type.Union([DamageTypeKeySchema, Type.Null()]),
    rangeCells: Type.Integer({ minimum: 0, description: 'Maximum target distance in cells' }),
    requiresLineOfSight: Type.Boolean({
      description: 'Declared by the catalog; line of sight is enforced from Combat-03',
    }),
  },
  { additionalProperties: false },
);

export type CombatAbilityDefinition = Static<typeof CombatAbilityDefinitionSchema>;

// ---------------------------------------------------------------------------
// Combatant
// ---------------------------------------------------------------------------

export const CombatTeamSchema = Type.Union([
  Type.Literal('player'),
  Type.Literal('ally'),
  Type.Literal('enemy'),
  Type.Literal('neutral'),
]);

export type CombatTeam = Static<typeof CombatTeamSchema>;

export const CombatantStateSchema = Type.Object(
  {
    /** Stable authored/encounter identity — never a bitECS entity id. */
    combatantId: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1 }),
    team: CombatTeamSchema,
    position: GridPointSchema,
    hp: Type.Integer({ minimum: 0 }),
    maxHp: Type.Integer({ minimum: 1 }),
    armorClass: Type.Integer({ minimum: 0 }),
    attackBonus: Type.Integer(),
    initiative: Type.Integer(),
    abilityIds: Type.Array(Type.String({ minLength: 1 })),
    budget: TurnBudgetSchema,
    /** HP ≤ 0. May still be revived in a later slice. */
    downed: Type.Boolean(),
    /** Terminal in Combat-01 — never selected as the active combatant again. */
    defeated: Type.Boolean(),
    /**
     * Projected character-sheet check modifiers, keyed by registered source
     * (an ability key such as `strength`, or a skill id such as `athletics`).
     *
     * An environmental check whose `modifierSource` is absent here is
     * REJECTED — the kernel never substitutes an unrelated bonus such as
     * `attackBonus`. Absent means "this snapshot projects no check modifiers".
     * Contract: C-531 AC-2
     */
    checkModifiers: Type.Optional(
      Type.Record(Type.String({ minLength: 1, maxLength: 64 }), Type.Integer(), {
        maxProperties: 32,
      }),
    ),
  },
  { additionalProperties: false },
);

export type CombatantState = Static<typeof CombatantStateSchema>;

export const InitiativeStateSchema = Type.Object(
  {
    /** combatantIds sorted at `createCombatState` (initiative desc, id asc). */
    order: Type.Array(Type.String({ minLength: 1 })),
    activeIndex: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type InitiativeState = Static<typeof InitiativeStateSchema>;

const BattlefieldStateObjectSchema = Type.Object(
  {
    width: Type.Integer({ minimum: 1 }),
    height: Type.Integer({ minimum: 1 }),
    /** Cell-level blocked/walkable projection. */
    blockedCells: Type.Array(GridPointSchema),
    /**
     * Optional tactical cost grid (flat, row-major `y * width + x`).
     * `0` means impassable; any other value is the traversal cost in cells.
     * Absent means "uniform cost 1 for every non-`blockedCells` cell".
     */
    movementCost: Type.Optional(Type.Array(Type.Integer({ minimum: 0 }))),
    /**
     * Optional sight-blocking grid (flat, row-major `y * width + x`).
     * Absent means "no occlusion data" — every line of sight is clear.
     */
    blocksSight: Type.Optional(Type.Array(Type.Boolean())),
  },
  { additionalProperties: false },
);

/** Ensures optional flat battlefield grids cover every declared cell exactly once. */
export const hasValidBattlefieldGridLengths = (
  battlefield: Static<typeof BattlefieldStateObjectSchema>,
): boolean => {
  const cellCount = battlefield.width * battlefield.height;
  return (
    (battlefield.movementCost === undefined || battlefield.movementCost.length === cellCount) &&
    (battlefield.blocksSight === undefined || battlefield.blocksSight.length === cellCount)
  );
};

export const BattlefieldStateSchema = Type.Refine(
  BattlefieldStateObjectSchema,
  hasValidBattlefieldGridLengths,
);

export type BattlefieldState = Static<typeof BattlefieldStateSchema>;

export const CombatObjectiveStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('complete'),
  Type.Literal('failed'),
]);

export type CombatObjectiveStatus = Static<typeof CombatObjectiveStatusSchema>;

export const CombatObjectiveStateSchema = Type.Object(
  {
    objectiveId: Type.String({ minLength: 1 }),
    /**
     * Retained as a free string so a v3 snapshot migrates without
     * reinterpretation. Authored definitions carry the closed
     * `ObjectiveKind` union; this field is the observable projection.
     */
    kind: Type.String({ minLength: 1 }),
    status: CombatObjectiveStatusSchema,
    /**
     * Satisfied requirement units for the objective's primitive. Added in
     * schema v4; a migrated v3 snapshot starts at 0. Contract: C-532 AC-1.
     */
    progress: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type CombatObjectiveState = Static<typeof CombatObjectiveStateSchema>;

/**
 * Boolean victory projection retained for existing consumers.
 *
 * `reason` carries the authoritative settlement's `reasonCode` verbatim when a
 * settlement exists, so a nonlethal resolution is never misreported as an
 * elimination. The richer `EncounterSettlement` remains authoritative.
 * Contract: C-532 AC-5.
 */
export const CombatOutcomeSchema = Type.Object(
  {
    victory: Type.Boolean(),
    reason: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type CombatOutcome = Static<typeof CombatOutcomeSchema>;

/**
 * Projects an authoritative settlement onto the legacy boolean outcome.
 * The mapping lives in `combat_settlement.ts` and is defined once.
 */
export const outcomeFromSettlement = (settlement: EncounterSettlement): CombatOutcome => ({
  victory: settlementToVictoryProjection(settlement),
  reason: settlement.reasonCode,
});

// ---------------------------------------------------------------------------
// CombatState
// ---------------------------------------------------------------------------

/** Current wire version of {@link CombatStateSchema}. */
export const COMBAT_SCHEMA_VERSION = 4;

/**
 * The wire version C-531 replaced.
 *
 * A v2 snapshot has no `environment` / `environmentBundle`; migrating it may
 * only produce EMPTY environmental state — destroyed/intact object state is
 * never inferred from scenery.
 */
export const COMBAT_SCHEMA_VERSION_V2 = 2;

/**
 * The wire version C-532 replaced.
 *
 * A v3 snapshot has no `objectiveRules` / `participation` / `moraleRules` /
 * `reaction` / `settlement`, and its objective records carry no `progress`.
 * Migrating it may only produce EMPTY authored rules, ACTIVE participation
 * with no invented morale history, and NO settlement — a v3 encounter keeps
 * its existing defeat-group semantics and never gains a ritual deadline.
 */
export const COMBAT_SCHEMA_VERSION_V3 = 3;

// ---------------------------------------------------------------------------
// Re-exported Combat-08 leaf contracts
// ---------------------------------------------------------------------------

// Every Combat-08 consumer imports objective/participation/reaction/settlement
// schemas from `combat_state` for the same reason `GridPoint` is re-exported
// here: one import site, no duplicated vocabulary. Contract: C-532.
export {
  COMBAT_OBJECTIVE_BOUNDS,
  compareCombatIds,
  compareObjectiveProgress,
  emptyObjectiveRules,
  OBJECTIVE_KINDS,
  type ObjectiveDefinition,
  ObjectiveDefinitionSchema,
  type ObjectiveKind,
  ObjectiveKindSchema,
  type ObjectiveProgress,
  ObjectiveProgressSchema,
  type ObjectiveRules,
  ObjectiveRulesSchema,
  type RegisteredObjectiveRule,
  RegisteredObjectiveRuleSchema,
} from './combat_objective';
export {
  COMBAT_MORALE_BOUNDS,
  defaultParticipationState,
  emptyMoraleRules,
  MORALE_TRIGGER_KINDS,
  type MoraleExitZone,
  MoraleExitZoneSchema,
  type MoraleResponseKind,
  MoraleResponseKindSchema,
  type MoraleResponseRule,
  MoraleResponseRuleSchema,
  type MoraleRules,
  MoraleRulesSchema,
  type MoraleTriggerKind,
  MoraleTriggerKindSchema,
  type MoraleTriggerRule,
  MoraleTriggerRuleSchema,
  PARTICIPATION_STATUSES,
  type ParticipationState,
  ParticipationStateSchema,
  type ParticipationStatus,
  ParticipationStatusSchema,
  type ReactionPolicy,
  ReactionPolicySchema,
} from './combat_participation';

export {
  COMBAT_REACTION_BOUNDS,
  DEFAULT_REACTION_POLICY,
  emptyReactionRegistry,
  emptyReactionState,
  type ReactionChoice,
  ReactionChoiceSchema,
  type ReactionChoiceSource,
  ReactionChoiceSourceSchema,
  type ReactionRegistry,
  ReactionRegistrySchema,
  type ReactionSelectionRequest,
  ReactionSelectionRequestSchema,
  type ReactionState,
  ReactionStateSchema,
  type ReactionTriggerKind,
  ReactionTriggerKindSchema,
  type ReactionWindow,
  ReactionWindowSchema,
  type ReactionWindowStatus,
  ReactionWindowStatusSchema,
  type RegisteredReactionDefinition,
  RegisteredReactionDefinitionSchema,
  type SerializableCommandContinuation,
  SerializableCommandContinuationSchema,
} from './combat_reaction';

export {
  COMBAT_SETTLEMENT_BOUNDS,
  type EncounterSettlement,
  EncounterSettlementSchema,
  SETTLEMENT_REASON_CODES,
  type SettlementReasonCode,
  SettlementReasonCodeSchema,
  type SettlementResult,
  SettlementResultSchema,
  settlementToVictoryProjection,
} from './combat_settlement';

export const CombatStateSchema = Type.Object(
  {
    schemaVersion: Type.Literal(COMBAT_SCHEMA_VERSION, { description: 'Wire schema version' }),
    rulesVersion: Type.String({ minLength: 1, description: 'e.g. "combat-2.0.0"' }),
    encounterId: Type.String({ minLength: 1 }),
    /**
     * Identity of THIS run of the encounter. A retry produces a new run id, so
     * a stale reaction callback or continuation from the previous run is
     * rejected rather than applied to the fresh encounter.
     * Contract: C-532 AC-4, AC-6.
     */
    encounterRunId: Type.String({ minLength: 1, maxLength: 128 }),
    /** Monotonic — +1 per successful resolve, unchanged on validation failure. */
    stateRevision: Type.Integer({ minimum: 0 }),
    round: Type.Integer({ minimum: 1 }),
    phase: CombatPhaseSchema,
    /** Deterministic, non-random — e.g. `r{round}:{combatantId}`. */
    turnId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    rng: CombatRngStateSchema,
    initiative: InitiativeStateSchema,
    combatants: Type.Record(Type.String(), CombatantStateSchema),
    /** Self-contained rules input (Open Question Q2). */
    abilityCatalog: Type.Record(Type.String(), CombatAbilityDefinitionSchema),
    battlefield: BattlefieldStateSchema,
    /**
     * Live authored-object and surface state (Combat-07). Every encounter
     * carries it; a fight without environmental mechanics carries the empty
     * state.
     */
    environment: EnvironmentalStateSchema,
    /**
     * The pinned, immutable definition bundle this encounter resolves
     * environmental commands against. Replay reads it — never the latest
     * mutable content pack.
     */
    environmentBundle: CombatEnvironmentBundleSchema,
    objectives: Type.Array(CombatObjectiveStateSchema),
    /**
     * The pinned authored objective rules this encounter evaluates against.
     * Absent authored content means the empty rules — a fight whose only
     * termination is the legacy defeat-group outcome. Contract: C-532 AC-1.
     */
    objectiveRules: ObjectiveRulesSchema,
    /**
     * Per-combatant participation and bounded mechanical morale. Every
     * combatant carries an entry; the record is the single morale authority.
     * Contract: C-532 AC-2.
     */
    participation: Type.Record(Type.String(), ParticipationStateSchema),
    /** The pinned authored morale rules. Contract: C-532 AC-2. */
    moraleRules: MoraleRulesSchema,
    /** The pinned registered reaction definitions. Contract: C-532 AC-3. */
    reactionRegistry: ReactionRegistrySchema,
    /** Open reaction windows. Contract: C-532 AC-3. */
    reaction: ReactionStateSchema,
    /**
     * The single terminal settlement, or `null` while the encounter is live.
     * Contract: C-532 AC-5.
     */
    settlement: Type.Union([EncounterSettlementSchema, Type.Null()]),
    outcome: Type.Union([CombatOutcomeSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export type CombatState = Static<typeof CombatStateSchema>;

/**
 * Upgrades a v2 or v3 snapshot to the current wire version.
 *
 * v2 → v3 attaches EMPTY environmental state (C-531's pattern).
 * v3 → v4 attaches EMPTY objective rules, ACTIVE participation with no
 * invented morale history, the empty morale rules / reaction registry, and no
 * settlement, and gives every existing objective record `progress: 0`.
 *
 * Only shape-compatible input is upgraded; anything else is returned
 * unchanged so the caller can reject it through the normal schema check.
 * A snapshot that already declares the current version is returned as-is.
 *
 * Contract: C-531 AC-7, C-532 AC-6
 */
export const migrateCombatStateToCurrentVersion = (snapshot: unknown): unknown => {
  if (snapshot === null || typeof snapshot !== 'object') {
    return snapshot;
  }
  const candidate = snapshot as Record<string, unknown>;
  if (candidate.schemaVersion === COMBAT_SCHEMA_VERSION_V2) {
    return upgradeV3ToV4({
      ...candidate,
      schemaVersion: COMBAT_SCHEMA_VERSION_V3,
      environment: emptyEnvironmentalState(),
      environmentBundle: emptyEnvironmentBundle(),
    });
  }
  if (candidate.schemaVersion === COMBAT_SCHEMA_VERSION_V3) {
    return upgradeV3ToV4(candidate);
  }
  return snapshot;
};

/**
 * v3 → v4. Older encounters have no authored objectives, so they migrate to
 * their existing defeat-group semantics: the authored rules stay EMPTY and no
 * ritual deadline is injected. Older actors default to ACTIVE participation
 * with the rules' starting morale and no applied-trigger history. Existing
 * `defeated` state maps explicitly onto `participation.status = 'defeated'`.
 */
const upgradeV3ToV4 = (candidate: Record<string, unknown>): unknown => {
  const moraleRules = emptyMoraleRules();
  const combatants =
    candidate.combatants !== null && typeof candidate.combatants === 'object'
      ? (candidate.combatants as Record<string, unknown>)
      : {};
  const participation: Record<string, ParticipationState> = {};
  for (const [combatantId, value] of Object.entries(combatants)) {
    const combatant =
      value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    participation[combatantId] = {
      status: combatant.defeated === true ? 'defeated' : 'active',
      morale: moraleRules.startingMorale,
      appliedTriggerIds: [],
      reactionPolicy: 'ask',
    };
  }
  const objectives = Array.isArray(candidate.objectives)
    ? candidate.objectives.map((objective) => {
        if (objective === null || typeof objective !== 'object') {
          return objective;
        }
        const record = objective as Record<string, unknown>;
        return record.progress === undefined ? { ...record, progress: 0 } : record;
      })
    : [];

  return {
    ...candidate,
    schemaVersion: COMBAT_SCHEMA_VERSION,
    // A migrated snapshot gets a deterministic run identity derived from the
    // encounter id: no ambient randomness, stable across replay.
    encounterRunId:
      typeof candidate.encounterRunId === 'string'
        ? candidate.encounterRunId
        : `run:${String(candidate.encounterId ?? 'unknown')}:0`,
    objectives,
    objectiveRules: emptyObjectiveRules(),
    participation,
    moraleRules,
    reactionRegistry: emptyReactionRegistry(),
    reaction: emptyReactionState(),
    settlement: null,
  };
};
