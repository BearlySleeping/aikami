// packages/frontend/ai-gateway/src/lib/decision/diagnostics.ts
//
// Effective-route diagnostics for a task (issue #381, contract C-567).
//
// #381 asks that "advanced settings show effective routing and why a task is
// incompatible". This is that answer as a pure function over C-566's frozen
// API, so a settings panel, a CLI and a bug report can all render the same
// truth instead of each re-deriving it.
//
// Two properties this file guarantees:
//
//   - It explains, it does not decide. Every verdict it prints is traceable to
//     a compiler reason, a policy reason or a probe verdict, so a user who
//     disagrees with the answer can see which of the three produced it.
//   - It never leaks. Output carries schemas, codes and versions — never
//     credentials, endpoints with userinfo, model output or player content.
//
// It is also the reason this lane needed no wizard: the composable piece is the
// report, and the UI is a thin renderer over it.

import type { DecisionAdapter } from './adapters/types.ts';
import { analyzeDecisionSchema } from './analyzer.ts';
import { buildDecisionDispatch } from './dispatch.ts';
import { bindDecisionPolicy } from './policy.ts';
import {
  DECISION_EXPERIMENTAL_PREFERENCE,
  type DecisionExperimentalPreference,
  resolveDecisionPreference,
} from './preference.ts';
import { PROBE_SCHEMA } from './probe_case.ts';
import {
  type DecisionReadinessVerdict,
  describeDecisionReadiness,
  probeDecisionBackend,
} from './readiness.ts';
import type {
  DecisionCapability,
  DecisionIncompatibility,
  DecisionLimits,
  DecisionPlan,
  DecisionTaskPolicy,
} from './types.ts';
import { utf8ByteLength } from './util.ts';

/** Which stage produced a verdict, so the reader knows what to trust. */
export type DecisionDiagnosticStage =
  /** The schema could not be compiled at all. */
  | 'schema'
  /** The schema compiled; the task policy refused it. */
  | 'policy'
  /** Compiled and bound; the context does not fit the declared bounds. */
  | 'bounds'
  /** Route preference refused before any backend probe. */
  | 'preference'
  /** Eligible in principle; backend readiness decided the outcome. */
  | 'readiness'
  /** Eligible and ready. */
  | 'eligible';

/** A full, credential-free readiness/route report for one task. */
export type DecisionDiagnostics = {
  readonly task: string;
  readonly stage: DecisionDiagnosticStage;
  /** True only when this task would actually use a decision backend now. */
  readonly eligible: boolean;
  /** Compiler rejections addressed by property path. */
  readonly schemaReasons: readonly DecisionIncompatibility[];
  /** Effective backend, when one was selected. */
  readonly backendId?: string;
  /** The checkpoint that actually answered, not the one that was configured. */
  readonly checkpoint?: string;
  /** Runtime identity, e.g. `ollama 0.35.0`. */
  readonly runtime?: string;
  /** What the capability reports about the selected backend. */
  readonly capability?: DecisionCapability;
  /** Why the decision route was refused, machine-readable. */
  readonly refusalCode?: string;
  /** One-line, credential-free explanation. */
  readonly summary: string;
  /** Ordered, actionable setup guidance. Empty when eligible. */
  readonly setupSteps: readonly { readonly id: string; readonly detail: string }[];
};

/** Diagnostics options. */
export type BuildDecisionDiagnosticsOptions = {
  /** Task asking. */
  readonly task: string;
  /** The caller's real schema and policy. */
  readonly schema: unknown;
  readonly policy: DecisionTaskPolicy;
  /** Context this call would send, for the bounds check. */
  readonly context?: string;
  readonly limits?: Partial<DecisionLimits>;
  readonly preference?: DecisionExperimentalPreference;
  readonly backendKind?: 'local' | 'cloud';
  /** A backend to probe. Omit to report eligibility without a backend. */
  readonly adapter?: DecisionAdapter;
  /** Context bytes, when the caller already knows them. */
  readonly contextBytes?: number;
  readonly remainingBudgetMs?: number;
  readonly roleDisabled?: boolean;
  readonly explicitBackendId?: string;
  readonly deadlineAt?: number;
  readonly signal?: AbortSignal;
  readonly requestId?: string;
  readonly stateRevision?: number;
};

/** How each stage refuses, so every branch builds the same shape. */
const refusal = (
  task: string,
  stage: DecisionDiagnosticStage,
  summary: string,
  schemaReasons: readonly DecisionIncompatibility[] = [],
): DecisionDiagnostics => ({
  task,
  stage,
  eligible: false,
  schemaReasons,
  summary,
  setupSteps: [],
});

/** Formats compiler/policy rejections by code and property path. */
const formatReasons = (reasons: readonly DecisionIncompatibility[]): string =>
  reasons.map((reason) => `${reason.code} at ${reason.path.join('.') || '<root>'}`).join('; ');

/**
 * Compiles and binds the task's real schema.
 *
 * Returns either a refusal or the bound plan, so the caller has one branch
 * instead of four and the stages stay independently readable.
 */
