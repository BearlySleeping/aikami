// packages/frontend/ai-gateway/src/lib/decision/adapters/llamacpp_adapter.ts
//
// The NATIVE llama.cpp decision adapter (issue #381).
//
// Serves the decision route from a real `llama-server` built at or after
// `a4cb4c61` (upstream ggml-org/llama.cpp#29818), where `/v1/systemone` answers
// the TypeSafe shape directly. This is deliberately a separate adapter from
// `systemone_adapter.ts`, not a mode flag on it: the two dialects disagree on
// the request body, on the boolean answer representation, on the refusal codes
// and on where checkpoint identity comes from. See `native_llamacpp_dialect.ts`
// for the side-by-side.
//
// What this adapter refuses to do, and why
// -----------------------------------------
//   * It never puts a `model` field in the request. Upstream does not read one:
//     `parse_questions`/`parse_state` ignore it and the answer comes from the
//     model the SERVER was started with. Sending it would assert a per-request
//     checkpoint selection that does not exist.
//   * It never infers decision capability from a checkpoint NAME or a
//     `/v1/models` listing. A chat GGUF appears in `/v1/models` perfectly
//     happily. The authority is the server's own HTTP 501 ("This model is not a
//     decision model"), which is what `capability()` waits for.
//   * It never truncates a question to fit a checkpoint's option ceiling. It
//     refuses, because a truncated option list is a different question and
//     reconstructing from its answer produces a value for a field nobody asked
//     about.
//   * It never substitutes `confidence` for `noul`, and never reads a boolean
//     out of `answers[q].value`. Native `noul` IS the probability of true.

import {
  type CheckpointLimits,
  checkCheckpointLimits,
  limitsForCheckpoint,
} from '../checkpoint_limits.ts';
import {
  distributionSumsToOne,
  NATIVE_LLAMACPP_DIALECT,
  NATIVE_LLAMACPP_MAX_REQUEST_BYTES,
  type NativeQuestion,
  type NativeRequest,
  type NativeResponse,
  nativeStatusRefusal,
  parseNativeResponse,
  readNativeChoice,
  readNativeNoul,
} from '../native_llamacpp_dialect.ts';
import type {
  DecisionAnswer,
  DecisionCapability,
  DecisionLimits,
  DecisionQuestion,
} from '../types.ts';
import { utf8ByteLength } from '../util.ts';
import {
  type IdentityProbe,
  type LlamaCppTransport,
  probeHealth,
  probeIdentity,
  probeResidency,
  type RuntimeProbeContext,
  safeJson,
  stripDecisionPath,
} from './llamacpp_runtime.ts';
import type {
  DecisionAdapter,
  DecisionAdapterDiagnostics,
  DecisionAdapterResponse,
  DecisionRequest,
} from './types.ts';

/**
 * The transport and `/props` vocabulary lives in the runtime module; these
 * re-exports keep the adapter's public surface unchanged for existing callers.
 */
export {
  type LlamaCppBuildInfo,
  type LlamaCppServerProps,
  type LlamaCppTransport,
  parseLlamaCppBuildInfo,
  parseServerProps,
} from './llamacpp_runtime.ts';

/** Endpoints a native llama.cpp server serves. All optional but the decision route. */
export type LlamaCppEndpoints = {
  /** `POST /v1/systemone`. Required. */
  readonly decision: string;
  /** `GET /health`. Cheap liveness; never readiness on its own. */
  readonly health?: string;
  /** `GET /props`. Build identity, slot count and the loaded `model_path`. */
  readonly props?: string;
};

/**
 * Compares a configured checkpoint against what the server says it loaded.
 *
 * `/props.model_path` is a filesystem path (`/models/Laya-Q8_0.gguf`) while a
 * player may configure a bare name with or without the extension
 * (`Laya-Q8_0`, `Laya-Q8_0.gguf`). Comparing them literally reports a
 * correctly-configured backend as serving the wrong model, so identity is
 * compared on the basename with the artefact extension dropped.
 *
 * Returns false when either side is absent: an unknown identity is never a
 * match, because that is exactly the case where a silent substitution hides.
 */
