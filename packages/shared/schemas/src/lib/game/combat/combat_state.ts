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

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/** Quantized tactical cell coordinates (architecture §25.1). */
export const GridPointSchema = Type.Object(
  {
    x: Type.Integer({ description: 'Tactical cell column' }),
    y: Type.Integer({ description: 'Tactical cell row' }),
  },
  { additionalProperties: false },
);

export type GridPoint = Static<typeof GridPointSchema>;

/** Distance band an ability operates within. */
export const RangeBandSchema = Type.Union([
  Type.Literal('melee'),
  Type.Literal('reach'),
  Type.Literal('ranged'),
]);

export type RangeBand = Static<typeof RangeBandSchema>;

/**
 * Combat phase. `'reaction'` is deliberately absent — reactions are Combat-08.
 */
export const CombatPhaseSchema = Type.Union([
  Type.Literal('starting'),
  Type.Literal('active'),
  Type.Literal('ended'),
]);

export type CombatPhase = Static<typeof CombatPhaseSchema>;

/** Per-turn action economy. */
export const TurnBudgetSchema = Type.Object(
  {
    movementRemaining: Type.Integer({ minimum: 0, description: 'Movement cells left this turn' }),
    actionAvailable: Type.Boolean(),
    quickActionAvailable: Type.Boolean(),
    /** Present but unused in Combat-01 (reactions are Combat-08). */
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

export const BattlefieldStateSchema = Type.Object(
  {
    width: Type.Integer({ minimum: 1 }),
    height: Type.Integer({ minimum: 1 }),
    /** Cell-level blocked/walkable projection. */
    blockedCells: Type.Array(GridPointSchema),
  },
  { additionalProperties: false },
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
    kind: Type.String({ minLength: 1 }),
    status: CombatObjectiveStatusSchema,
  },
  { additionalProperties: false },
);

export type CombatObjectiveState = Static<typeof CombatObjectiveStateSchema>;

export const CombatOutcomeSchema = Type.Object(
  {
    victory: Type.Boolean(),
    reason: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type CombatOutcome = Static<typeof CombatOutcomeSchema>;

// ---------------------------------------------------------------------------
// CombatState
// ---------------------------------------------------------------------------

/** Current wire version of {@link CombatStateSchema}. */
export const COMBAT_SCHEMA_VERSION = 2;

export const CombatStateSchema = Type.Object(
  {
    schemaVersion: Type.Literal(COMBAT_SCHEMA_VERSION, { description: 'Wire schema version' }),
    rulesVersion: Type.String({ minLength: 1, description: 'e.g. "combat-2.0.0"' }),
    encounterId: Type.String({ minLength: 1 }),
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
    objectives: Type.Array(CombatObjectiveStateSchema),
    outcome: Type.Union([CombatOutcomeSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export type CombatState = Static<typeof CombatStateSchema>;