const bindTask = (
  options: BuildDecisionDiagnosticsOptions,
): { ok: true; plan: DecisionPlan } | { ok: false; diagnostics: DecisionDiagnostics } => {
  const analysis = analyzeDecisionSchema({ schema: options.schema, limits: options.limits });
  if (!analysis.ok) {
    return {
      ok: false,
      diagnostics: refusal(
        options.task,
        'schema',
        `schema is not decision-compatible: ${formatReasons(analysis.reasons)}`,
        analysis.reasons,
      ),
    };
  }
  const binding = bindDecisionPolicy({ plan: analysis.plan, policy: options.policy });
  if (!binding.ok) {
    return {
      ok: false,
      diagnostics: refusal(
        options.task,
        'policy',
        `task policy refused this schema: ${formatReasons(binding.reasons)}`,
        binding.reasons,
      ),
    };
  }
  return { ok: true, plan: binding.plan };
};

/** Shared resolution call, so both readiness branches resolve identically. */
const resolveRoute = (
  options: BuildDecisionDiagnosticsOptions,
  preference: DecisionExperimentalPreference,
  contextBytes: number,
  readiness: DecisionReadinessVerdict,
): ReturnType<typeof resolveDecisionPreference> =>
  resolveDecisionPreference({
    preference,
    task: options.task,
    backendKind: options.backendKind ?? 'local',
    readiness,
    contextBytes,
    remainingBudgetMs: options.remainingBudgetMs ?? Number.MAX_SAFE_INTEGER,
    roleDisabled: options.roleDisabled,
    explicitBackendId: options.explicitBackendId,
  });

/** Reports eligibility when nothing is configured to serve a decision. */
const reportNoBackend = (
  options: BuildDecisionDiagnosticsOptions,
  preference: DecisionExperimentalPreference,
  contextBytes: number,
): DecisionDiagnostics => {
  const route = resolveRoute(options, preference, contextBytes, {
    state: 'unreachable',
    reason: 'no decision backend is configured',
  });
  if (route.ok) {
    throw new Error('an absent backend cannot resolve a route');
  }
  const isReadiness = route.code === 'no-backend' || route.code === 'backend-not-ready';
  return {
    ...refusal(
      options.task,
      isReadiness ? 'readiness' : 'preference',
      `decision route refused (${route.code}): ${route.detail}`,
    ),
    refusalCode: route.code,
    setupSteps: [
      {
        id: isReadiness ? 'decision.setup.noBackend' : `decision.preference.${route.code}`,
        detail: route.detail,
      },
    ],
  };
};

/** Probes the backend and reports the effective route, or why there is none. */
const reportWithBackend = async (
  options: BuildDecisionDiagnosticsOptions,
  preference: DecisionExperimentalPreference,
  contextBytes: number,
  adapter: DecisionAdapter,
): Promise<DecisionDiagnostics> => {
  const preliminary = reportNoBackend(options, preference, contextBytes);
  if (preliminary.stage === 'preference') {
    return preliminary;
  }
  const verdict = await probeDecisionBackend({
    adapter,
    deadlineAt: options.deadlineAt ?? Date.now() + 10_000,
    signal: options.signal ?? new AbortController().signal,
    requestId: options.requestId ?? 'diagnostics',
    stateRevision: options.stateRevision ?? 0,
    // The probe case is the synthetic one: a readiness report must never
    // forward the caller's real context to a backend it is only inspecting.
    probe: { schema: PROBE_SCHEMA },
  });

  const route = resolveRoute(options, preference, contextBytes, verdict);
  if (!route.ok) {
    return {
      ...refusal(
        options.task,
        'readiness',
        `decision route refused (${route.code}): ${route.detail}`,
      ),
      capability: verdict.capability,
      refusalCode: route.code,
      setupSteps: (verdict.state === 'ready'
        ? [{ id: `decision.preference.${route.code}`, detail: route.detail }]
        : describeDecisionReadiness(verdict)
      ).map((step) => ({
        id: step.id,
        detail: step.detail,
      })),
    };
  }

  return {
    task: options.task,
    stage: 'eligible',
    eligible: true,
    schemaReasons: [],
    backendId: route.backendId,
    checkpoint: route.checkpoint,
    runtime: route.runtime,
    capability: verdict.capability,
    summary:
      `route: ${route.backendId}` +
      (route.checkpoint === undefined ? '' : ` (checkpoint ${route.checkpoint})`) +
      (route.runtime === undefined ? '' : `, runtime ${route.runtime}`),
    setupSteps: [],
  };
};

/** Builds the readiness/route report for one task. */
export const buildDecisionDiagnostics = async (
  options: BuildDecisionDiagnosticsOptions,
): Promise<DecisionDiagnostics> => {
  const preference = options.preference ?? DECISION_EXPERIMENTAL_PREFERENCE;
  const bound = bindTask(options);
  if (!bound.ok) {
    return bound.diagnostics;
  }

  const context = options.context ?? '';
  const contextBytes = options.contextBytes ?? utf8ByteLength(context);
  const dispatch = buildDecisionDispatch({
    plan: bound.plan,
    context,
    limits: options.limits,
  });
  if (!dispatch.ok) {
    return {
      ...refusal(
        options.task,
        'bounds',
        `context does not fit the declared bounds: ${dispatch.refusal.detail}`,
      ),
      setupSteps: [{ id: 'decision.setup.oversize', detail: dispatch.refusal.detail }],
    };
  }

  return options.adapter === undefined
    ? reportNoBackend(options, preference, contextBytes)
    : reportWithBackend(options, preference, contextBytes, options.adapter);
};