export const sameCheckpoint = (configured: string, served: string): boolean => {
  const normalize = (value: string): string =>
    (value.trim().split(/[/\\]/).pop() ?? '')
      .toLowerCase()
      .replace(/:latest$/, '')
      .replace(/\.(gguf|safetensors|bin)$/, '');
  return normalize(configured) === normalize(served);
};

/** Extra, provider-specific diagnostics an adapter may attach to a refusal. */
export type LlamaCppRefusalDetail = DecisionAdapterDiagnostics;

/** Builds an endpoint-specific backend identity. */
export const llamaCppBackendId = (options: { endpoint: string; checkpoint: string }): string => {
  const endpointKey = (() => {
    try {
      const url = new URL(options.endpoint);
      return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
    } catch {
      return options.endpoint.replace(/\/+$/, '').toLowerCase();
    }
  })();
  return `llamacpp:${endpointKey}#${options.checkpoint}`;
};

/**
 * Advertised structural bounds.
 *
 * `maxOptions` is deliberately NOT a number here. The real ceiling is a property
 * of the loaded checkpoint (`n_options_max` in upstream's server, which is the
 * model's own label table for openjev/lev/kev and a fixed 255 for laya), so it
 * is resolved per checkpoint in {@link limitsForCheckpoint} and enforced at
 * dispatch. Reporting one number here would be the "copy a universal limit
 * between models" mistake wearing a constant's clothes.
 */
export const LLAMACPP_DECISION_LIMITS: DecisionLimits = {
  maxDepth: 4,
  maxQuestions: 16,
  // Placeholder ceiling for the runner's shape guard only. The binding
  // constraint is the per-checkpoint limit enforced in `prepareRequest`.
  maxOptions: 255,
  maxUnionBranches: 64,
  maxCombinations: 32,
  maxContextBytes: NATIVE_LLAMACPP_MAX_REQUEST_BYTES,
};

/** Adapter configuration. Every field is explicit; there is no default endpoint. */
export type LlamaCppAdapterOptions = {
  readonly endpoints: LlamaCppEndpoints;
  /** Checkpoint the player expects to answer. Reported verbatim in provenance. */
  readonly checkpoint: string;
  /** Languages the checkpoint declares. */
  readonly languages: DecisionCapability['languages'];
  /** Read timeout for readiness probing, in ms. */
  readonly probeTimeoutMs?: number;
  /** Resolved per request, so a credential is never captured in a closure. */
  readonly authHeaders?: () => Promise<Readonly<Record<string, string>>>;
  /** Overrides the resolved per-checkpoint limits. For measured devices only. */
  readonly checkpointLimits?: CheckpointLimits;
  readonly transport?: LlamaCppTransport;
};

/** One question as it will go on the wire, with the size the ceiling check uses. */
type WireQuestion =
  | { readonly ok: true; readonly wire: NativeQuestion; readonly optionCount: number }
  | { readonly ok: false; readonly detail: string };

/** Builds the `noul` form of a boolean question. */
const noulWireQuestion = (question: DecisionQuestion, instructions: string): WireQuestion => {
  const trueLabel = question.options?.find((option) => option.value === true)?.description;
  const falseLabel = question.options?.find((option) => option.value === false)?.description;
  // Both descriptions or neither: upstream reads `criteria.true` and
  // `criteria.false` and leaves a missing key as null, so a half-filled object
  // would silently ask the model an asymmetric question.
  const criteria =
    trueLabel === undefined || falseLabel === undefined
      ? {}
      : { criteria: { true: trueLabel, false: falseLabel } };
  return { ok: true, wire: { type: 'noul', instructions, ...criteria }, optionCount: 2 };
};

