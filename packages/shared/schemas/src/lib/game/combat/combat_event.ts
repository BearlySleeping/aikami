// packages/shared/schemas/src/lib/game/combat/combat_event.ts
//
// Combat events are facts — the ECS/UI/narration integration surface.
// Every event carries encounter/turn/revision identity (architecture §8.6).
//
// Contract: C-509 AC-1

import Type, { type Static } from 'typebox';
import { DamageTypeKeySchema } from '../damage_type';
import { CoverLevelSchema, ObjectStateSchema, SurfaceKindSchema } from './combat_environment';
import { GridPointSchema } from './combat_grid';

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

/** Identity every combat event carries. */
export const CombatEventEnvelopeSchema = Type.Object(
  {
    encounterId: Type.String({ minLength: 1 }),
    turnId: Type.String({ minLength: 1 }),
    /** Revision of the state this event produced. */
    stateRevision: Type.Integer({ minimum: 0 }),
    round: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export type CombatEventEnvelope = Static<typeof CombatEventEnvelopeSchema>;

/** Envelope fields spread into every variant below. */
const envelopeFields = {
  encounterId: Type.String({ minLength: 1 }),
  turnId: Type.String({ minLength: 1 }),
  stateRevision: Type.Integer({ minimum: 0 }),
  round: Type.Integer({ minimum: 1 }),
};

// ---------------------------------------------------------------------------
// Event variants — discriminated on `kind`
// ---------------------------------------------------------------------------

export const TurnStartedEventSchema = Type.Object(
  {
    ...envelopeFields,
    kind: Type.Literal('turnStarted'),
    combatantId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type TurnStartedEvent = Static<typeof TurnStartedEventSchema>;

export const MovementCommittedEventSchema = Type.Object(
  {
    ...envelopeFields,
    kind: Type.Literal('movementCommitted'),
    combatantId: Type.String({ minLength: 1 }),
    path: Type.Array(GridPointSchema, { minItems: 1 }),
    movementCost: Type.Integer({ minimum: 0 }),
    movementRemaining: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type MovementCommittedEvent = Static<typeof MovementCommittedEventSchema>;

export const AttackRolledEventSchema = Type.Object(
  {
    ...envelopeFields,
    kind: Type.Literal('attackRolled'),
    attackerId: Type.String({ minLength: 1 }),
    targetId: Type.String({ minLength: 1 }),
    abilityId: Type.String({ minLength: 1 }),
    naturalRoll: Type.Integer({ minimum: 1, maximum: 20 }),
    totalRoll: Type.Integer(),
    hit: Type.Boolean(),
    isCriticalHit: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type AttackRolledEvent = Static<typeof AttackRolledEventSchema>;

export const DamageAppliedEventSchema = Type.Object(
  {
    ...envelopeFields,
    kind: Type.Literal('damageApplied'),
    attackerId: Type.String({ minLength: 1 }),
    targetId: Type.String({ minLength: 1 }),
    amount: Type.Integer({ minimum: 0 }),
    damageType: DamageTypeKeySchema,
    hpAfter: Type.Integer({ minimum: 0 }),
    downed: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type DamageAppliedEvent = Static<typeof DamageAppliedEventSchema>;

export const CombatantDownedEventSchema = Type.Object(
  {
    ...envelopeFields,
    kind: Type.Literal('combatantDowned'),
    combatantId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type CombatantDownedEvent = Static<typeof CombatantDownedEventSchema>;

export const CombatantDefeatedEventSchema = Type.Object(
  {
    ...envelopeFields,
    kind: Type.Literal('combatantDefeated'),
    combatantId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type CombatantDefeatedEvent = Static<typeof CombatantDefeatedEventSchema>;

export const TurnEndedEventSchema = Type.Object(
  {
    ...envelopeFields,
    kind: Type.Literal('turnEnded'),
    combatantId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type TurnEndedEvent = Static<typeof TurnEndedEventSchema>;

export const CombatEndedEventSchema = Type.Object(
  {
    ...envelopeFields,
    kind: Type.Literal('combatEnded'),
    victory: Type.Boolean(),
    reason: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type CombatEndedEvent = Static<typeof CombatEndedEventSchema>;

// ---------------------------------------------------------------------------
// Environmental events (Combat-07)
//
// These are FACTS about committed state changes — the narration surface reads
// them instead of re-deriving consequences from the command. Contract: C-531.
// ---------------------------------------------------------------------------

/** One resolved environmental check, with every input that produced it. */
export const EnvironmentalCheckRolledEventSchema = Type.Object(
  {
    ...envelopeFields,
    kind: Type.Literal('environmentalCheckRolled'),
    combatantId: Type.String({ minLength: 1 }),
    objectId: Type.String({ minLength: 1 }),
    affordanceId: Type.String({ minLength: 1 }),
    checkCategory: Type.String({ minLength: 1 }),
    modifierSource: Type.String({ minLength: 1 }),
    modifier: Type.Integer(),
    naturalRoll: Type.Integer({ minimum: 1, maximum: 20 }),
    total: Type.Integer(),
    dc: Type.Integer({ minimum: 0 }),
    success: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type EnvironmentalCheckRolledEvent = Static<typeof EnvironmentalCheckRolledEventSchema>;

export const ObjectStateChangedEventSchema = Type.Object(
  {
    ...envelopeFields,
    kind: Type.Literal('objectStateChanged'),
    objectId: Type.String({ minLength: 1 }),
    previousState: ObjectStateSchema,
    state: ObjectStateSchema,
    durability: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type ObjectStateChangedEvent = Static<typeof ObjectStateChangedEventSchema>;

export const ObjectMovedEventSchema = Type.Object(
  {
    ...envelopeFields,
    kind: Type.Literal('objectMoved'),
    objectId: Type.String({ minLength: 1 }),
    from: GridPointSchema,
    to: GridPointSchema,
    steps: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type ObjectMovedEvent = Static<typeof ObjectMovedEventSchema>;

export const ObjectIgnitedChangedEventSchema = Type.Object(
  {
    ...envelopeFields,
    kind: Type.Literal('objectIgnitedChanged'),
    objectId: Type.String({ minLength: 1 }),
    ignited: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type ObjectIgnitedChangedEvent = Static<typeof ObjectIgnitedChangedEventSchema>;

export const ObjectCoverChangedEventSchema = Type.Object(
  {
    ...envelopeFields,
    kind: Type.Literal('objectCoverChanged'),
    objectId: Type.String({ minLength: 1 }),
    cover: CoverLevelSchema,
  },
  { additionalProperties: false },
);

export type ObjectCoverChangedEvent = Static<typeof ObjectCoverChangedEventSchema>;

/** One forced-movement effect: the cells actually traversed, never the asked-for count. */
export const ForcedMovementAppliedEventSchema = Type.Object(
  {
    ...envelopeFields,
    kind: Type.Literal('forcedMovementApplied'),
    combatantId: Type.String({ minLength: 1 }),
    sourceObjectId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    path: Type.Array(GridPointSchema, { minItems: 1 }),
    cellsMoved: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type ForcedMovementAppliedEvent = Static<typeof ForcedMovementAppliedEventSchema>;

export const SurfaceCreatedEventSchema = Type.Object(
  {
    ...envelopeFields,
    kind: Type.Literal('surfaceCreated'),
    surfaceId: Type.String({ minLength: 1 }),
    surfaceKind: SurfaceKindSchema,
    cell: GridPointSchema,
    sourceObjectId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);

export type SurfaceCreatedEvent = Static<typeof SurfaceCreatedEventSchema>;

export const SurfaceRemovedEventSchema = Type.Object(
  {
    ...envelopeFields,
    kind: Type.Literal('surfaceRemoved'),
    surfaceId: Type.String({ minLength: 1 }),
    surfaceKind: SurfaceKindSchema,
    cell: GridPointSchema,
    reason: Type.Union([Type.Literal('expired'), Type.Literal('effect')]),
  },
  { additionalProperties: false },
);

export type SurfaceRemovedEvent = Static<typeof SurfaceRemovedEventSchema>;

/** One payload that left its support, plus the zone it landed on. */
export const PayloadDroppedEventSchema = Type.Object(
  {
    ...envelopeFields,
    kind: Type.Literal('payloadDropped'),
    supportObjectId: Type.String({ minLength: 1 }),
    payloadObjectId: Type.String({ minLength: 1 }),
    impactZone: Type.String({ minLength: 1 }),
    cells: Type.Array(GridPointSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export type PayloadDroppedEvent = Static<typeof PayloadDroppedEventSchema>;

/** Damage with no attacker: a hazard tick, an impact zone or a direct effect. */
export const EnvironmentalDamageAppliedEventSchema = Type.Object(
  {
    ...envelopeFields,
    kind: Type.Literal('environmentalDamageApplied'),
    combatantId: Type.String({ minLength: 1 }),
    sourceKind: Type.Union([Type.Literal('hazard'), Type.Literal('impact'), Type.Literal('effect')]),
    sourceId: Type.String({ minLength: 1 }),
    amount: Type.Integer({ minimum: 0 }),
    damageType: DamageTypeKeySchema,
    hpAfter: Type.Integer({ minimum: 0 }),
    downed: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type EnvironmentalDamageAppliedEvent = Static<typeof EnvironmentalDamageAppliedEventSchema>;

/** Records the hazard identity that suppresses a second hit in the same round. */
export const HazardTickStampedEventSchema = Type.Object(
  {
    ...envelopeFields,
    kind: Type.Literal('hazardTickStamped'),
    combatantId: Type.String({ minLength: 1 }),
    hazardFamilyId: Type.String({ minLength: 1 }),
    round: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export type HazardTickStampedEvent = Static<typeof HazardTickStampedEventSchema>;

/** Discriminated union of every Combat-01 combat event. */
export const CombatEventSchema = Type.Union([
  TurnStartedEventSchema,
  MovementCommittedEventSchema,
  AttackRolledEventSchema,
  DamageAppliedEventSchema,
  CombatantDownedEventSchema,
  CombatantDefeatedEventSchema,
  TurnEndedEventSchema,
  CombatEndedEventSchema,
  EnvironmentalCheckRolledEventSchema,
  ObjectStateChangedEventSchema,
  ObjectMovedEventSchema,
  ObjectIgnitedChangedEventSchema,
  ObjectCoverChangedEventSchema,
  ForcedMovementAppliedEventSchema,
  SurfaceCreatedEventSchema,
  SurfaceRemovedEventSchema,
  PayloadDroppedEventSchema,
  EnvironmentalDamageAppliedEventSchema,
  HazardTickStampedEventSchema,
]);

export type CombatEvent = Static<typeof CombatEventSchema>;

/** The `kind` discriminator values of {@link CombatEventSchema}. */
export type CombatEventKind = CombatEvent['kind'];
