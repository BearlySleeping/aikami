// packages/frontend/ai-gateway/src/lib/decision/preference.ts
//
// The experimental decision preference (issue #381, contract C-567).
//
// 🔴 THIS PREFERENCE IS DISABLED AND STAYS DISABLED.
//
// It exists so that the *shape* of the decision route is reviewable before
// anything is routed. Nothing in the shipping game reads it: there is no call
// site that asks for a decision, so there is nothing for it to change. It is a
// declared value with an explicit `enabled: false`, not an absence — the point
// is that "off" is a decision someone made and can be reviewed, rather than a
// feature that simply has not been wired yet.
//
// The resolution order below is the part worth reviewing. It is policy-first,
// and every "automatic" step is subordinate to an explicit user choice:
//
//   1. opt-in             — preference disabled, or task not listed: refuse
//   2. explicit override  — the user pinned a model/connection
//   3. disabled role      — an explicitly disabled role is never re-enabled
//                           merely because a ready backend exists
//   4. cost/privacy mode  — cloud refused unless explicitly allowed
//   5. hard limits        — language, context, option and budget bounds
//   6. readiness          — only now may a backend's readiness matter
//
// Order is the whole design. A ready backend at step 6 can never override steps
// 1–5, which is what "prefer an already enabled and ready backend" is allowed
// to mean and no more.

import type { DecisionReadinessVerdict } from './readiness.ts';

/** The declared preference. Disabled, local-only, and naming no tasks. */
export type DecisionExperimentalPreference = {
  /** Master switch. Ships `false`. */
  readonly enabled: boolean;
  /** Tasks that have opted in by name. Ships empty. */
  readonly tasks: readonly string[];
  /** Whether a cloud decision backend may ever be selected. Ships `false`. */
  readonly allowCloud: boolean;
  /** Optional ceiling on assembled context, in bytes. */
  readonly maxContextBytes?: number;
};

/**
 * The shipped preference.
 *
 * Deliberately the most conservative possible value. It is not a placeholder:
 * flipping `enabled` without filling `tasks` still refuses every task, because
 * opt-in is per task and never global. There is no "all enum schemas route to
 * the decision model" switch, and no provider-compatibility business flag.
 */
export const DECISION_EXPERIMENTAL_PREFERENCE: DecisionExperimentalPreference = {
  enabled: false,
  tasks: [],
  allowCloud: false,
};

/** Why the decision route is or is not selected. */
export type DecisionRouteDecision =
  | {
      /** A backend was selected. */
      readonly ok: true;
      readonly backendId: string;
      readonly checkpoint?: string;
      readonly runtime?: string;
    }
  | {
      readonly ok: false;
      /** Stable machine-readable cause. */
      readonly code: DecisionRouteRefusalCode;
      /** Credential-free, human-readable explanation. */
      readonly detail: string;
    };

/** Machine-readable refusal causes, in resolution order. */
export type DecisionRouteRefusalCode =
  | 'preference-disabled'
  | 'task-not-opted-in'
  | 'role-explicitly-disabled'
  | 'cloud-not-permitted'
  | 'context-limit-exceeded'
  | 'budget-exceeded'
  | 'backend-not-ready'
  | 'no-backend';

/** Inputs to route resolution. All of them are explicit; none are inferred. */
export type ResolveDecisionPreferenceOptions = {
  readonly preference: DecisionExperimentalPreference;
  /** Task asking for a decision. */
  readonly task: string;
  /** Whether the caller pinned a backend explicitly. Never inferred. */
  readonly explicitBackendId?: string;
  /** True when the user explicitly disabled this role in settings. */
  readonly roleDisabled?: boolean;
  /** Where the candidate backend runs. */
  readonly backendKind: 'local' | 'cloud';
  /** Backend readiness, already proven. */
  readonly readiness: DecisionReadinessVerdict;
  /** Context size this call would send, in bytes. */
  readonly contextBytes: number;
  /** Milliseconds left before the interaction's deadline. */
  readonly remainingBudgetMs: number;
  /** Minimum budget a backend must be able to fit inside to be worth starting. */
  readonly minimumBudgetMs?: number;
};