/** Builds the `choice` form of a choice or combination question. */
const choiceWireQuestion = (question: DecisionQuestion, instructions: string): WireQuestion => {
  const criteria: Record<string, string | null> = {};
  for (const option of question.options ?? []) {
    criteria[option.key] = option.description ?? null;
  }
  for (const option of question.combinationOptions ?? []) {
    criteria[option.key] = option.label;
  }
  const count = Object.keys(criteria).length;
  // Upstream REJECTS a choice question with empty criteria (400), so this is
  // refused here with the real reason rather than sent to find out.
  if (count === 0) {
    return { ok: false, detail: `question "${question.key}" has no options to offer` };
  }
  return { ok: true, wire: { type: 'choice', instructions, criteria }, optionCount: count };
};

/**
 * Converts one plan question into its native wire form, or explains the refusal.
 *
 * One branch per question kind. `score` and image input are not reachable from
 * this adapter's capability set at all: upstream serves them, Aikami does not
 * send them, and the refusal names that rather than reporting "unsupported".
 */
const toWireQuestion = (question: DecisionQuestion): WireQuestion => {
  const instructions = question.instructions;
  if (instructions === undefined || instructions.trim().length === 0) {
    return { ok: false, detail: `question "${question.key}" has no instructions` };
  }
  if (question.kind === 'boolean') {
    return noulWireQuestion(question, instructions);
  }
  if (question.kind === 'choice' || question.kind === 'combination') {
    return choiceWireQuestion(question, instructions);
  }
  return {
    ok: false,
    detail: `question "${question.key}" is a ${question.kind}; native llama.cpp supports choice and noul only`,
  };
};

/** Option keys a plan question will put on the wire, for answer validation. */
const wireOptionKeys = (question: DecisionQuestion): readonly string[] => {
  if (question.kind === 'choice') {
    return (question.options ?? []).map((option) => option.key);
  }
  if (question.kind === 'combination') {
    return (question.combinationOptions ?? []).map((option) => option.key);
  }
  return [];
};

/**
 * How much of a refusal body is kept for diagnosis.
 *
 * Upstream echoes the offending request in some errors, so this is bounded: a
 * refusal detail ends up in telemetry and in a settings screen, and neither
 * should carry an entire prompt back out.
 */
const MAX_REFUSAL_BODY_CHARS = 300;

/**
 * Reads a refusal body, bounded and never thrown on.
 *
 * A diagnostic aid must never be the thing that turns a clean, typed refusal
 * into an unhandled error, so the text is truncated and a read failure yields
 * `undefined` — which the mapper treats as "no cause reported" rather than as a
 * claim.
 */
const refusalBody = async (response: { text(): Promise<string> }): Promise<string | undefined> => {
  try {
    const text = (await response.text()).trim();
    return text.length === 0 ? undefined : text.slice(0, MAX_REFUSAL_BODY_CHARS);
  } catch {
    return undefined;
  }
};

/**
 * Maps an upstream refusal onto the adapter's own vocabulary.
 *
 * `not-a-decision-model` and `request-too-large` are facts about THIS request,
 * not about the endpoint's health, so both are `invalid-response`; the detail
 * text carries which it was. Keeping them apart from `backend-unavailable` is
 * what stops "this checkpoint cannot answer" being reported as "the server is
 * down", which sends a player to debug the wrong thing.
 */
const failureReasonFor = (
  refusal:
    | 'not-a-decision-model'
    | 'invalid-request'
    | 'request-too-large'
    | 'unauthorized'
    | 'backend-unavailable',
): DecisionFailureReason => {
  if (refusal === 'unauthorized') {
    return 'unauthorized';
  }
  return refusal === 'backend-unavailable' ? 'backend-unavailable' : 'invalid-response';
};

/** Milliseconds remaining before the absolute deadline, floored at zero. */
const remainingMs = (deadlineAt: number): number => Math.max(0, deadlineAt - Date.now());

