// packages/frontend/ai-gateway/src/lib/decision/readiness.ts
//
// Backend readiness, proven rather than assumed (issue #381, contract C-567).
//
// The rule this file exists to enforce, taken from C-566's own adapter
// contract: *"Must reflect a real check. A listening socket is not readiness,
// and a dialect that parses is not a checkpoint that has answered."*
//
// Two layers, deliberately not collapsed into one:
//
//   1. `DecisionAdapter.capability()` — DIALECT readiness. Can this endpoint
//      serve the `jev-v1` shape at all? Answered by the adapter itself from a
//      real version/model probe. Cheap, no inference.
//   2. `probeDecisionBackend` (here) — CHECKPOINT readiness. Run the full
//      frozen pipeline once on the synthetic probe case and require a value
//      that validates against the ORIGINAL schema.
//
// Neither `/v1/models` listing the model, nor an HTTP 200, nor a bound port is
// sufficient for (2). Only an answered, schema-validated sample is.
//
// A successful sample proves LIVENESS AND SCHEMA CONFORMANCE, never accuracy.
// Quality is `live_measurement.ts`'s job, against the held-out split.
//
// Nothing here downloads, installs or upgrades anything, and no probe text
// carries player content: `PROBE_CONTEXT` is authored in this module.

import type { DecisionAdapter } from './adapters/types.ts';
import { analyzeDecisionSchema } from './analyzer.ts';
import { buildDecisionDispatch } from './dispatch.ts';
import { bindDecisionPolicy } from './policy.ts';
import { PROBE_CONTEXT, PROBE_POLICY, PROBE_SCHEMA, PROBE_TASK_ID } from './probe_case.ts';
import { runDecision } from './runner.ts';
import type {
  DecisionAbstentionReason,
  DecisionCapability,
  DecisionIncompatibility,
  DecisionLimits,
  DecisionPlan,
  DecisionResult,
  DecisionTaskPolicy,
} from './types.ts';
import { utf8ByteLength } from './util.ts';

/**
 * Why a backend is or is not usable.
 *
 * Every state is actionable. `ready` is the only one that permits routing, and
 * reaching it requires a sample decision (see the module header).
 */
export type DecisionReadinessState =
  /** A sample decision was answered and validated against the original schema. */
  | 'ready'
  /** Endpoint speaks the route but the runtime is below the dialect's floor. */
  | 'unsupported-runtime'
  /** Runtime is new enough but the requested checkpoint is not installed. */
  | 'model-missing'
  /** Checkpoint is present but advertises no decision-scoring capability. */
  | 'capability-missing'
  /** Runtime speaks a different dialect than the caller requires. */
  | 'incompatible-dialect'
  /** The probe itself does not fit the backend's declared bounds. */
  | 'oversize'
  /** Something answered, but the answer was not a legal value for this schema. */
  | 'sample-rejected'
  /** The endpoint did not answer at all. */
  | 'unreachable'
  /** The endpoint answered, and refused us. */
  | 'unauthorized'
  /** No budget left to finish the probe. */
  | 'deadline-exceeded'
  /** The caller cancelled before the probe finished. */
  | 'cancelled';

/** One readiness outcome. */
export type DecisionReadinessVerdict = {
  readonly state: DecisionReadinessState;
  /** Machine-readable, credential-free explanation. Safe to log and to show. */
  readonly reason: string;
  /** Declared capability, when the backend could report one. */
  readonly capability?: DecisionCapability;
  /** Probed facts: the checkpoint and runtime that actually answered. */
  readonly observed?: {
    readonly checkpoint?: string;
    readonly runtime?: string;
    readonly resourceId?: string;
    /** End-to-end milliseconds the sample decision took, including model load. */
    readonly sampleMs?: number;
  };
  /** Why the probe schema/policy could not be used, when that is the blocker. */
  readonly schemaReasons?: readonly DecisionIncompatibility[];
};