/** Milliseconds a backend must plausibly fit into to be worth dispatching to. */
export const DECISION_MINIMUM_BUDGET_MS = 250;

/**
 * Resolves whether the decision route may be used for one call.
 *
 * Pure: no clock, no I/O, no defaults beyond the two named constants. Callers
 * own the deadline and the adapter choice; this decides only eligibility.
 */
export const resolveDecisionPreference = (
  options: ResolveDecisionPreferenceOptions,
): DecisionRouteDecision => {
  // 1. opt-in, before anything else looks at the backend.
  if (!options.preference.enabled) {
    return {
      ok: false,
      code: 'preference-disabled',
      detail: 'the experimental decision preference is disabled',
    };
  }
  if (!options.preference.tasks.includes(options.task)) {
    return {
      ok: false,
      code: 'task-not-opted-in',
      detail: `task ${options.task} has not opted in to decision inference`,
    };
  }

  // 2. An explicit override is honoured even for a role the user disabled —
  //    pinning a backend is a more specific statement than a blanket disable.
  //    It is still subject to steps 4–6: an explicit pick is not a licence to
  //    spend, truncate or overrun.
  if (options.explicitBackendId !== undefined) {
    if (options.backendKind === 'cloud' && !options.preference.allowCloud) {
      return {
        ok: false,
        code: 'cloud-not-permitted',
        detail: 'cloud decision backends are not permitted by this preference',
      };
    }
    return checkedBounds(options) ?? checkedReadiness(options, options.explicitBackendId);
  }

  // 3. An explicitly disabled role is never re-enabled by preference.
  if (options.roleDisabled === true) {
    return {
      ok: false,
      code: 'role-explicitly-disabled',
      detail: 'this role is explicitly disabled and automatic preference does not re-enable it',
    };
  }

  // 4. Privacy and cost policy.
  if (options.backendKind === 'cloud' && !options.preference.allowCloud) {
    return {
      ok: false,
      code: 'cloud-not-permitted',
      detail: 'cloud decision backends are not permitted by this preference',
    };
  }

  return (
    checkedBounds(options) ?? checkedReadiness(options, options.readiness.capability?.backendId)
  );
};

/** Bounds apply to explicit pins and automatic selection alike. */
const checkedBounds = (
  options: ResolveDecisionPreferenceOptions,
): DecisionRouteDecision | undefined => {
  const ceiling = options.preference.maxContextBytes;
  if (ceiling !== undefined && options.contextBytes > ceiling) {
    return {
      ok: false,
      code: 'context-limit-exceeded',
      detail: `context is ${options.contextBytes} bytes; the preference allows ${ceiling}`,
    };
  }
  const minimum = options.minimumBudgetMs ?? DECISION_MINIMUM_BUDGET_MS;
  if (options.remainingBudgetMs < minimum) {
    return {
      ok: false,
      code: 'budget-exceeded',
      detail: `only ${options.remainingBudgetMs} ms remain; a decision backend needs at least ${minimum} ms`,
    };
  }

  return undefined;
};

/**
 * Step 6. Readiness is the LAST gate, never the first.
 *
 * This ordering is the guarantee: a backend cannot buy its way into the route
 * by being ready when policy said no.
 */
const checkedReadiness = (
  options: ResolveDecisionPreferenceOptions,
  backendId: string | undefined,
): DecisionRouteDecision => {
  if (options.readiness.state !== 'ready') {
    return {
      ok: false,
      code: backendId === undefined ? 'no-backend' : 'backend-not-ready',
      detail: options.readiness.reason,
    };
  }
  if (
    options.explicitBackendId !== undefined &&
    options.readiness.capability?.backendId !== options.explicitBackendId
  ) {
    return {
      ok: false,
      code: 'backend-not-ready',
      detail: 'readiness does not belong to the pinned backend',
    };
  }
  if (backendId === undefined) {
    return { ok: false, code: 'no-backend', detail: 'no decision backend is configured' };
  }
  return {
    ok: true,
    backendId,
    ...(options.readiness.observed?.checkpoint === undefined
      ? {}
      : { checkpoint: options.readiness.observed.checkpoint }),
    ...(options.readiness.observed?.runtime === undefined
      ? {}
      : { runtime: options.readiness.observed.runtime }),
  };
};
