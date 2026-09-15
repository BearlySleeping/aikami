// packages/shared/schemas/src/lib/game/combat/combat_settlement.ts
//
// Combat-08 terminal settlement wire contract.
//
// There is exactly one terminal settlement per encounter, produced by one
// ordered resolution pass. `EncounterSettlement.result` classifies the
// encounter for the player's side and is the *only* authority for the
// encounter's result; `reasonCode` plus `objectiveResults` carry the
// distinguishing detail. A nonlethal resolution (rout, enemy surrender,
// objective completion, escape) still resolves to `victory` / `defeat` /
// `escape` — there is deliberately no fourth variant, so the boolean
// `CombatOutcome.victory` projection stays mappable.
//
// `settlementId` is the idempotency key for reward/world persistence. Applying
// a settlement twice is a no-op.
//
// Contract: C-532 AC-5

import Type, { type Static } from 'typebox';
import { ObjectiveProgressSchema } from './combat_objective';

/** Hard caps for the settlement vocabulary. */
export const COMBAT_SETTLEMENT_BOUNDS = {
  idChars: 128,
  /** Maximum objective results recorded on one settlement. */
  objectiveResults: 32,
} as const;

/**
 * The closed reason-code vocabulary. Every terminal settlement names one of
 * these; free prose never selects one.
 */
export const SettlementReasonCodeSchema = Type.Union([
  Type.Literal('all_enemies_defeated'),
  Type.Literal('hostile_group_routed'),
  Type.Literal('objective_completed'),
  Type.Literal('protected_actor_lost'),
  Type.Literal('deadline_expired'),
  Type.Literal('objective_failed'),
  Type.Literal('party_defeated'),
  Type.Literal('escaped_encounter'),
  Type.Literal('no_combatants'),
]);

export type SettlementReasonCode = Static<typeof SettlementReasonCodeSchema>;

/** Every settlement reason code, in canonical order. */
export const SETTLEMENT_REASON_CODES: readonly SettlementReasonCode[] = [
  'all_enemies_defeated',
  'hostile_group_routed',
  'objective_completed',
  'protected_actor_lost',
  'deadline_expired',
  'objective_failed',
  'party_defeated',
  'escaped_encounter',
  'no_combatants',
] as const;

/**
 * The encounter result for the player's side.
 *
 * `escape` is a *successful* disengagement, not a loss; it is distinct from
 * `defeat` so the exploration handoff can differ from the retry handoff.
 */
export const SettlementResultSchema = Type.Union([
  Type.Literal('victory'),
  Type.Literal('defeat'),
  Type.Literal('escape'),
]);

export type SettlementResult = Static<typeof SettlementResultSchema>;

/**
 * The single terminal settlement for an encounter.
 */
export const EncounterSettlementSchema = Type.Object(
  {
    /** Idempotency key for reward/world persistence. */
    settlementId: Type.String({ minLength: 1, maxLength: COMBAT_SETTLEMENT_BOUNDS.idChars }),
    result: SettlementResultSchema,
    reasonCode: SettlementReasonCodeSchema,
    objectiveResults: Type.Array(ObjectiveProgressSchema, {
      maxItems: COMBAT_SETTLEMENT_BOUNDS.objectiveResults,
    }),
    /** Encounter round at which the settlement was committed. */
    round: Type.Integer({ minimum: 1 }),
    /**
     * Whether reward/world persistence has been acknowledged. A settlement
     * with `rewardApplied: false` is re-applied on load — idempotently, keyed
     * by `settlementId`.
     */
    rewardApplied: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type EncounterSettlement = Static<typeof EncounterSettlementSchema>;

/**
 * Maps the authoritative settlement onto the legacy boolean projection
 * retained by existing consumers. `escape` is a victory for the player's side:
 * the encounter was disengaged on the player's terms.
 *
 * This is the single documented mapping — no consumer may re-derive it.
 */
export const settlementToVictoryProjection = (settlement: EncounterSettlement): boolean =>
  settlement.result !== 'defeat';