/** The probe case a backend must satisfy. Defaults to the synthetic probe. */
export type DecisionReadinessProbe = {
  /**
   * Any JSON-Schema-shaped object.
   *
   * Deliberately `unknown`: callers hand in TypeBox schemas, which have no
   * index signature, and forcing each one to cast would put a type assertion
   * in every call site instead of in the one place that widens it.
   */
  readonly schema?: unknown;
  readonly policy?: DecisionTaskPolicy;
  readonly context?: string;
  readonly limits?: Partial<DecisionLimits>;
  readonly domainValidate?: (value: Record<string, unknown>) => boolean;
};

/** Readiness probe options. */
export type ProbeDecisionBackendOptions = {
  readonly adapter: DecisionAdapter;
  /** Dialect the caller requires. Defaults to accepting whatever the adapter declares. */
  readonly requiredDialect?: string;
  readonly deadlineAt: number;
  readonly signal: AbortSignal;
  readonly requestId: string;
  readonly stateRevision: number;
  readonly probe?: DecisionReadinessProbe;
};

/** Maps an abstention reason onto the readiness state it means. */
const stateForAbstention = (reason: DecisionAbstentionReason): DecisionReadinessState => {
  switch (reason) {
    case 'backend-unavailable':
      return 'unreachable';
    case 'unauthorized':
      return 'unauthorized';
    case 'deadline-exceeded':
      return 'deadline-exceeded';
    case 'cancelled':
      return 'cancelled';
    case 'context-too-large':
    case 'language-unsupported':
      return 'oversize';
    default:
      return 'sample-rejected';
  }
};

/**
 * Classifies a backend that reported `ready: false`.
 *
 * Prefer the adapter's typed failure. Legacy adapters only supply prose, so
 * retain reason matching as a fallback; unrecognised reasons stay unreachable.
 */
const stateForNotReady = (capability: DecisionCapability): DecisionReadinessState => {
  if (capability.notReadyState !== undefined) {
    return capability.notReadyState;
  }
  const reason = capability.notReadyReason ?? '';
  if (/version|too old|below|minimum|floor/i.test(reason)) {
    return 'unsupported-runtime';
  }
  if (/not (installed|pulled|present)|no such model|model[- ]missing/i.test(reason)) {
    return 'model-missing';
  }
  if (/capability|scoring|does not support/i.test(reason)) {
    return 'capability-missing';
  }
  return 'unreachable';
};

/**
 * Compiles, binds and bounds the probe case.
 *
 * Returns either a refusal or the bound plan, so `probeUnredacted` has one
 * branch here instead of three, and the "is the probe even usable" question
 * stays readable on its own.
 */
const bindProbe = (
  schema: Record<string, unknown>,
  policy: DecisionTaskPolicy,
  context: string,
  limits: Partial<DecisionLimits> | undefined,
  supportedLanguages: DecisionCapability['languages'],
): { ok: true; plan: DecisionPlan } | { ok: false; refusal: DecisionReadinessVerdict } => {
  const analysis = analyzeDecisionSchema({ schema, ...(limits === undefined ? {} : { limits }) });
  if (!analysis.ok) {
    return {
      ok: false,
      refusal: {
        state: 'sample-rejected',
        reason: 'probe schema is not decision-compilable',
        schemaReasons: analysis.reasons,
      },
    };
  }

  const binding = bindDecisionPolicy({ plan: analysis.plan, policy, supportedLanguages });
  if (!binding.ok) {
    return {
      ok: false,
      refusal: {
        state: 'sample-rejected',
        reason: 'probe policy is not bindable',
        schemaReasons: binding.reasons,
      },
    };
  }

  const dispatch = buildDecisionDispatch({
    plan: binding.plan,
    context,
    ...(limits === undefined ? {} : { limits }),
  });
  if (!dispatch.ok) {
    return { ok: false, refusal: { state: 'oversize', reason: dispatch.refusal.detail } };
  }

  return { ok: true, plan: binding.plan };
};

