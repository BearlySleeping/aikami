// apps/frontend/client/src/lib/services/game/npc_action_decision.ts
//
// Whether a turn's NPC action may come from a decision backend, and what the
// caller must do with the answer (issue #381, lane C).
//
// ---------------------------------------------------------------------------
// Split from the service on purpose
// ---------------------------------------------------------------------------
//
// Every decision that can go wrong here is a DECISION, not an effect: is this
// backend allowed to answer this task, is this result still current, is there
// budget left to fall back with. Keeping them as pure functions is what lets
// them be read and tested without a socket, a GPU or a running campaign.
//
// The effectful half — adapter construction, dispatch, telemetry — lives in
// `npc_action_decision_service.svelte.ts`.
//
// ---------------------------------------------------------------------------
// Qualification is pinned to four things, not one
// ---------------------------------------------------------------------------
//
// `qualified: true` on a backend answers "this endpoint answered a sample".
// It does not answer "this checkpoint is good at THIS task, at THIS task
// version, over THIS wire protocol". A checkpoint that was measured on
// `npc-command-kind` has said nothing about `npc-action-selection`, and a task
// version bump invalidates the measurement even when the literals are the same
// ones. All four must match or the existing LLM path answers.

import type { DecisionAdapter } from '@aikami/frontend-ai-gateway/decision';
import type { NpcDialogueCommand } from '@aikami/types';
import type { ResolvedDecisionBackend } from '../config/decision_backend_resolution.ts';
import type { NpcActionCandidateInput, NpcActionCandidateSet } from './npc_action_candidates.ts';

/**
 * How the player has configured this path.
 *
 * `off`    — the existing LLM path answers every turn. The default.
 * `shadow` — the decision backend is dispatched and scored, and its answer is
 *            DISCARDED. The turn behaves exactly as `off` does, but the
 *            comparison accumulates against real gameplay rather than against a
 *            fixture.
 * `on`     — an accepted decision supplies the turn's command.
 */
export type NpcActionDecisionMode = 'off' | 'shadow' | 'on';

/** The four things a qualification is pinned to. */
export type NpcActionQualification = {
  readonly qualified: boolean;
  readonly taskId: string;
  readonly taskVersion: number;
  /** Wire dialect, e.g. `jev-v1`. */
  readonly dialect: string;
  readonly checkpoint: string;
  /** Player-facing reason. Never contains an endpoint or a credential. */
  readonly reason: string;
};

/** Why a turn was not answered by a decision backend. */
export type NpcActionRouteRefusal =
  | 'mode-off'
  | 'not-configured'
  | 'not-qualified'
  | 'task-mismatch'
  | 'task-version-mismatch'
  | 'dialect-mismatch'
  | 'checkpoint-mismatch'
  | 'candidate-set-incomplete';

/** The routing decision for one turn. */
export type NpcActionRoute =
  | { readonly route: 'decision'; readonly reason: string }
  | { readonly route: 'llm'; readonly refusal: NpcActionRouteRefusal; readonly reason: string };

/**
 * The minimum remaining budget before a fallback is worth starting.
 *
 * Below this a second provider call cannot finish inside the turn, and starting
 * one would only spend latency the narrative already used. Mirrors
 * `DECISION_MINIMUM_BUDGET_MS` in the decision package.
 */
const NPC_ACTION_MIN_FALLBACK_BUDGET_MS = 250;

/**
 * Decides whether a decision backend may answer this turn.
 *
 * `shadow` is deliberately NOT a refusal: shadow dispatch is the whole point of
 * the mode, and it must not be gated on qualification the same way `on` is —
 * otherwise shadow could never accumulate the evidence that would qualify a
 * backend. What shadow is gated on is that a backend exists at all.
 */
export const resolveNpcActionRoute = (options: {
  readonly mode: NpcActionDecisionMode;
  readonly configured: boolean;
  readonly qualification: NpcActionQualification;
  /** The task this turn would ask. Pins the qualification to it. */
  readonly taskId: string;
  readonly candidates: NpcActionCandidateSet;
}): NpcActionRoute => {
  if (options.mode === 'off') {
    return { route: 'llm', refusal: 'mode-off', reason: 'the decision path is switched off' };
  }
  if (!options.configured) {
    return {
      route: 'llm',
      refusal: 'not-configured',
      reason: 'no decision backend is configured',
    };
  }

  // An incomplete candidate set is never routed, in ANY mode. Asking a backend
  // to choose from a world it is being shown as if it were the whole world
  // produces a confidently wrong answer that no downstream metric can see.
  if (!options.candidates.complete) {
    return {
      route: 'llm',
      refusal: 'candidate-set-incomplete',
      reason: 'the enumerated candidate set was bounded and is incomplete',
    };
  }

  if (options.mode === 'shadow') {
    return {
      route: 'decision',
      reason: 'shadow: the answer is measured and discarded',
    };
  }

  const { qualification } = options;
  if (!qualification.qualified) {
    return {
      route: 'llm',
      refusal: 'not-qualified',
      reason: qualification.reason || 'no measurement has qualified this backend',
    };
  }
  if (qualification.taskId !== options.taskId) {
    return {
      route: 'llm',
      refusal: 'task-mismatch',
      reason: `qualified for ${qualification.taskId}, this turn asks ${options.taskId}`,
    };
  }
  return { route: 'decision', reason: 'qualified for this task, version and checkpoint' };
};