/** A pre-dispatch refusal: nothing was sent, so every timing is zero. */
const refuseBeforeDispatch = (
  reason: DecisionFailureReason,
  detail: string,
  diagnostics?: DecisionAdapterDiagnostics,
): DecisionAdapterResponse => ({
  ok: false,
  reason,
  detail,
  queueMs: 0,
  inferenceMs: 0,
  ...(diagnostics === undefined ? {} : { diagnostics }),
});

/** The refusal reasons this adapter can produce. Mirrors the adapter contract. */
type DecisionFailureReason = Extract<DecisionAdapterResponse, { ok: false }>['reason'];

/**
 * Builds one dispatchable request, or the refusal that stops it.
 *
 * Every pre-dispatch refusal lives here so the transport body is the only thing
 * in `run()`: a refusal that happens before the wire must never carry a timing
 * that implies work was done.
 */
const prepareRequest = (options: {
  request: DecisionRequest;
  checkpoint: string;
  checkpointLimits: CheckpointLimits;
}):
  | {
      readonly ok: true;
      readonly serialized: string;
      readonly order: readonly DecisionQuestion[];
      readonly budget: number;
    }
  | { readonly ok: false; readonly refusal: DecisionAdapterResponse } => {
  const { request } = options;
  if (request.signal.aborted) {
    return { ok: false, refusal: refuseBeforeDispatch('cancelled', 'cancelled before dispatch') };
  }

  // `state` is REQUIRED by native llama.cpp. A unit built without a context
  // projection can carry an empty one, and `JSON.stringify` drops an undefined
  // field entirely — producing `{"questions":{...}}`, which upstream answers
  // with a 400 that says nothing about the real cause. Refusing here names it.
  const state = request.unit.state;
  if (typeof state !== 'string' || state.trim().length === 0) {
    return {
      ok: false,
      refusal: refuseBeforeDispatch(
        'invalid-response',
        'this dispatch unit carries no state; native /v1/systemone requires the content to evaluate',
      ),
    };
  }

  const questions: Record<string, NativeQuestion> = {};
  const order: DecisionQuestion[] = [];
  const counts: { key: string; optionCount?: number }[] = [];
  for (const dispatch of request.unit.questions) {
    const planQuestion = request.plan.questions.find((candidate) => candidate.key === dispatch.key);
    if (planQuestion === undefined) {
      continue;
    }
    const wire = toWireQuestion(planQuestion);
    if (!wire.ok) {
      return { ok: false, refusal: refuseBeforeDispatch('invalid-response', wire.detail) };
    }
    questions[planQuestion.key] = wire.wire;
    order.push(planQuestion);
    counts.push({ key: planQuestion.key, optionCount: wire.optionCount });
  }
  if (order.length === 0) {
    return {
      ok: false,
      refusal: refuseBeforeDispatch(
        'invalid-response',
        'no question in this unit is expressible in the native llama.cpp dialect',
      ),
    };
  }

  // Fail closed on the CHECKPOINT's real limits, before anything is sent.
  const violations = checkCheckpointLimits({
    checkpoint: options.checkpoint,
    limits: options.checkpointLimits,
    questions: counts,
  });
  if (violations.length > 0) {
    return {
      ok: false,
      refusal: refuseBeforeDispatch('invalid-response', violations[0].detail, {
        limitViolations: violations,
      }),
    };
  }

  const body: NativeRequest = { state, questions };
  const serialized = JSON.stringify(body);
  const size = utf8ByteLength(serialized);
  if (size > NATIVE_LLAMACPP_MAX_REQUEST_BYTES) {
    return {
      ok: false,
      refusal: refuseBeforeDispatch(
        'invalid-response',
        `request body is ${size} bytes; this client refuses more than ${NATIVE_LLAMACPP_MAX_REQUEST_BYTES}`,
      ),
    };
  }
  const budget = remainingMs(request.deadlineAt);
  if (budget === 0) {
    return {
      ok: false,
      refusal: refuseBeforeDispatch('deadline-exceeded', 'deadline already passed at dispatch'),
    };
  }
  return { ok: true, serialized, order, budget };
};

