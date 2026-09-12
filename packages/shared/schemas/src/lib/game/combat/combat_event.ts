// packages/shared/schemas/src/lib/game/combat/combat_event.ts
//
// Combat events are facts — the ECS/UI/narration integration surface.
// Every event carries encounter/turn/revision identity (architecture §8.6).
//
// Contract: C-509 AC-1

import Type, { type Static } from 'typebox';
import { DamageTypeKeySchema } from '../damage_type';
import { GridPointSchema } from './combat_state';

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
]);

export type CombatEvent = Static<typeof CombatEventSchema>;

/** The `kind` discriminator values of {@link CombatEventSchema}. */
export type CombatEventKind = CombatEvent['kind'];
