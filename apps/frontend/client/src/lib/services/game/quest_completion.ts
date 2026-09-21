// apps/frontend/client/src/lib/services/game/quest_completion.ts
//
// C-339 / C-495 — pure quest-completion graph predicates.
//
// Extracted from `quest_state_service.svelte.ts` (the same pattern as
// `quest_evidence.ts` and `quest_ending_selection.ts`): deciding whether a
// quest's required path is done, exhausted, or has reached a terminal leaf is
// pure computation over progress + definition. The service keeps the state
// mutation (fail, complete, resolve-or-await) and the public API.
//
// Contract: C-339, C-495 Emberwatch dramatic structure

import type { ContentPackQuestEntry, QuestProgress } from '@aikami/types';

/** Whether a quest's required objectives are all done, or a required one failed. */
type RequiredObjectiveOutcome = {
  /** Every non-optional objective is completed or skipped. */
  allRequiredComplete: boolean;
  /** A non-optional objective failed or expired — the quest cannot complete. */
  anyRequiredFailed: boolean;
};

/**
 * Evaluates the required path of a quest.
 *
 * Only required (non-optional, non-failed, non-expired) objectives count toward
 * completion. If any required objective failed or expired, the quest fails
 * instead — a failed path cannot be completed by finishing the others.
 *
 * @param options.progress - The quest's live progress record.
 * @param options.definition - The authored quest definition.
 * @returns Whether the required path is complete, and whether it is exhausted.
 */
export const evaluateRequiredObjectives = (options: {
  progress: QuestProgress;
  definition: ContentPackQuestEntry;
}): RequiredObjectiveOutcome => {
  const { progress, definition } = options;
  let allRequiredComplete = true;
  let anyRequiredFailed = false;

  for (let i = 0; i < definition.objectives.length; i++) {
    const objectiveDef = definition.objectives[i];
    const progressEntry = progress.objectives.find((o) => o.objectiveIndex === i);
    if (!progressEntry) {
      continue;
    }

    const isOptional = objectiveDef.optional === true;

    if (progressEntry.status === 'failed' || progressEntry.status === 'expired') {
      if (!isOptional) {
        anyRequiredFailed = true;
      }
    } else if (
      progressEntry.status !== 'completed' &&
      progressEntry.status !== 'skipped' &&
      !isOptional
    ) {
      allRequiredComplete = false;
    }
  }

  return { allRequiredComplete, anyRequiredFailed };
};

/**
 * Finds the completed REQUIRED terminal objective that resolves a branching
 * quest, if one exists.
 *
 * A terminal objective is one no other objective depends on. Only branching
 * quests (at least one objective declares prerequisites) can resolve this way —
 * a linear quest completes through {@link evaluateRequiredObjectives}.
 *
 * An OPTIONAL terminal objective is a side branch, not a conclusion: completing
 * "ask Sella about the wand" must not end a quest whose authored resolution is
 * "return to the elder and decide the ward's fate". Skipping optional leaves
 * keeps a genuinely branching REQUIRED path working while a side branch stays a
 * side branch.
 *
 * @param options.progress - The quest's live progress record.
 * @param options.definition - The authored quest definition.
 * @returns The completed required terminal objective's index, or `undefined`.
 */
export const findCompletedTerminalObjective = (options: {
  progress: QuestProgress;
  definition: ContentPackQuestEntry;
}): number | undefined => {
  const { progress, definition } = options;

  const hasAnyPrerequisites = definition.objectives.some(
    (objective) => objective.prerequisiteIndices && objective.prerequisiteIndices.length > 0,
  );
  if (!hasAnyPrerequisites) {
    return undefined;
  }

  // Every index some other objective depends on.
  const hasDependents = new Set<number>();
  for (const objective of definition.objectives) {
    for (const prerequisiteIndex of objective.prerequisiteIndices ?? []) {
      hasDependents.add(prerequisiteIndex);
    }
  }

  for (let i = 0; i < definition.objectives.length; i++) {
    if (hasDependents.has(i)) {
      continue; // Has dependents — not terminal.
    }
    if (definition.objectives[i].optional === true) {
      continue; // Optional side branch — never a quest conclusion.
    }
    const progressEntry = progress.objectives.find((o) => o.objectiveIndex === i);
    if (progressEntry?.status === 'completed') {
      return i;
    }
  }

  return undefined;
};