/** Converts one native answer into plan terms, or explains the mismatch. */
const answerFrom = (
  question: DecisionQuestion,
  body: NativeResponse,
):
  | { readonly ok: true; readonly answer: DecisionAnswer }
  | { readonly ok: false; readonly detail: string } => {
  const wire = body.answers[question.key];
  if (question.kind === 'boolean') {
    const noul = readNativeNoul(wire, question.key);
    if (!noul.ok) {
      return noul;
    }
    // The wire gives p(true) and nothing else. p(false) is its complement by
    // construction, so this pair is EXACT — which is what makes it safe to hand
    // to the task's existing threshold policy.
    //
    // `booleanValue` is the wire's own argmax at p >= 0.5, and is what
    // reconstruction writes. It is deliberately NOT taken from a `value` field
    // (absent natively) and NOT derived from `confidence` (a different quantity
    // entirely, and not present on a native noul answer at all).
    return {
      ok: true,
      answer: {
        questionKey: question.key,
        booleanValue: noul.pTrue >= 0.5,
        probabilities: { true: noul.pTrue, false: noul.pFalse },
      },
    };
  }
  const optionKeys = wireOptionKeys(question);
  const choice = readNativeChoice(wire, question.key, optionKeys);
  if (!choice.ok) {
    return choice;
  }
  const probabilities = wire?.probabilities;
  if (probabilities !== undefined) {
    const sum = distributionSumsToOne(probabilities, optionKeys);
    if (!sum.ok) {
      return sum;
    }
  }
  return {
    ok: true,
    answer: {
      questionKey: question.key,
      optionKey: choice.optionKey,
      // Reported per-option so the task's `choicePolicy` thresholds apply to
      // the model's own distribution — never to `confidence`.
      probabilities: probabilities ?? { [choice.optionKey]: choice.probability },
      ...(wire?.confidence === undefined ? {} : { confidence: wire.confidence }),
    },
  };
};

/**
 * Builds the adapter.
 *
 * @param options.transport - Defaults to `globalThis.fetch`. Injected in tests.
 */
/** Builds the capability this adapter advertises before any probe runs. */
const baseCapabilityFor = (options: {
  backendId: string;
  checkpoint: string;
  languages: DecisionCapability['languages'];
  checkpointLimits: CheckpointLimits;
}): DecisionCapability => ({
  backendId: options.backendId,
  dialect: NATIVE_LLAMACPP_DIALECT,
  ready: false,
  primitives: ['boolean', 'choice', 'combination'],
  maxOptions: options.checkpointLimits.maxChoiceOptions,
  maxQuestions: LLAMACPP_DECISION_LIMITS.maxQuestions,
  maxContextBytes: LLAMACPP_DECISION_LIMITS.maxContextBytes,
  languages: options.languages,
  checkpoint: options.checkpoint,
});

/**
 * Turns a readiness probe into a capability.
 *
 * Kept out of `capability()` so the three refusal reasons — identity probe
 * failed, wrong checkpoint loaded, server still loading — are three named
 * branches instead of one nested ladder.
 */
