// packages/frontend/ai-gateway/src/lib/decision/tasks/npc_command_kind.ts
//
// The frozen decision task, its corpus and its gates (issue #381).
//
// ---------------------------------------------------------------------------
// What this task IS, stated exactly
// ---------------------------------------------------------------------------
//
// Selecting, from a closed set, which single bounded NPC dialogue command (if
// any) a player's message warrants. It is a RESEARCH PROBE and it is labelled
// as one. It does NOT validate production mutation routing, because it cannot:
//
//   - Production commands carry payloads. `NpcDialogueGiveItemCommandSchema`
//     requires `itemId` and `quantity`; `offerQuest` requires `questId`;
//     `skillCheck` requires a skill and a difficulty class. This probe grades a
//     bare discriminator with no payload, no ID resolution and no domain check.
//   - Production preconditions are the game's, not the model's. Asking for a
//     quest is not the NPC agreeing to one, and `giveItem` requires the NPC to
//     possess the item at all.
//   - Production routing still runs two LLM calls and owns the mutation. This
//     probe measures a substitute for one narrow slice of the second one.
//
// Anything claiming this probe qualifies production routing would be claiming
// something the corpus cannot support. The honest claim is narrower: it
// measures whether a bounded discriminator can select a command kind from
// player text at interactive latency.
//
// ---------------------------------------------------------------------------
// Two corrections made to the original pilot, before anything was scored
// ---------------------------------------------------------------------------
//
// 1. `giveItem` was described BACKWARDS. The option text said "the player hands
//    an item over to this NPC"; the production schema says the opposite:
//    "Grants an item to the player. Requires the NPC to possess the item." A
//    corpus labelled against the reversed description grades a model for
//    answering the wrong question.
//
// 2. There was NO ordinary no-command outcome. The original schema required a
//    `commandKind` drawn from seven state-changing literals, so the backend
//    could not express "nothing is warranted here" — and `none` is the single
//    most common production outcome, because `NpcDialogueAiEnvelopeSchema`
//    types `command` as optional. A discriminator that structurally cannot say
//    "no" measures something the game never does.
//
// ---------------------------------------------------------------------------
// Gate discipline
// ---------------------------------------------------------------------------
//
// Every threshold below is declared HERE, before any backend is scored, and the
// evaluator records the gate it used in its artifact so a moved threshold is
// visible in the report rather than hidden in a diff.

import Type, { type Static } from 'typebox';
import type {
  DecisionTaskPolicy,
  DecisionValueComparator,
  EvaluationQualityGate,
} from '../index.ts';

/**
 * The discriminator literals.
 *
 * `none` is a first-class literal, not a sentinel: "the player asked for
 * something this NPC cannot be asked for" is an ordinary, correct answer.
 */
export const NPC_COMMAND_KIND_LITERALS = [
  'none',
  'trade',
  'offerQuest',
  'skillCheck',
  'giveItem',
  'startCombat',
  'recruit',
  'presentEvidence',
] as const;

/** The literal that means "no command is warranted". */
export const NPC_COMMAND_KIND_NONE = 'none';

/** The task id used in telemetry, cache identity and evaluation artifacts. */
export const NPC_COMMAND_KIND_TASK_ID = 'npc-command-kind';

/**
 * The probe's schema: one closed choice over command kinds, `none` included.
 *
 * Deliberately the KIND, not the production command. See the header: this task
 * does not carry payloads and does not claim to validate mutation routing.
 */
export const NPC_COMMAND_KIND_SCHEMA = Type.Object(
  {
    commandKind: Type.Union(NPC_COMMAND_KIND_LITERALS.map((literal) => Type.Literal(literal))),
  },
  { additionalProperties: false },
);

/** Static form of {@link NPC_COMMAND_KIND_SCHEMA}. */
export type NpcCommandKindProbe = Static<typeof NPC_COMMAND_KIND_SCHEMA>;

/**
 * Option descriptions, keyed by literal VALUE.
 *
 * `giveItem` is the corrected direction: the NPC grants the item to the
 * player, per `NpcDialogueGiveItemCommandSchema`.
 */
