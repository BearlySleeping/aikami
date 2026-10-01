// packages/frontend/ai-gateway/src/lib/decision/adapters/types.ts
//
// The adapter seam (issue #381, contract C-566).
//
// An adapter turns a dispatchable unit into answers. It knows nothing about
// routing, retries, deadlines or fallback — those belong to the runner, which
// is the only place that may decide to stop, retry or fall back.

import type { DecisionCapability, DecisionDispatchUnit, DecisionPlan } from '../types.ts';

/** One decision request, fully bound to an absolute deadline. */
export type DecisionRequest = {
  /** Compiled plan the unit was built from. */
  readonly plan: DecisionPlan;
  /** The unit to answer. */
  readonly unit: DecisionDispatchUnit;
  /**
   * Absolute deadline for the whole logical request, in epoch milliseconds.
   *
   * Absolute and shared, never restarted: routing, queueing, model load and
   * retry all draw from it. A cold backend that misses it must report
   * `deadline-exceeded`, not quietly consume a budget the caller still needed.
   */
  readonly deadlineAt: number;
  /** Cancellation. Aborting must settle the call, not orphan the work. */
  readonly signal: AbortSignal;
  /** Caller identity, carried through to provenance. */
  readonly requestId: string;
  /**
   * State revision the decision was made against.
   *
   * A result computed on a stale revision is discarded by the caller, never
   * applied late. This is the mechanism that keeps a slow backend from
   * overwriting newer game state.
   */
  readonly stateRevision: number;
};

/** What an adapter returns. */
export type DecisionAdapterResponse =
  | {
      readonly ok: true;
      /** Answers keyed by plan question key. */
      readonly answers: import('../types.ts').DecisionAnswer[];
      /** Milliseconds spent resident in the backend. */
      readonly inferenceMs: number;
      /** Milliseconds spent waiting for the backend. */
      readonly queueMs: number;
      /** Verified identity of what answered, when the backend can report it. */
      readonly checkpoint?: string;
      readonly runtime?: string;
      readonly resourceId?: string;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'backend-unavailable'
        | 'invalid-response'
        | 'deadline-exceeded'
        | 'cancelled'
        | 'unauthorized';
      readonly detail: string;
      readonly queueMs: number;
      readonly inferenceMs: number;
    };

/** A decision backend. */
export type DecisionAdapter = {
  /** Backend identity, stable across runs. */
  readonly backendId: string;
  /** Wire dialect, when the backend speaks one. */
  readonly dialect: string;
  /**
   * Reports what the backend can actually do right now.
   *
   * Must reflect a real check. A listening socket is not readiness, and a
   * dialect that parses is not a checkpoint that has answered.
   */
  capability(options?: Pick<DecisionRequest, 'deadlineAt' | 'signal'>): Promise<DecisionCapability>;
  /** Answers one unit. Must honour `deadlineAt` and `signal`. */
  run(request: DecisionRequest): Promise<DecisionAdapterResponse>;
};