const capabilityFrom = (options: {
  readonly base: DecisionCapability;
  readonly identity: IdentityProbe;
  readonly health:
    | { readonly ok: true }
    | {
        readonly ok: false;
        readonly state: NonNullable<DecisionCapability['notReadyState']>;
        readonly reason: string;
      };
  readonly configuredCheckpoint: string;
}): DecisionCapability => {
  const { base, identity, health, configuredCheckpoint } = options;
  if (!identity.ok) {
    return {
      ...base,
      ready: false,
      notReadyReason: identity.reason,
      notReadyState: identity.state,
      runtime: 'llama.cpp',
    };
  }
  const served = identity.props?.modelPath;
  const commit = identity.props?.build?.buildCommit;
  const runtime =
    commit === undefined
      ? 'llama.cpp'
      : `llama.cpp ${identity.props?.build?.version ?? 'unknown'} (${commit.slice(0, 8)})`;

  // Native llama.cpp serves only what it was started with, so a mismatch is
  // reported rather than silently answered by a different model.
  if (served !== undefined && !sameCheckpoint(configuredCheckpoint, served)) {
    return {
      ...base,
      ready: false,
      runtime,
      checkpoint: served,
      notReadyState: 'model-missing',
      notReadyReason:
        `the server is serving "${served}" but this connection is configured for ` +
        `"${configuredCheckpoint}". Native llama.cpp answers with the model it was started ` +
        'with; start a second server for a second checkpoint.',
    };
  }
  if (!health.ok) {
    return {
      ...base,
      ready: false,
      runtime,
      notReadyState: health.state,
      notReadyReason: health.reason,
    };
  }
  return { ...base, ready: true, runtime, checkpoint: served ?? configuredCheckpoint };
};

/** Reads one dispatched response into answers or a typed refusal. */
const readDispatch = async (options: {
  readonly response: { status: number; text(): Promise<string> };
  readonly order: readonly DecisionQuestion[];
  readonly inferenceMs: number;
  readonly configuredCheckpoint: string;
}): Promise<DecisionAdapterResponse> => {
  if (options.response.status !== 200) {
    // The body is read BEFORE mapping, because the status alone cannot tell a
    // batch-layer overflow from any other server fault, and the distinction
    // changes the operator's next step. Read at most once.
    const refusal = nativeStatusRefusal(
      options.response.status,
      await refusalBody(options.response),
    );
    if (refusal !== undefined) {
      return {
        ok: false,
        reason: failureReasonFor(refusal.reason),
        detail: refusal.detail,
        queueMs: 0,
        inferenceMs: options.inferenceMs,
        // NO `servedCheckpoint`: a refusal is precisely the case where the
        // server never told us what answered. Recording the CONFIGURED
        // checkpoint here would report a configured value in a field
        // documented as the served one, and qualification evidence is keyed on
        // this field. Absent is the truthful answer.
        diagnostics: {},
      };
    }
  }
  const parsed = parseNativeResponse(safeJson(await options.response.text()));
  if (parsed.ok !== true) {
    return {
      ok: false,
      reason: 'invalid-response',
      detail: parsed.reason,
      queueMs: 0,
      inferenceMs: options.inferenceMs,
    };
  }
  const diagnostics: DecisionAdapterDiagnostics = {
    servedCheckpoint: parsed.body.model,
    ...(parsed.body.usage === undefined ? {} : { usage: parsed.body.usage }),
  };
  const answers: DecisionAnswer[] = [];
  for (const question of options.order) {
    const answer = answerFrom(question, parsed.body);
    if (!answer.ok) {
      return {
        ok: false,
        reason: 'invalid-response',
        detail: answer.detail,
        queueMs: 0,
        inferenceMs: options.inferenceMs,
        diagnostics,
      };
    }
    answers.push(answer.answer);
  }
  return {
    ok: true,
    answers,
    queueMs: 0,
    inferenceMs: options.inferenceMs,
    checkpoint: parsed.body.model,
    diagnostics,
  };
};

/** Classifies a thrown transport error against the caller's signal and deadline. */
const transportFailure = (options: {
  readonly error: unknown;
  readonly request: DecisionRequest;
  readonly started: number;
}): DecisionAdapterResponse => {
  const inferenceMs = Date.now() - options.started;
  if (options.request.signal.aborted) {
    return { ok: false, reason: 'cancelled', detail: 'caller cancelled', queueMs: 0, inferenceMs };
  }
  if (Date.now() >= options.request.deadlineAt) {
    return {
      ok: false,
      reason: 'deadline-exceeded',
      detail: `deadline passed after ${inferenceMs} ms`,
      queueMs: 0,
      inferenceMs,
    };
  }
  return {
    ok: false,
    reason: 'backend-unavailable',
    detail: options.error instanceof Error ? options.error.message : String(options.error),
    queueMs: 0,
    inferenceMs,
  };
};