/**
 * Everything a late result is checked against.
 *
 * A decision backend is a second inference with its own queue and its own load
 * time, so it can finish after the turn it belonged to. Applying it then would
 * act on a conversation the player has already moved on from, in a campaign
 * they may have left.
 */
export type NpcActionStaleness = {
  readonly campaignId: string;
  readonly conversationId: string;
  /** Monotonic per-turn counter; the service bumps it at dispatch. */
  readonly turnSequence: number;
  /** The revision the candidate set was enumerated from. */
  readonly stateRevision: number;
};

/**
 * Whether a result belongs to the turn that is still current.
 *
 * All four are checked. The turn sequence alone would miss a campaign switch;
 * the campaign id alone would miss a player who started a new exchange with the
 * same NPC.
 */
export const isStaleNpcActionResult = (
  dispatched: NpcActionStaleness,
  current: NpcActionStaleness,
): boolean =>
  dispatched.campaignId !== current.campaignId ||
  dispatched.conversationId !== current.conversationId ||
  dispatched.turnSequence !== current.turnSequence ||
  dispatched.stateRevision !== current.stateRevision;

/**
 * Whether there is budget left to run the existing LLM path.
 *
 * `deadlineAt` is the turn's ONE absolute deadline, shared by the decision
 * dispatch and the fallback. It is never restarted, so "budget left" is a
 * single comparison rather than two timers that can disagree.
 */
export const hasFallbackBudget = (options: {
  readonly deadlineAt: number;
  readonly now: number;
}): boolean => options.deadlineAt - options.now >= NPC_ACTION_MIN_FALLBACK_BUDGET_MS;

/** What one attempt did, for telemetry. */
export type NpcActionAttempt = {
  /** `decision` or `llm`. Never anything else: there are exactly two producers. */
  readonly source: 'decision' | 'llm';
  readonly outcome: 'accepted' | 'abstained' | 'rejected' | 'not-run';
  /** Absent when the source had no comparable latency to report. */
  readonly ms?: number;
  /** Provider attempts, as reported by the gateway. Never invented locally. */
  readonly providerAttempts?: number;
  readonly reason?: string;
};

/**
 * What one turn's action resolution produced.
 *
 * `command` is the ONLY thing the caller acts on. It has already been through
 * the candidate enumeration, and the caller is still expected to run
 * `_validateCommandPreconditions` over it — this type does not vouch for it.
 */
export type NpcActionResolution = {
  /** What the turn should use, or undefined to take no state-changing action. */
  readonly command: NpcDialogueCommand | undefined;
  /** The literal the decision backend returned, when it was asked and answered. */
  readonly actionId?: string;
  /** Which path supplied it. */
  readonly source: 'decision' | 'llm' | 'none';
  /** Every attempt, in order. Costs are attributed exactly once per source. */
  readonly attempts: readonly NpcActionAttempt[];
};

/** Capabilities injected so no test reaches a socket. */
export type NpcActionDecisionCapabilities = {
  readonly resolveBackend: () => ResolvedDecisionBackend | undefined;
  readonly createAdapter: (backend: ResolvedDecisionBackend) => DecisionAdapter;
  readonly readQualification: (backend: ResolvedDecisionBackend) => NpcActionQualification;
};

/** What one turn passes in. */
export type NpcActionDecisionRequest = {
  readonly input: NpcActionCandidateInput;
  /** The turn's ONE absolute deadline. Shared, never restarted. */
  readonly deadlineAt: number;
  readonly staleness: NpcActionStaleness;
  /** Re-read at resolution time to detect a turn that moved on. */
  readonly currentStaleness: () => NpcActionStaleness;
  readonly signal: AbortSignal;
  /** The exchange the backend reads. */
  readonly context: string;
  readonly language?: string;
};
