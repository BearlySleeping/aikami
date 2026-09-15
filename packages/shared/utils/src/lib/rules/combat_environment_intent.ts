// packages/shared/utils/src/lib/rules/combat_environment_intent.ts
//
// Environmental step grounding for the Combat-05 intent compiler (C-531 AC-4).
//
// The model (or the player) NAMES an object and an action; this module is the
// only place those names become mechanical ids. It reads the encounter's pinned
// registry — never the latest content pack — and produces the same
// `interactWithObject` command the manual object inspector sends, so a spoken
// request and a click resolve identically.
//
// The compiler's grounding helpers are INJECTED ({@link CompileInteractDeps})
// rather than imported, so this module depends only on the environment registry
// and the compiler keeps its private helpers private.
//
// Contract: C-531 AC-4

import type {
  ActionIntent,
  ClarificationRequest,
  CombatCommand,
  CombatInvalidReason,
  CombatState,
  CompiledPlan,
  IntentStep,
} from '@aikami/types';
import { getObjectAffordances, sortedObjects } from './combat_environment';

/** One grounded candidate: the plan plus the step that produced it. */
export type IntentPlanCandidate = {
  plan: CompiledPlan;
  step: IntentStep;
};

/** The compiler's answer for one step. */
export type CompileIntentResult =
  | { ok: true; kind: 'plan'; plan: CompiledPlan }
  | { ok: true; kind: 'clarification'; clarification: ClarificationRequest; plans: CompiledPlan[] }
  | { ok: false; reasonCode: CombatInvalidReason; messageKey: string };

/**
 * The compiler's grounding helpers.
 *
 * `groundCommand` validates + forecasts a concrete command through the SAME
 * kernel the commit path uses, so a compiled plan and its commit cannot
 * disagree.
 */
export type CompileInteractDeps = {
  compareIds: (a: string, b: string) => number;
  matchesNamedRef: (options: { name: string; id: string; namedRef: string }) => boolean;
  groundCommand: (options: {
    state: CombatState;
    intent: ActionIntent;
    command: CombatCommand;
    assumptions: string[];
  }) => { ok: true; plan: CompiledPlan } | { ok: false; reasonCode: CombatInvalidReason };
  decideIntentClarification: (candidates: IntentPlanCandidate[]) => ClarificationRequest | null;
  rejection: (reasonCode: CombatInvalidReason) => CompileIntentResult;
};

/**
 * Grounds one `interact_with_object` step (C-531 AC-4).
 *
 * The model (or the player) NAMES an object and an action; this function is
 * the only place those names become mechanical ids. It reads the encounter's
 * pinned registry — never the latest content pack — and produces the same
 * `interactWithObject` command the manual object inspector sends, so a spoken
 * request and a click resolve identically.
 *
 * An ambiguous name yields a bounded clarification round; a name that matches
 * nothing is a typed rejection, never an invented action.
 */
export const compileInteractWithObject = (options: {
  state: CombatState;
  intent: ActionIntent;
  step: Extract<IntentStep, { kind: 'interact_with_object' }>;
  maxCandidates: number;
  stepIndex: number;
  /** The compiler's grounding helpers, injected to keep this module leaf-like. */
  deps: CompileInteractDeps;
}): CompileIntentResult => {
  const { state, intent, step, deps } = options;
  const { compareIds, matchesNamedRef, groundCommand, decideIntentClarification, rejection } = deps;
  const actorId = intent.actorId;
  const actor = state.combatants[actorId];
  if (actor === undefined) {
    return rejection('actorUnknown');
  }

  // The inspector already answers "what can this actor do to this object, and
  // why not" — the compiler reads it instead of re-deriving eligibility.
  const views = getObjectAffordances({ state, actorId });

  const matchedObjects = [
    ...new Set(
      views
        .filter((view) => {
          const definition = state.environmentBundle.objectDefinitions[view.definitionId];
          return matchesNamedRef({
            name: definition?.name ?? view.definitionId,
            id: view.objectId,
            namedRef: step.object,
          });
        })
        .map((view) => view.objectId),
    ),
  ].sort(compareIds);

  if (matchedObjects.length === 0) {
    return rejection('objectUnknown');
  }

  // A named destination object is resolved the same way; an unresolvable one is
  // a rejection rather than a silently dropped half of the request.
  let targetObjectId: string | null = null;
  if (step.targetObject !== undefined) {
    const targetMatches = sortedObjects(state)
      .filter((object) => {
        const definition = state.environmentBundle.objectDefinitions[object.definitionId];
        return matchesNamedRef({
          name: definition?.name ?? object.definitionId,
          id: object.objectId,
          namedRef: step.targetObject ?? '',
        });
      })
      .map((object) => object.objectId)
      .sort(compareIds);
    if (targetMatches.length === 0) {
      return rejection('objectUnknown');
    }
    targetObjectId = targetMatches[0];
  }

  const candidates: IntentPlanCandidate[] = [];
  let sawAffordanceMatch = false;
  for (const objectId of matchedObjects) {
    if (candidates.length >= options.maxCandidates) {
      break;
    }
    const affordances = views
      .filter((view) => view.objectId === objectId)
      .filter((view) =>
        matchesNamedRef({
          name: view.name,
          id: view.affordanceId,
          namedRef: step.affordance,
        }),
      )
      .sort((a, b) => compareIds(a.affordanceId, b.affordanceId));
    if (affordances.length === 0) {
      continue;
    }
    sawAffordanceMatch = true;
    for (const affordance of affordances) {
      if (candidates.length >= options.maxCandidates) {
        break;
      }
      const command: CombatCommand = {
        kind: 'interactWithObject',
        combatantId: actorId,
        objectId,
        affordanceId: affordance.affordanceId,
        targetObjectId,
      };
      const grounded = groundCommand({
        state,
        intent,
        command,
        assumptions: [
          `object "${objectId}" resolved deterministically`,
          ...(options.stepIndex === 0
            ? []
            : [`step ${options.stepIndex + 1} compiled as the first legal step`]),
        ],
      });
      if (!grounded.ok) {
        continue;
      }
      candidates.push({
        plan: { ...grounded.plan, planId: `${intent.intentId}:${candidates.length + 1}` },
        step,
      });
    }
  }

  if (candidates.length === 0) {
    return rejection(sawAffordanceMatch ? 'affordanceNotAvailable' : 'affordanceUnknown');
  }

  const clarification = decideIntentClarification(candidates);
  if (clarification === null) {
    return { ok: true, kind: 'plan', plan: candidates[0].plan };
  }
  return {
    ok: true,
    kind: 'clarification',
    clarification,
    plans: candidates.map((candidate) => candidate.plan),
  };
};