/**
 * Builds the adapter.
 *
 * @param options.transport - Defaults to `globalThis.fetch`. Injected in tests.
 */
export const createLlamaCppDecisionAdapter = (options: LlamaCppAdapterOptions): DecisionAdapter => {
  const transport: LlamaCppTransport = options.transport ?? {
    fetch: (input, init) => globalThis.fetch(input, init),
  };
  const probeTimeoutMs = options.probeTimeoutMs ?? 2000;
  const checkpointLimits = options.checkpointLimits ?? limitsForCheckpoint(options.checkpoint);
  const backendId = llamaCppBackendId({
    endpoint: options.endpoints.decision,
    checkpoint: options.checkpoint,
  });
  const base = baseCapabilityFor({
    backendId,
    checkpoint: options.checkpoint,
    languages: options.languages,
    checkpointLimits,
  });
  const context: RuntimeProbeContext = {
    transport,
    ...(options.authHeaders === undefined ? {} : { authHeaders: options.authHeaders }),
  };
  const propsUrl =
    options.endpoints.props ?? `${stripDecisionPath(options.endpoints.decision)}/props`;

  return {
    backendId,
    dialect: NATIVE_LLAMACPP_DIALECT,

    /**
     * Runtime readiness, WITHOUT inference.
     *
     * Deliberately not proof the checkpoint can answer: it reports liveness and
     * the loaded model path. `probeDecisionBackend` owns the real proof, by
     * dispatching one sample decision. Keeping them apart is what lets "Test
     * connection" report compatibility without implying gameplay qualification.
     */
    async capability(probe) {
      const signal = probe?.signal ?? new AbortController().signal;
      const deadlineAt = probe?.deadlineAt ?? Date.now() + probeTimeoutMs;
      const budget = Math.min(probeTimeoutMs, remainingMs(deadlineAt));
      const identity = await probeIdentity({
        context,
        propsUrl: options.endpoints.props,
        budgetMs: budget,
        signal,
      });
      // Probed whenever the identity probe succeeded. Gating it on a checkpoint
      // match bought nothing — `capabilityFrom` already reports a mismatch
      // before it looks at health — and the `{ ok: true }` fallback it needed
      // manufactured a result nothing had observed.
      const health = identity.ok
        ? await probeHealth({
            context,
            healthUrl: options.endpoints.health,
            budgetMs: Math.min(probeTimeoutMs, remainingMs(deadlineAt)),
            signal,
          })
        : ({ ok: true } as const);
      return capabilityFrom({
        base,
        identity,
        health,
        configuredCheckpoint: options.checkpoint,
      });
    },

    /** Residency, from the server process. See `llamacpp_runtime.ts`. */
    async residency(probe) {
      return await probeResidency({
        context,
        propsUrl,
        budgetMs: probeTimeoutMs,
        signal: probe?.signal ?? new AbortController().signal,
      });
    },

    async run(request: DecisionRequest): Promise<DecisionAdapterResponse> {
      const started = Date.now();
      const prepared = prepareRequest({
        request,
        checkpoint: options.checkpoint,
        checkpointLimits,
      });
      if (!prepared.ok) {
        return prepared.refusal;
      }
      const { serialized, order, budget } = prepared;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), budget);
      const onAbort = (): void => controller.abort();
      request.signal.addEventListener('abort', onAbort, { once: true });
      try {
        const authHeaders = options.authHeaders === undefined ? {} : await options.authHeaders();
        const response = await transport.fetch(options.endpoints.decision, {
          method: 'POST',
          body: serialized,
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          signal: controller.signal,
        });
        return await readDispatch({
          response,
          order,
          inferenceMs: Date.now() - started,
          configuredCheckpoint: options.checkpoint,
        });
      } catch (error) {
        return transportFailure({ error, request, started });
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener('abort', onAbort);
      }
    },
  };
};
