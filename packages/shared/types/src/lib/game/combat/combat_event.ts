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
  MovementCommittedEventSchema,
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
