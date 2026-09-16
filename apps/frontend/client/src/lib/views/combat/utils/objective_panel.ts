// apps/frontend/client/src/lib/views/combat/utils/objective_panel.ts
//
// Objective panel projection (Combat-08).
//
// Pure: a `CombatState` plus authored display names in, the rows the sidebar
// renders out. No bridge, no engine, no repository — the flow that owns the
// snapshot calls this and stores the result.
//
// Two rules the projection enforces, because they are correctness properties
// rather than presentation choices:
//
//   - a HIDDEN objective is never listed, even though it is evaluated;
//   - an objective with no authored definition is not invented — the panel
//     shows only what the encounter authored.
//
// Contract: C-532 AC-1

import type { CombatState, ObjectiveDefinition, ObjectiveProgress } from '@aikami/types';

/** One row of the objective panel. */
export type ObjectivePanelEntry = {
  objectiveId: string;
  /** Authored display label, or the id when the pack authored none. */
  label: string;
  kind: ObjectiveDefinition['kind'];
  status: ObjectiveProgress['status'];
  /** Satisfied requirement units. */
  progress: number;
  /** Requirement units required for completion, when the primitive declares one. */
  target: number | null;
  /** Declared round boundary, when the primitive declares one. */
  deadlineRound: number | null;
  /** Whether the objective must complete for a victory. */
  required: boolean;
  /** Screen-reader text: the whole row in one sentence. */
  accessibleLabel: string;
};

/** Total order on objective ids — the panel's stable row order. */
const compareObjectiveIds = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

const STATUS_TEXT: Record<ObjectiveProgress['status'], string> = {
  pending: 'in progress',
  complete: 'complete',
  failed: 'failed',
};

/** Requirement units a primitive needs, or `null` when it is not a count. */
const targetFor = (definition: ObjectiveDefinition): number | null => {
  switch (definition.rule.kind) {
    case 'survive_rounds':
      return definition.rule.rounds;
    case 'reach_zone':
      return definition.rule.requiredActorIds.length;
    case 'defeat_or_rout':
      return definition.rule.hostileIds.length;
    case 'interact_before_deadline':
      return 1;
  }
};

/** Declared round boundary, or `null` when the primitive declares none. */
const deadlineFor = (definition: ObjectiveDefinition): number | null =>
  definition.rule.kind === 'interact_before_deadline' ? definition.rule.deadlineRound : null;

const progressFor = (
  definition: ObjectiveDefinition,
  progress: readonly ObjectiveProgress[],
): ObjectiveProgress => {
  const record = progress.find((entry) => entry.objectiveId === definition.objectiveId);
  return (
    record ?? {
      objectiveId: definition.objectiveId,
      status: 'pending',
      progress: 0,
    }
  );
};

const accessibleLabelFor = (options: {
  entry: Omit<ObjectivePanelEntry, 'accessibleLabel'>;
  round: number;
}): string => {
  const { entry } = options;
  const parts: string[] = [`Objective: ${entry.label}`, STATUS_TEXT[entry.status]];
  if (entry.target !== null && entry.target > 1) {
    parts.push(`${entry.progress} of ${entry.target}`);
  }
  if (entry.deadlineRound !== null) {
    parts.push(
      entry.status === 'pending'
        ? `deadline round ${entry.deadlineRound}, currently round ${options.round}`
        : `deadline round ${entry.deadlineRound}`,
    );
  }
  if (entry.required) {
    parts.push('required');
  }
  return parts.join(', ');
};

/**
 * Projects the objective rows the panel renders.
 *
 * `labels` maps an objective id to its authored display name. An id with no
 * label falls back to the id itself rather than being dropped — an authored
 * objective the pack forgot to name is still an objective the player must be
 * able to see.
 */
export const projectObjectivePanel = (options: {
  state: Pick<CombatState, 'objectives' | 'objectiveRules' | 'round'>;
  labels?: Record<string, string>;
}): ObjectivePanelEntry[] => {
  const { state } = options;
  const rows: ObjectivePanelEntry[] = [];
  for (const definition of state.objectiveRules.definitions) {
    // Hidden objectives are evaluated normally but never listed.
    if (definition.hidden) {
      continue;
    }
    const record = progressFor(definition, state.objectives);
    const withoutLabel = {
      objectiveId: definition.objectiveId,
      label: options.labels?.[definition.objectiveId] ?? definition.objectiveId,
      kind: definition.kind,
      status: record.status,
      progress: record.progress,
      target: targetFor(definition),
      deadlineRound: deadlineFor(definition),
      required: definition.required,
    };
    rows.push({
      ...withoutLabel,
      accessibleLabel: accessibleLabelFor({ entry: withoutLabel, round: state.round }),
    });
  }
  return rows.sort((a, b) => compareObjectiveIds(a.objectiveId, b.objectiveId));
};
