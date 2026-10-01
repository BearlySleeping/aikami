// packages/frontend/ai-gateway/tests/decision_pilot.ts
//
// The pilot definition shared by the evaluation harness and the registry scan
// (issue #381, contract C-566).
//
// ONE pilot, deliberately bounded: selecting which of the seven bounded NPC
// dialogue commands a player's message asks for. It is the only shipping
// discriminator in Aikami that is a closed finite literal set on the
// interactive path, and it is the one this contract measures. Nothing else is
// opted in — `enabled` on any other task stays false, and no routing exists.

import Type from 'typebox';
import type { DecisionTaskPolicy } from '../src/lib/decision/index.ts';

/** The pilot's bounded schema: one closed choice over command kinds. */
export const PILOT_SCHEMA = Type.Object(
  {
    commandKind: Type.Union([
      Type.Literal('trade'),
      Type.Literal('offerQuest'),
      Type.Literal('skillCheck'),
      Type.Literal('giveItem'),
      Type.Literal('startCombat'),
      Type.Literal('recruit'),
      Type.Literal('presentEvidence'),
    ]),
  },
  { additionalProperties: false },
);

/**
 * The pilot's task policy.
 *
 * `enabled: true` is scoped to this contract's own evaluation harness. It does
 * NOT switch on routing anywhere: no production call site references this
 * policy, and step E owns that gate.
 *
 * Option descriptions are keyed by the literal VALUE, not by a positional
 * option key. The compiler sorts literals for key stability, so a positional
 * key would silently relabel the question the moment the enum changed.
 */
export const PILOT_POLICY: DecisionTaskPolicy = {
  task: 'npc-command-kind',
  enabled: true,
  language: 'en',
  instructions:
    'Decide which bounded dialogue command the player message asks this NPC for, given the seven commands this NPC can actually perform.',
  fieldInstructions: {
    commandKind: 'Which bounded dialogue command does the player message ask this NPC for?',
  },
  optionDescriptions: {
    commandKind: {
      trade: 'The player wants to open the trade overlay with this vendor.',
      offerQuest: 'The player asks this NPC to offer them a quest.',
      skillCheck: 'The player asks for a d20 skill check to be attempted.',
      giveItem: 'The player hands an item over to this NPC.',
      startCombat: 'The player asks this NPC to come to blows.',
      recruit: 'The player asks this NPC to join the party.',
      presentEvidence: 'The player presents a discovered evidence item to this NPC.',
    },
  },
  booleanPolicy: { acceptProbability: 0.9, confidentProbability: 0.98, fallback: 'reject' },
};

/**
 * Quality gates, DECLARED BEFORE ANY BACKEND WAS SCORED.
 *
 * Frozen here so a later measurement cannot quietly move them. They are written
 * for the pilot, not for "a decision model" in general.
 */
export const PILOT_QUALITY_GATE = {
  /** Correct predictions divided by held-out positives; abstentions count as misses. */
  minHeldOutAccuracy: 0.85,
  /**
   * Maximum share of answered held-out cases with a schema-valid
   * but wrong command kind. Wrong here is expensive: it fires a real game
   * command at a real NPC.
   */
  maxRiskyFalseAcceptance: 0.05,
  /**
   * Minimum share of held-out cases that reach a decision at all.
   *
   * Deliberately modest. Abstention is the safe failure; a backend that only
   * answers too few cases fails coverage; abstentions on positives also count
   * as misses in the accuracy gate.
   */
  minCoverage: 0.5,
  /** Every produced value must satisfy the original schema. */
  requireLegalValueRate: 1,
} as const;

/**
 * Latency gates, DECLARED BEFORE ANY BACKEND WAS SCORED.
 *
 * Anchored to the interactive budget the caller already has, not to a
 * throughput table: the value is only useful if it arrives inside the
 * interaction it would replace.
 */
export const PILOT_LATENCY_GATE = {
  /** Warm end-to-end p50, milliseconds. */
  maxWarmP50Ms: 250,
  /** Warm end-to-end p95, milliseconds. */
  maxWarmP95Ms: 750,
  /** Cold first-call p95, milliseconds — model load included. */
  maxColdP95Ms: 4000,
} as const;

/** One fixture case as stored on disk. */
export type DecisionFixtureCase = {
  readonly caseId: string;
  readonly category: string;
  readonly language: string;
  readonly label: 'authored' | 'ambiguous';
  readonly expected: string | null;
  readonly state: string;
};

/** One fixture file as stored on disk. */
export type DecisionFixtureFile = {
  readonly schemaVersion: string;
  readonly split: 'dev' | 'heldout';
  readonly purpose: string;
  readonly task: string;
  readonly labelProvenance: { readonly note: string; readonly kinds: string };
  readonly cases: readonly DecisionFixtureCase[];
};
