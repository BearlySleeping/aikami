// packages/shared/types/src/lib/game/combat/combat_event.ts
//
// Combat event domain types — derived from `@aikami/schemas`.
// Contract: C-509 AC-1

import type {
  AttackRolledEventSchema,
  CombatantDefeatedEventSchema,
  CombatantDownedEventSchema,
  CombatEndedEventSchema,
  CombatEventEnvelopeSchema,
  CombatEventSchema,
  DamageAppliedEventSchema,
  EnvironmentalCheckRolledEventSchema,
  EnvironmentalDamageAppliedEventSchema,
  ForcedMovementAppliedEventSchema,
  HazardTickStampedEventSchema,
  MovementCommittedEventSchema,
  ObjectCoverChangedEventSchema,
  ObjectIgnitedChangedEventSchema,
  ObjectMovedEventSchema,
  ObjectStateChangedEventSchema,
  PayloadDroppedEventSchema,
  SurfaceCreatedEventSchema,
  SurfaceRemovedEventSchema,
  TurnEndedEventSchema,
  TurnStartedEventSchema,
} from '@aikami/schemas';
import type { Static } from 'typebox';

export type CombatEventEnvelope = Static<typeof CombatEventEnvelopeSchema>;
export type CombatEvent = Static<typeof CombatEventSchema>;
export type CombatEventKind = CombatEvent['kind'];
export type TurnStartedEvent = Static<typeof TurnStartedEventSchema>;
export type MovementCommittedEvent = Static<typeof MovementCommittedEventSchema>;
export type AttackRolledEvent = Static<typeof AttackRolledEventSchema>;
export type DamageAppliedEvent = Static<typeof DamageAppliedEventSchema>;
export type CombatantDownedEvent = Static<typeof CombatantDownedEventSchema>;
export type CombatantDefeatedEvent = Static<typeof CombatantDefeatedEventSchema>;
export type TurnEndedEvent = Static<typeof TurnEndedEventSchema>;
export type CombatEndedEvent = Static<typeof CombatEndedEventSchema>;
export type EnvironmentalCheckRolledEvent = Static<typeof EnvironmentalCheckRolledEventSchema>;
export type ObjectStateChangedEvent = Static<typeof ObjectStateChangedEventSchema>;
export type ObjectMovedEvent = Static<typeof ObjectMovedEventSchema>;
export type ObjectIgnitedChangedEvent = Static<typeof ObjectIgnitedChangedEventSchema>;
export type ObjectCoverChangedEvent = Static<typeof ObjectCoverChangedEventSchema>;
export type ForcedMovementAppliedEvent = Static<typeof ForcedMovementAppliedEventSchema>;
export type SurfaceCreatedEvent = Static<typeof SurfaceCreatedEventSchema>;
export type SurfaceRemovedEvent = Static<typeof SurfaceRemovedEventSchema>;
export type PayloadDroppedEvent = Static<typeof PayloadDroppedEventSchema>;
export type EnvironmentalDamageAppliedEvent = Static<typeof EnvironmentalDamageAppliedEventSchema>;
export type HazardTickStampedEvent = Static<typeof HazardTickStampedEventSchema>;