/** Classifies a completed sample decision. */
const sampleVerdict = (
  result: DecisionResult,
  capability: DecisionCapability,
): DecisionReadinessVerdict => {
  if (result.ok) {
    return {
      state: 'ready',
      reason: 'a sample decision was answered and validated against the original schema',
      capability,
      observed: {
        checkpoint: result.provenance.checkpoint ?? capability.checkpoint,
        runtime: result.provenance.runtime ?? capability.runtime,
        resourceId: result.provenance.resourceId,
        sampleMs: result.provenance.timings.totalMs,
      },
    };
  }
  // The abstention code is carried in `reason`, not dressed up as a
  // `DecisionIncompatibility`: the compiler did not reject this schema, the
  // backend failed to answer it. Inventing a code here would make the two
  // failure modes indistinguishable to whoever reads the verdict.
  return {
    state: stateForAbstention(result.reason),
    reason: `sample decision did not produce a legal value: ${result.reason}`,
    capability,
  };
};

/** The probe itself. Every returned reason is redacted by the wrapper below. */
const probeUnredacted = async (
  options: ProbeDecisionBackendOptions,
): Promise<DecisionReadinessVerdict> => {
  const policy = options.probe?.policy ?? PROBE_POLICY;
  const context = options.probe?.context ?? PROBE_CONTEXT;
  // `analyzeDecisionSchema` takes `unknown` and validates it; `runDecision`
  // wants an index-signature record to re-validate the reconstructed value
  // against. A TypeBox `TObject` has no index signature, so it is widened once
  // here rather than loosening either function's contract for every caller.
  const schema = (options.probe?.schema ?? PROBE_SCHEMA) as Record<string, unknown>;

  if (options.signal.aborted) {
    return { state: 'cancelled', reason: 'probe cancelled before dispatch' };
  }
  if (Date.now() >= options.deadlineAt) {
    return { state: 'deadline-exceeded', reason: 'no probe budget left at dispatch' };
  }

  // ---- 1. dialect + transport readiness -------------------------------------
  const capability = await options.adapter.capability({
    deadlineAt: options.deadlineAt,
    signal: options.signal,
  });

  if (options.requiredDialect !== undefined && capability.dialect !== options.requiredDialect) {
    return {
      state: 'incompatible-dialect',
      reason: `backend speaks "${capability.dialect}", caller requires "${options.requiredDialect}"`,
      capability,
    };
  }

  if (!capability.ready) {
    return {
      state: stateForNotReady(capability),
      reason: capability.notReadyReason ?? 'backend reported not ready',
      capability,
    };
  }

  // ---- 2. does the probe itself compile? -----------------------------------
  const bound = bindProbe(schema, policy, context, options.probe?.limits, capability.languages);
  if (!bound.ok) {
    return { ...bound.refusal, capability };
  }

  // A pre-dispatch size refusal here would be a routing bug, not a readiness
  // fact: the probe context is authored in-module and is known-small. Assert it
  // rather than silently letting an oversize verdict masquerade as readiness.
  if (utf8ByteLength(context) > (capability.maxContextBytes ?? Number.MAX_SAFE_INTEGER)) {
    return {
      state: 'oversize',
      reason: `probe context exceeds the backend's declared bound of ${capability.maxContextBytes} bytes`,
      capability,
    };
  }

  // ---- 3. the sample decision itself ---------------------------------------
  return sampleVerdict(
    await runDecision({
      plan: bound.plan,
      schema,
      policy,
      adapter: options.adapter,
      context,
      deadlineAt: options.deadlineAt,
      signal: options.signal,
      requestId: options.requestId,
      stateRevision: options.stateRevision,
      domainValidate: options.probe?.domainValidate,
    }),
    capability,
  );
};

/**
 * Probes a backend for readiness.
 *
 * Returns `ready` only after a real decision was answered and reconstructed
 * into a value that satisfies the probe's ORIGINAL schema. Every other outcome
 * is a specific, actionable state.
 *
 * The probe inherits one absolute deadline and the caller's cancellation. It
 * never restarts a deadline and never retries.
 *
 * The reason string is redacted on the way out. Adapter reasons are free text
 * written at the transport layer, and transports quote the URL they failed
 * against — which is exactly where a pasted token would end up.
 */
