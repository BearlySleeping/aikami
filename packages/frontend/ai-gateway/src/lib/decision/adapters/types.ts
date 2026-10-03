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

/**
 * Facts an adapter can attach to any outcome, without widening the result type
 * per provider.
 *
 * Deliberately a closed, provider-neutral shape. A native `llamacpp` adapter
 * reports token usage (including the always-zero `output_tokens` that a
 * decision call legitimately produces) and the checkpoint's own limit
 * violations; a `jev` adapter reports neither today, and neither is forced to.
 * What an adapter CANNOT do is invent a new field per dialect — that is how a
 * telemetry path ends up understanding two unrelated result shapes.
 */
export type DecisionAdapterDiagnostics = {
  /** Raw usage exactly as the backend reported it. Never estimated. */
  readonly usage?: {
    // biome-ignore lint/style/useNamingConvention: verbatim wire field name
    readonly input_tokens?: number;
    // biome-ignore lint/style/useNamingConvention: verbatim wire field name
    readonly output_tokens?: number;
  };
  /** Checkpoint the backend says actually answered, when it names one. */
  readonly servedCheckpoint?: string;
  /** The loaded checkpoint's own structural limits that stopped this dispatch. */
  readonly limitViolations?: readonly {
    readonly code: 'option-limit-exceeded' | 'question-limit-exceeded';
    readonly questionKey?: string;
    readonly detail: string;
  }[];
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
      readonly diagnostics?: DecisionAdapterDiagnostics;
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
      readonly diagnostics?: DecisionAdapterDiagnostics;
    };

/**
 * Runtime evidence about whether a checkpoint is currently RESIDENT.
 *
 * Why this exists (issue #381, lane C): "cold" and "warm" were originally
 * inferred from a case's POSITION in a dispatch sequence — the first few cases
 * were labelled cold because they ran first. That is an assumption about
 * ordering dressed up as a measurement. It is wrong the moment a runtime
 * pre-loads, evicts under memory pressure, or keeps a model warm across the
 * whole run, and none of those are visible from the request index.
 *
 * Residency is a property of the RUNTIME, so only the runtime can report it.
 * An adapter that cannot report it says so, and a condition that cannot be
 * verified is not a condition — see {@link DecisionAdapter.residency}.
 */
export type ResidencyEvidence = {
  /**
   * Whether this observation is trustworthy at all.
   *
   * `false` means the runtime offers no way to ask. A harness that treats an
   * unverifiable condition as satisfied will report a warm percentile it never
   * established, which is the failure this type exists to prevent.
   */
  readonly verified: boolean;
  /** Only meaningful when `verified`. */
  readonly resident?: boolean;
  /** How the runtime reported it, e.g. `ollama:/api/ps`. */
  readonly method: string;
  /** Credential-free, machine-readable. Never contains an endpoint with userinfo. */
  readonly detail: string;
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
  /**
   * Reports, from the runtime, whether the checkpoint is resident RIGHT NOW.
   *
   * Optional because not every runtime can answer. A missing implementation, or
   * one that returns `verified: false`, means the caller has no basis for
   * labelling a measurement cold or warm and must treat latency conditions as
   * unestablished.
   *
   * This MUST be a cheap local query. It is called per dispatch to observe the
   * state at that moment, and it is not a readiness probe.
   */
  residency?(options?: Pick<DecisionRequest, 'signal'>): Promise<ResidencyEvidence>;
  /** Answers one unit. Must honour `deadlineAt` and `signal`. */
  run(request: DecisionRequest): Promise<DecisionAdapterResponse>;
};
