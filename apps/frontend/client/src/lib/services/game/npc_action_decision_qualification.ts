// apps/frontend/client/src/lib/services/game/npc_action_decision_qualification.ts
//
// Whether a configured decision backend may answer a gameplay turn
// (issue #381, lane C).
//
// ---------------------------------------------------------------------------
// Why this exists separately
// ---------------------------------------------------------------------------
//
// The first consumer read `qualifiedForGameplay` off the saved connection and
// treated it as a current-version qualification. It is a boolean the PLAYER
// ticked. It says nothing about which task was measured, at which task version,
// over which wire dialect, by which checkpoint.
//
// Manufacturing that is not a small imprecision. A task version bump changes
// the literal space and invalidates every recorded score, and a checkpoint
// swapped under the same connection answers with a different distribution. If
// the gate accepts `true`, it accepts all four mistakes at once, and the gate is
// the only thing standing between a checkpoint and a real mutation at an NPC.
//
// So a qualification must be EVIDENCE, not a flag:
//
//   - no evidence recorded  → refuse
//   - evidence recorded, but not for THIS task / version / dialect / checkpoint
//     → refuse, naming the mismatch
//   - all four match, and the player has not disabled it → allow
//
// Nothing in this build writes such evidence, because no shipped measurement has
// cleared the gate. That is the correct state, not a gap to paper over.

import {
  NPC_ACTION_SELECTION_TASK_ID,
  NPC_ACTION_SELECTION_TASK_VERSION,
} from '@aikami/frontend/ai-gateway/decision/tasks';
import type { ResolvedDecisionBackend } from '../config/decision_backend_resolution.ts';
import type { NpcActionQualification } from './npc_action_decision.ts';

/** What the consumer supports right now. */
export type SupportedQualification = {
  readonly supportedTaskId: string;
  readonly supportedTaskVersion: number;
  readonly supportedDialect: string;
};

const refused = (
  reason: string,
  overrides: Partial<NpcActionQualification> = {},
): NpcActionQualification => ({
  qualified: false,
  taskId: NPC_ACTION_SELECTION_TASK_ID,
  taskVersion: NPC_ACTION_SELECTION_TASK_VERSION,
  dialect: 'jev-v1',
  checkpoint: '',
  reason,
  ...overrides,
});

/**
 * Resolves a backend's qualification, failing closed.
 *
 * Pure, so the rule can be read and tested without a connection, a socket or a
 * GPU.
 */
export const resolveNpcActionQualification = (options: {
  readonly backend: ResolvedDecisionBackend;
  readonly supportedTaskId?: string;
  readonly supportedTaskVersion?: number;
  readonly supportedDialect?: string;
}): NpcActionQualification => {
  const { backend } = options;
  const supported: SupportedQualification = {
    supportedTaskId: options.supportedTaskId ?? NPC_ACTION_SELECTION_TASK_ID,
    supportedTaskVersion: options.supportedTaskVersion ?? NPC_ACTION_SELECTION_TASK_VERSION,
    supportedDialect: options.supportedDialect ?? 'jev-v1',
  };

  // The player's master switch narrows; it never widens.
  if (!backend.qualifiedForGameplay) {
    return refused('automatic gameplay routing is not enabled for this connection', {
      checkpoint: backend.checkpoint,
    });
  }

  const evidence = backend.qualification;
  if (evidence === undefined) {
    return refused(
      'this connection carries no recorded measurement; a player toggle is not a task qualification',
      { checkpoint: backend.checkpoint },
    );
  }

  const base = {
    taskId: evidence.taskId,
    taskVersion: evidence.taskVersion,
    dialect: evidence.dialect,
    checkpoint: evidence.checkpoint,
  };

  if (evidence.taskId !== supported.supportedTaskId) {
    return refused(
      `measured for task ${evidence.taskId}; this consumer routes ${supported.supportedTaskId}`,
      base,
    );
  }
  if (evidence.taskVersion !== supported.supportedTaskVersion) {
    return refused(
      `measured at task version ${evidence.taskVersion}; this consumer implements ${supported.supportedTaskVersion}`,
      base,
    );
  }
  if (evidence.dialect !== supported.supportedDialect) {
    return refused(
      `measured over dialect ${evidence.dialect}; this consumer speaks ${supported.supportedDialect}`,
      base,
    );
  }
  if (evidence.checkpoint !== backend.checkpoint) {
    return refused(
      `measured for checkpoint ${evidence.checkpoint}; this connection runs ${backend.checkpoint}`,
      base,
    );
  }

  return {
    qualified: true,
    ...base,
    reason: `held-out measurement${evidence.runId === undefined ? '' : ` (run ${evidence.runId})`}`,
  };
};