export const probeDecisionBackend = async (
  options: ProbeDecisionBackendOptions,
): Promise<DecisionReadinessVerdict> => {
  const verdict = await probeUnredacted(options);
  const capability =
    verdict.capability === undefined
      ? undefined
      : {
          ...verdict.capability,
          ...(verdict.capability.notReadyReason === undefined
            ? {}
            : { notReadyReason: redactReason(verdict.capability.notReadyReason) }),
        };
  return {
    ...verdict,
    reason: redactReason(verdict.reason),
    ...(capability === undefined ? {} : { capability }),
  };
};
/**
 * Strips credential material from a URL before it reaches setup text.
 *
 * Setup text is shown in the UI and written to logs. A user who pasted
 * `http://user:token@host:port/` must not have that land in either.
 */
export const redactEndpoint = (endpoint: string): string => {
  try {
    const url = new URL(endpoint);
    if (url.username !== '' || url.password !== '') {
      url.username = 'REDACTED';
      url.password = '';
    }
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    // Not a URL: strip anything that looks like a query string and move on.
    return endpoint.split('?')[0] ?? endpoint;
  }
};

/** Matches a bare http(s) URL embedded in free text. */
const URL_IN_TEXT = /\bhttps?:\/\/[^\s'"<>)\]]+/g;

/**
 * Redacts every URL embedded in a reason string.
 *
 * An adapter's `notReadyReason` is free text assembled at the transport layer,
 * and transports quote URLs — including the userinfo and query a user pasted
 * into settings. Every reason this module emits goes through here before it
 * can reach a UI, a log line or a bug report.
 */
export const redactReason = (reason: string): string =>
  reason.replace(URL_IN_TEXT, (match) => redactEndpoint(match));

/** One line of actionable, credential-free guidance for a verdict. */
export type DecisionSetupStep = {
  /** Stable id for i18n lookup. Never a raw vendor string. */
  readonly id: string;
  /** Interpolable detail. Contains versions and counts, never secrets. */
  readonly detail: string;
};

/**
 * Turns a verdict into ordered setup steps.
 *
 * Deliberately returns *instructions to the operator*, not a UI component: the
 *  wizard that would render these is deferred (see the rollout report), and a
 *  pure function is what a wizard, a CLI and a log line can all share later.
 */
export const describeDecisionReadiness = (
  verdict: DecisionReadinessVerdict,
): readonly DecisionSetupStep[] => {
  switch (verdict.state) {
    case 'ready':
      return [
        {
          id: 'decision.setup.ready',
          detail:
            verdict.observed?.checkpoint === undefined
              ? 'the backend answered a sample decision'
              : `checkpoint ${verdict.observed.checkpoint} answered a sample decision`,
        },
      ];
    case 'unsupported-runtime':
      return [
        { id: 'decision.setup.runtimeTooOld', detail: verdict.reason },
        { id: 'decision.setup.upgradeRuntime', detail: verdict.reason },
        { id: 'decision.setup.noAutoUpgrade', detail: 'upgrade is never performed automatically' },
      ];
    case 'model-missing':
      return [
        { id: 'decision.setup.modelMissing', detail: verdict.reason },
        { id: 'decision.setup.installModel', detail: verdict.reason },
      ];
    case 'capability-missing':
      return [
        { id: 'decision.setup.capabilityMissing', detail: verdict.reason },
        { id: 'decision.setup.checkpointVariant', detail: verdict.reason },
      ];
    case 'incompatible-dialect':
      return [{ id: 'decision.setup.incompatibleDialect', detail: verdict.reason }];
    case 'oversize':
      return [{ id: 'decision.setup.oversize', detail: verdict.reason }];
    case 'sample-rejected':
      return [
        { id: 'decision.setup.sampleRejected', detail: verdict.reason },
        ...(verdict.schemaReasons ?? []).map((entry) => ({
          id: 'decision.setup.schemaReason',
          detail: `${entry.code}${entry.path.length > 0 ? ` at ${entry.path.join('.')}` : ''}`,
        })),
      ];
    case 'unauthorized':
      return [{ id: 'decision.setup.unauthorized', detail: verdict.reason }];
    case 'deadline-exceeded':
      return [{ id: 'decision.setup.deadline', detail: verdict.reason }];
    case 'cancelled':
      return [{ id: 'decision.setup.cancelled', detail: verdict.reason }];
    default:
      return [{ id: 'decision.setup.unreachable', detail: verdict.reason }];
  }
};

export { PROBE_TASK_ID };
