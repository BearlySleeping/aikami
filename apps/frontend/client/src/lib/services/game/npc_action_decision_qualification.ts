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
  /**
   * Dialects this consumer has a MEASURED qualification for.
   *
   * A set, not a single string, because more than one runtime can serve this
   * task over more than one dialect — native llama.cpp
   * (`typesafe-systemone-v1`) is a genuinely different wire contract from
   * `jev-v1`, and a measurement taken over one says nothing about the other.
   *
   * Membership is earned by measurement, never by declaring a backend's
   * runtime here: adding a dialect to this set asserts that some held-out run
   * cleared the frozen gates over it. An unmeasured dialect stays absent and the
   * gate refuses with a named reason.
   */
  readonly supportedDialects: readonly string[];
  /**
   * Every dialect this consumer can even parse, used to tell a player their
   * backend is fine but unmeasured, rather than simply wrong.
   */
  readonly knownDialects: readonly string[];
};

/** Dialects a measured qualification has been issued for. */
const QUALIFIED_DIALECTS: readonly string[] = ['jev-v1'];

/** Dialects the consumer understands, measured or not. */
const KNOWN_DIALECTS: readonly string[] = ['jev-v1', 'typesafe-systemone-v1'];

const refused = (
  reason: string,
  overrides: Partial<NpcActionQualification> = {},
): NpcActionQualification => ({
  qualified: false,
  taskId: NPC_ACTION_SELECTION_TASK_ID,
  taskVersion: NPC_ACTION_SELECTION_TASK_VERSION,
  dialect: QUALIFIED_DIALECTS[0] ?? 'jev-v1',
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
/** One named mismatch, or undefined when every identity leg matches. */
type Mismatch = { readonly reason: string } | undefined;

/** Checks the two DIALECT conditions, which are independent and both required. */
const checkDialect = (options: {
  readonly evidenceDialect: string;
  readonly backendDialect: string;
  readonly supportedDialects: readonly string[];
  readonly knownDialects: readonly string[];
}): Mismatch => {
  const { evidenceDialect, backendDialect, supportedDialects, knownDialects } = options;
  // (1) The measurement must be over the dialect THIS CONNECTION speaks.
  //
  // Checking only set membership is not enough: that set holds every dialect
  // that has ever cleared a gate, so a `jev-v1` measurement satisfied it for a
  // native llama.cpp connection and qualified a backend over a wire it never
  // used. Comparing against the backend's own dialect makes the two conditions
  // independent.
  if (evidenceDialect !== backendDialect) {
    return {
      reason: knownDialects.includes(evidenceDialect)
        ? `measured over dialect ${evidenceDialect}; this connection speaks ${backendDialect}`
        : `measured over dialect ${evidenceDialect}, which this consumer does not speak; ` +
          `this connection speaks ${backendDialect}`,
    };
  }
  // (2) Right dialect, but no gate has been cleared for it. Naming the qualified
  // set makes the refusal actionable rather than merely negative.
  if (!supportedDialects.includes(evidenceDialect)) {
    return {
      reason:
        `measured over dialect ${evidenceDialect}, which has no cleared gate for this task ` +
        `(qualified: ${supportedDialects.join(', ') || 'none'})`,
    };
  }
  return undefined;
};

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
  /** Additional dialects beyond {@link QUALIFIED_DIALECTS}, for tests. */
  readonly supportedDialects?: readonly string[];
  readonly knownDialects?: readonly string[];
  /**
   * The dialect the BACKEND actually speaks, from its adapter.
   *
   * Taken from the backend rather than assumed, because assuming it is exactly
   * how a native llama.cpp connection came to be checked against `jev-v1` and
   * refused for a dialect it never claimed to speak.
   */
  readonly backendDialect?: string;
}): NpcActionQualification => {
  const { backend } = options;
  const supportedTaskId = options.supportedTaskId ?? NPC_ACTION_SELECTION_TASK_ID;
  const supportedTaskVersion = options.supportedTaskVersion ?? NPC_ACTION_SELECTION_TASK_VERSION;
  const supportedDialects = options.supportedDialects ?? QUALIFIED_DIALECTS;
  const knownDialects = options.knownDialects ?? KNOWN_DIALECTS;
  const backendDialect =
    options.backendDialect ?? (backend.runtime === 'llamacpp' ? 'typesafe-systemone-v1' : 'jev-v1');

  // The player's master switch narrows; it never widens.
  if (!backend.qualifiedForGameplay) {
    return refused('automatic gameplay routing is not enabled for this connection', {
      checkpoint: backend.checkpoint,
      dialect: backendDialect,
    });
  }

  const evidence = backend.qualification;
  if (evidence === undefined) {
    return refused(
      'this connection carries no recorded measurement; a player toggle is not a task qualification',
      { checkpoint: backend.checkpoint, dialect: backendDialect },
    );
  }

  const base = {
    taskId: evidence.taskId,
    taskVersion: evidence.taskVersion,
    dialect: evidence.dialect,
    checkpoint: evidence.checkpoint,
  };
  // Each identity leg is its own named check, evaluated in order and stopping
  // at the first mismatch. A branch ladder is both harder to read and harder to
  // extend when a fifth leg arrives.
  const legs: readonly (() => Mismatch)[] = [
    () =>
      evidence.taskId === supportedTaskId
        ? undefined
        : {
            reason: `measured for task ${evidence.taskId}; this consumer routes ${supportedTaskId}`,
          },
    () =>
      evidence.taskVersion === supportedTaskVersion
        ? undefined
        : {
            reason:
              `measured at task version ${evidence.taskVersion}; this consumer implements ` +
              `${supportedTaskVersion}`,
          },
    () =>
      checkDialect({
        evidenceDialect: evidence.dialect,
        backendDialect,
        supportedDialects,
        knownDialects,
      }),
    () =>
      evidence.checkpoint === backend.checkpoint
        ? undefined
        : {
            reason:
              `measured for checkpoint ${evidence.checkpoint}; this connection runs ` +
              `${backend.checkpoint}`,
          },
  ];
  const mismatch = legs.map((leg) => leg()).find((result) => result !== undefined);

  if (mismatch !== undefined) {
    return refused(mismatch.reason, base);
  }
  return {
    qualified: true,
    ...base,
    reason: `held-out measurement${evidence.runId === undefined ? '' : ` (run ${evidence.runId})`}`,
  };
};
