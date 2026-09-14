// apps/frontend/client/src/lib/services/game/combat_ai_prompt.ts
//
// Prompt construction for AI combat decisions (Combat-06).
//
// Two rules shape this module (AC-8):
//   1. the INSTRUCTION text is constant — difficulty/risk/obedience change the
//      POLICY fields and the perception snapshot, never "think harder";
//   2. the prompt contains the bounded snapshot only, so the model cannot
//      reason from state it was never given.
//
// Contract: C-526 AC-3, AC-8

import type { CombatDecisionContext } from '@aikami/types';

/**
 * The system instruction — deliberately constant.
 *
 * AC-8 forbids encoding difficulty as "reason better": the model always gets
 * the same character-over-optimization brief, and the caller changes the
 * policy fields in the snapshot instead.
 */
const COMBAT_AI_SYSTEM_PROMPT = [
  'You decide one combat turn for a single character.',
  'Answer with a goal, at most two steps, a fallback, a confidence and a short reason.',
  'Steps use semantic selectors only: never name an entity id, a cell coordinate, a dice value or a hit point total.',
  'Choose as the CHARACTER would, not as a perfect optimizer: goals, personality, relationships, fears, risk tolerance, obedience and role all matter.',
  'A coward may flee, a loyal guard may protect a commander, a vengeful fighter may pursue whoever hurt them.',
  'Every choice must be one the character could legally make with the capabilities listed.',
  'The proposed line is a short intention the player may read; it must not reveal hidden reasoning.',
].join('\n');

/** @returns the constant system instruction. */
export const buildCombatAiSystemPrompt = (): string => COMBAT_AI_SYSTEM_PROMPT;

/**
 * The policy fields of a snapshot, as prompt lines.
 *
 * These are the ONLY fields difficulty is allowed to influence, together with
 * the snapshot itself.
 */
const buildCombatAiPolicyLines = (context: CombatDecisionContext): string[] => [
  `Risk tolerance: ${context.riskTolerance}`,
  `Obedience: ${context.obedience}`,
  `Difficulty policy: ${context.difficulty}`,
  `Morale: ${context.morale}`,
];

/**
 * Builds the user prompt for one actor's decision.
 *
 * The snapshot is the perception-limited `CombatDecisionContext`, serialized
 * whole: it is already bounded and id-free of anything the actor may not see.
 */
export const buildCombatAiPrompt = (options: { context: CombatDecisionContext }): string =>
  [
    `Decide the turn for ${options.context.actor.combatantId} (${options.context.actor.role}).`,
    ...buildCombatAiPolicyLines(options.context),
    'Perception-limited snapshot:',
    JSON.stringify(options.context),
  ].join('\n');

/**
 * Builds the ONE prompt for a same-squad batch (AC-5).
 *
 * The model returns one draft per actor keyed by the actor id it was given;
 * the caller validates each entry separately, so a bad entry degrades that
 * actor alone.
 */
export const buildCombatAiBatchPrompt = (options: {
  contexts: readonly CombatDecisionContext[];
}): string =>
  [
    'Decide one turn for EACH of the following characters.',
    'Return a decision for every actor, keyed by its combatantId.',
    ...options.contexts.map(
      (context) =>
        `--- ${context.actor.combatantId} (${context.actor.role}) ---\n${JSON.stringify(context)}`,
    ),
  ].join('\n');
