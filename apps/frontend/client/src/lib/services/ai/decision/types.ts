// apps/frontend/client/src/lib/services/ai/decision/types.ts
//
// Domain types for the decision backend (issue #381).
//
// They live here rather than in the service module so the service keeps exactly
// two exported shapes — its options and its interface — and so a ViewModel can
// read the shape without importing a service instance it does not own.

import type { DecisionBackendState } from '@aikami/constants';
import type {
  DecisionAdapter,
  DecisionReadinessVerdict,
} from '@aikami/frontend/ai-gateway/decision';
import type { DecisionGameplayMode } from '@aikami/types';
import type { ResolvedDecisionBackend } from '../../config/decision_backend_resolution';

/** One task a configured backend could serve, and whether it may. */
export type DecisionTaskSummary = {
  readonly id: string;
  readonly label: string;
  /** What the task is, in one sentence a player can act on. */
  readonly description: string;
  /** Whether a real measurement has cleared this task's frozen gate. */
  readonly qualified: boolean;
};

/** Everything the settings section needs to describe the configured backend. */
export type DecisionBackendSummary = {
  /** Whether any decision connection is saved at all. */
  readonly configured: boolean;
  /** Whether the `decisions` role points at a usable connection. */
  readonly enabled: boolean;
  /**
   * The three states, never collapsed.
   *
   * `ready` proves the endpoint can answer; `qualified` additionally proves it
   * clears the frozen task gate on held-out data. Only the second permits
   * automatic routing, and nothing in this release sets it.
   */
  readonly state: DecisionBackendState;
  readonly runtimeLabel: string;
  /** Credential-free endpoint label, safe to render. */
  readonly endpointLabel: string;
  readonly checkpoint: string;
  /** Whether a credential is stored. The value is never surfaced. */
  readonly hasCredential: boolean;
  readonly tasks: readonly DecisionTaskSummary[];
};

/** Capability surface the production factory injects. */
export type DecisionBackendCapabilities = {
  /** Reads the configured decision backend. Defaults to the config service. */
  readonly resolveBackend: () => ResolvedDecisionBackend | undefined;
  /** Persists a configuration change. Defaults to the config service. */
  readonly persist: () => Promise<void>;
  /** Builds the adapter. Injected so tests never reach a socket. */
  readonly createAdapter: (backend: ResolvedDecisionBackend) => DecisionAdapter;
  /** Runs the real readiness + sample probe. Injected for tests. */
  readonly probe: (options: {
    adapter: DecisionAdapter;
    signal: AbortSignal;
    deadlineAt: number;
  }) => Promise<DecisionReadinessVerdict>;
};

/** Why automatic gameplay routing is or is not permitted. */
export type DecisionGameplayRouting = {
  readonly allowed: boolean;
  readonly reason: string;
};

/** What one "Test connection" produced. */
export type DecisionTestOutcome = {
  readonly verdict: DecisionReadinessVerdict;
  /** Ordered, credential-free setup steps derived from the verdict. */
  readonly steps: readonly { readonly id: string; readonly detail: string }[];
};

/** One selectable Off/Shadow/On row, with the reason it is or is not allowed. */
export type DecisionGameplayModeOption = {
  readonly mode: DecisionGameplayMode;
  /** Whether this row is the persisted choice right now. */
  readonly selected: boolean;
  /**
   * Whether selecting this mode would take effect.
   *
   * `false` for `on` when the backend is unqualified. The row is still shown —
   * hiding it would leave a player wondering where the option went — but it is
   * not selectable.
   */
  readonly allowed: boolean;
  /** Player-facing explanation. Never contains an endpoint or a credential. */
  readonly detail: string;
};