export const NPC_COMMAND_KIND_OPTION_DESCRIPTIONS = {
  none: 'The message asks for nothing this NPC can be asked to do, so no command should be issued.',
  trade: 'The player wants to open the trade overlay with this vendor.',
  offerQuest: 'The player asks this NPC to offer them a quest.',
  skillCheck: 'The player asks for a d20 skill check to be attempted.',
  giveItem:
    'The player asks this NPC to hand an item over to them, as if the NPC were giving it away.',
  startCombat: 'The player asks this NPC to come to blows.',
  recruit: 'The player asks this NPC to join the party.',
  presentEvidence: 'The player presents a discovered evidence item to this NPC.',
} as const;

/**
 * The task policy.
 *
 * `enabled: true` is scoped to this evaluation harness and the settings
 * "test sample inference" path. It does NOT switch on routing anywhere: no
 * production call site references this policy, and workload qualification is a
 * separate, separate gate that this PR deliberately leaves closed.
 */
export const NPC_COMMAND_KIND_POLICY: DecisionTaskPolicy = {
  task: NPC_COMMAND_KIND_TASK_ID,
  enabled: true,
  language: 'en',
  instructions:
    'Read a player message to one NPC and decide which single bounded dialogue command, if any, it warrants. Most messages warrant no command at all.',
  fieldInstructions: {
    commandKind:
      'Which single bounded dialogue command does this player message warrant for this NPC?',
  },
  optionDescriptions: { commandKind: NPC_COMMAND_KIND_OPTION_DESCRIPTIONS },
  booleanPolicy: { acceptProbability: 0.9, confidentProbability: 0.98, fallback: 'reject' },
  /**
   * Selective acceptance for the discriminator.
   *
   * A schema-valid choice is not evidence of a correct one, and the backend's
   * own probability is its distribution over options — not a certificate that
   * the option is right. These thresholds were chosen by reading the
   * development split only, and they are applied unchanged to the held-out
   * split, which is reported once and never tuned against.
   */
  choicePolicy: { acceptProbability: 0.7, confidentProbability: 0.95, fallback: 'reject' },
};

/**
 * Reduces a reconstructed value to the literal being graded.
 *
 * Supplied explicitly rather than left to the default so the task declares
 * which of its outputs is the answer. A task that does not say is not guessed
 * at.
 */
export const NPC_COMMAND_KIND_COMPARATOR: DecisionValueComparator = (value) => {
  const raw = value.commandKind;
  return typeof raw === 'string' ? raw : undefined;
};

/**
 * Quality gates. FROZEN before any backend was scored.
 *
 * These are written for this task, not for "a decision model" in general.
 */
export const NPC_COMMAND_KIND_QUALITY_GATE: EvaluationQualityGate = {
  /** Correct over every held-out positive; abstention is a miss, not a pass. */
  minPositiveRecall: 0.85,
  /**
   * Share of held-out cases where no command is warranted that must NOT receive
   * one. This is the expensive failure: each one is a real state change fired at
   * a real NPC on a message that asked for nothing.
   */
  maxFalseAcceptanceRate: 0.05,
  /** Absolute ceiling on the same failure. A rate over a handful of cases hides it. */
  maxFalseAcceptances: 0,
  /**
   * Minimum share of graded cases that reach a decision.
   *
   * Modest, because `none` is now expressible: a backend is not rewarded for
   * refusing, and it is not punished for being slow on the hard ones.
   */
  minCoverage: 0.9,
  /** Every produced value must satisfy the original schema. */
  minLegalValueRate: 1,
  /**
   * Per-language recall floors. Only English is declared by the checkpoints
   * under test; any other slice must ABSTAIN, which is checked by
   * `language-unsupported` rather than by answering in English.
   */
  minLanguageRecall: { en: 0.85 },
};

/**
 * Latency gates. FROZEN before any backend was scored.
 *
 * Anchored to the interactive budget the caller already has, not to a vendor
 * throughput table: this is only useful if it arrives inside the interaction it
 * would replace.
 */
export const NPC_COMMAND_KIND_LATENCY_GATE = {
  /** Warm end-to-end p50, milliseconds. */
  maxWarmP50Ms: 250,
  /** Warm end-to-end p95, milliseconds. */
  maxWarmP95Ms: 750,
  /** Cold first-call p95, milliseconds — model load included. */
  maxColdP95Ms: 4000,
} as const;

/** Whether a literal is a real state-changing command rather than `none`. */
export const isStateChangingCommand = (literal: string): boolean =>
  literal !== NPC_COMMAND_KIND_NONE;
