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

/** Inputs to the state projection. */
export type DeriveDecisionBackendStateOptions = {
  readonly configured: boolean;
  readonly enabled: boolean;
  /** The last explicit test result, or undefined when none has been run. */
  readonly verdict?: DecisionReadinessVerdict;
  /** Whether a measurement has cleared the workload gate for this checkpoint. */
  readonly workloadQualified: boolean;
};

/**
 * Projects configuration plus the last test into one of three states.
 *
 * A backend is `qualified` ONLY when it is enabled, the last test reached
 * `ready`, and a measurement has cleared the workload gate. Any missing leg
 * yields `ready` or `disabled` — there is no path from "configured" to
 * "qualified" that skips an actual answer.
 */
export const deriveDecisionBackendState = (
  options: DeriveDecisionBackendStateOptions,
): DecisionBackendState => {
  if (!options.configured || !options.enabled) {
    return 'disabled';
  }
  if (options.verdict?.state !== 'ready') {
    return 'disabled';
  }
  return options.workloadQualified ? 'qualified' : 'ready';
};

/**
 * The automatic-gameplay gate.
 *
 * It exists as a function so the refusal is a DECISION the code makes rather
 * than an absence of code. In this release it refuses unconditionally, and the
 * reason says why: the frozen gate has not been run against a qualified backend
 * by a shipped measurement. A future consumer must be able to flip it by
 * satisfying all three legs, and none of them are reachable from a settings
 * selection.
 */
export const decisionGameplayRouting = (options: {
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly state: DecisionBackendState;
  readonly workloadQualified: boolean;
}): DecisionGameplayRouting => {
  if (!options.configured || !options.enabled) {
    return { allowed: false, reason: 'no decision backend is enabled' };
  }
  if (options.state !== 'qualified') {
    return {
      allowed: false,
      reason: `the backend is ${options.state}, not qualified; a sample decision is not a task qualification`,
    };
  }
  if (!options.workloadQualified) {
    return {
      allowed: false,
      reason: 'the frozen task gate has not been cleared on held-out data for this checkpoint',
    };
  }
  return {
    allowed: false,
    reason:
      'automatic gameplay routing ships disabled in this release; the workload pilot has not landed',
  };
};

/** The tasks a decision backend could serve today. */
export const decisionTaskSummaries = (
  workloadQualified: boolean,
): readonly DecisionTaskSummary[] => [
  {
    id: 'npc-command-kind',
    label: 'NPC command kind (research probe)',
    description:
      'Chooses which bounded dialogue command, if any, a player message warrants. Measures the discriminator only — not the payloads, IDs or world preconditions production commands carry.',
    qualified: workloadQualified,
  },
];

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
