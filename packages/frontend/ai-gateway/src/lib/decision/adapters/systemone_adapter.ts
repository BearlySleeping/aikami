// packages/frontend/ai-gateway/src/lib/decision/adapters/systemone_adapter.ts
//
// `/v1/systemone`-dialect transport adapter (issue #381, contract C-566).
//
// Scope, stated plainly: this adapter builds and parses the wire shape and
// enforces the transport-level contract. It is NOT wired into live routing by
// this contract, and no shipping call site reaches it. Everything it needs from
// a live backend it learns by asking that backend (`/api/version`, a sample
// inference), never from documentation — a route that answers 404 is reported
// as not-ready rather than assumed to work.

import {
  parseSystemOneResponse,
  SYSTEM_ONE_DIALECT,
  SYSTEM_ONE_MAX_BODY_BYTES,
  type SystemOneAnswer,
  type SystemOneQuestion,
  type SystemOneRequest,
  type SystemOneResponse,
} from '../dialect.ts';
import {
  type DecisionRuntimeEndpoints,
  type DecisionRuntimeKind,
  probeDecisionRuntime,
  runtimeLabel,
} from '../runtime_probe.ts';
import {
  DEFAULT_DECISION_LIMITS,
  type DecisionAnswer,
  type DecisionCapability,
  type DecisionDispatchUnit,
  type DecisionLimits,
  type DecisionPlan,
  type DecisionQuestion,
} from '../types.ts';
import { utf8ByteLength } from '../util.ts';
import type { DecisionAdapter, DecisionAdapterResponse, DecisionRequest } from './types.ts';

/** Transport endpoints the adapter needs. All caller-supplied; nothing is assumed. */
export type SystemOneEndpoints = DecisionRuntimeEndpoints;

/**
 * Bounds this adapter actually advertises.
 *
 * The previous capability block answered `Number.MAX_SAFE_INTEGER` for options
 * and questions, which meant the runner's dispatch bounds were the only limit in
 * force and a hostile plan could size a request to fit whatever the transport
 * happened to accept. These are the dialect's real bounds: the compiler's
 * conservative defaults, with the context bound raised to the wire's own body
 * limit rather than left unbounded.
 */
export const JEV_DECISION_LIMITS: DecisionLimits = {
  ...DEFAULT_DECISION_LIMITS,
  maxContextBytes: SYSTEM_ONE_MAX_BODY_BYTES,
};

/**
 * Builds an endpoint-specific backend identity.
 *
 * The endpoint is part of the identity because `nimble` on a laptop daemon and
 * `nimble` on a hosted Jev account are different models serving different
 * players with different checkpoints. Keying identity on the alias alone let two
 * completely different backends share one cache entry, one readiness record and
 * one qualification result.
 */
export const decisionBackendId = (options: {
  runtime: DecisionRuntimeKind;
  endpoint: string;
  model: string;
}): string => {
  const endpointKey = (() => {
    try {
      const url = new URL(options.endpoint);
      return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
    } catch {
      return options.endpoint.replace(/\/+$/, '').toLowerCase();
    }
  })();
  return `jev:${options.runtime}:${endpointKey}#${options.model}`;
};

/** Injectable transport so the contract is testable with no live backend. */
export type SystemOneTransport = {
  fetch(
    input: string,
    init: { method: string; body?: string; headers: Record<string, string>; signal: AbortSignal },
  ): Promise<{
    status: number;
    text(): Promise<string>;
  }>;
};

/** Adapter configuration. Every field is explicit; there is no default endpoint. */
export type SystemOneAdapterOptions = {
  /**
   * Which runtime serves this endpoint.
   *
   * `ollama` is asked for `/api/version` and must clear the dialect floor.
   * `jev` is a generic Jev-compatible server and is never asked for an Ollama
   * version route it may not serve.
   */
  readonly runtime: DecisionRuntimeKind;
  readonly endpoints: SystemOneEndpoints;
  /** Checkpoint to request. Reported verbatim in provenance. */
  readonly model: string;
  /** Languages the checkpoint declares. */
  readonly languages: DecisionCapability['languages'];
  /** Read timeout for the readiness probe, in ms. */
  readonly probeTimeoutMs?: number;
  /**
   * Resolves the credential for each request.
   *
   * A callback, never a stored string: a vault-backed credential must be
   * resolved at dispatch time so it can be rotated, revoked or absent without
   * rebuilding the adapter, and so it is never captured in a closure, a log line
   * or a provenance record.
   */
  readonly authHeaders?: () => Promise<Readonly<Record<string, string>>>;
  /** Capability bounds to advertise. Defaults to {@link JEV_DECISION_LIMITS}. */
  readonly limits?: Partial<DecisionLimits>;
  readonly transport?: SystemOneTransport;
};

/** Converts one plan question into its wire form. */
const toWireQuestion = (question: DecisionQuestion): SystemOneQuestion | undefined => {
  const instructions = question.instructions;
  if (instructions === undefined) {
    return undefined;
  }
  if (question.kind === 'boolean') {
    return { type: 'noul', instructions };
  }
  if (question.kind === 'combination') {
    const criteria: Record<string, string> = {};
    for (const option of question.combinationOptions ?? []) {
      criteria[option.key] = option.label;
    }
    return Object.keys(criteria).length > 0
      ? { type: 'choice', instructions, criteria }
      : undefined;
  }
  const criteria: Record<string, string> = {};
  for (const option of question.options ?? []) {
    criteria[option.key] = option.description ?? option.key;
  }
  return Object.keys(criteria).length > 0 ? { type: 'choice', instructions, criteria } : undefined;
};

/** Converts one wire answer back into plan terms. */
const fromWireAnswer = (
  questionKey: string,
  answer: SystemOneAnswer,
): DecisionAnswer | undefined => {
  if (answer.type === 'noul') {
    return typeof answer.value === 'boolean'
      ? {
          questionKey,
          booleanValue: answer.value,
          probabilities: answer.probabilities,
          confidence: answer.confidence,
        }
      : undefined;
  }
  if (answer.type === 'choice' && typeof answer.choice === 'string') {
    return {
      questionKey,
      optionKey: answer.choice,
      probabilities: answer.probabilities,
      confidence: answer.confidence,
    };
  }
  return undefined;
};

/** Classifies a thrown transport error against the caller's signal and deadline. */
const transportFailure = (options: {
  error: unknown;
  request: DecisionRequest;
  started: number;
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
  const detail = options.error instanceof Error ? options.error.message : String(options.error);
  return { ok: false, reason: 'backend-unavailable', detail, queueMs: 0, inferenceMs };
};

/** Builds the per-group wire question map, dropping anything inexpressible. */
const buildWireQuestions = (options: {
  unit: DecisionDispatchUnit;
  plan: DecisionPlan;
}): {
  readonly questions: Record<string, SystemOneQuestion>;
  readonly order: readonly DecisionQuestion[];
} => {
  const questions: Record<string, SystemOneQuestion> = {};
  const order: DecisionQuestion[] = [];
  for (const question of options.unit.questions) {
    const planQuestion = options.plan.questions.find((candidate) => candidate.key === question.key);
    if (planQuestion === undefined) {
      continue;
    }
    const wire = toWireQuestion(planQuestion);
    if (wire === undefined) {
      continue;
    }
    questions[question.key] = wire;
    order.push(planQuestion);
  }
  return { questions, order };
};

/** A pre-dispatch refusal: nothing was sent, so every timing is zero. */
const refuseBeforeDispatch = (
  reason: DecisionFailure['reason'] | 'cancelled' | 'deadline-exceeded',
  detail: string,
): DecisionAdapterResponse => ({ ok: false, reason, detail, queueMs: 0, inferenceMs: 0 });

/** One typed transport refusal. */
type DecisionFailure = {
  readonly ok: false;
  readonly reason: 'backend-unavailable' | 'invalid-response' | 'unauthorized';
  readonly detail: string;
  readonly queueMs: 0;
  readonly inferenceMs: number;
};

/** Maps a status onto the refusal it means, or `undefined` when it is 200. */
const statusRefusal = (status: number, inferenceMs: number): DecisionFailure | undefined =>
  status === 200 ? undefined : failureForStatus(status, inferenceMs);

/** Maps an HTTP status onto the refusal it means. */
const failureForStatus = (status: number, inferenceMs: number): DecisionFailure => {
  if (status === 401 || status === 403) {
    return { ok: false, reason: 'unauthorized', detail: `HTTP ${status}`, queueMs: 0, inferenceMs };
  }
  if (status === 404) {
    return {
      ok: false,
      reason: 'backend-unavailable',
      detail: 'endpoint not found: this runtime does not implement /v1/systemone',
      queueMs: 0,
      inferenceMs,
    };
  }
  if (status === 413) {
    return {
      ok: false,
      reason: 'invalid-response',
      detail: 'backend refused the body as too large',
      queueMs: 0,
      inferenceMs,
    };
  }
  return {
    ok: false,
    reason: 'backend-unavailable',
    detail: `HTTP ${status}`,
    queueMs: 0,
    inferenceMs,
  };
};

/** Converts a parsed body into plan answers, or explains the mismatch. */
const answersFrom = (
  parsed: SystemOneResponse | undefined,
  order: readonly DecisionQuestion[],
  inferenceMs: number,
): { readonly ok: true; readonly answers: DecisionAnswer[] } | DecisionFailure => {
  if (parsed === undefined || parsed.error !== undefined) {
    return {
      ok: false,
      reason: 'invalid-response',
      detail: parsed?.error ?? 'response did not match the jev-v1 shape',
      queueMs: 0,
      inferenceMs,
    };
  }
  const answers: DecisionAnswer[] = [];
  for (const question of order) {
    const wire = parsed.answers[question.key];
    const answer = wire === undefined ? undefined : fromWireAnswer(question.key, wire);
    if (answer !== undefined) {
      answers.push(answer);
    }
  }
  if (answers.length !== order.length) {
    return {
      ok: false,
      reason: 'invalid-response',
      detail: `answered ${answers.length} of ${order.length} questions`,
      queueMs: 0,
      inferenceMs,
    };
  }
  return { ok: true, answers };
};

/** Milliseconds remaining before the absolute deadline, floored at zero. */
const remainingMs = (deadlineAt: number): number => Math.max(0, deadlineAt - Date.now());

/** Why a probe has no budget left, or undefined when it does. */
const budgetRefusalFor = (options: {
  aborted: boolean;
  budget: number;
}): { reason: string; state: 'cancelled' | 'deadline-exceeded' } | undefined => {
  if (options.aborted) {
    return { reason: 'probe cancelled before dispatch', state: 'cancelled' };
  }
  return options.budget === 0
    ? { reason: 'no probe budget left', state: 'deadline-exceeded' }
    : undefined;
};

/** One typed readiness refusal, carrying the state the settings UI branches on. */
const notReady = (
  base: DecisionCapability,
  runtime: DecisionRuntimeKind,
  options: { reason: string; state: DecisionCapability['notReadyState']; runtime?: string },
): DecisionCapability => ({
  ...base,
  ready: false,
  runtime: options.runtime ?? runtimeLabel(runtime),
  notReadyReason: options.reason,
  notReadyState: options.state,
});

/**
 * Builds one dispatchable request, or the refusal that stops it.
 *
 * Every pre-dispatch refusal lives here so the transport body is the only thing
 * in `run()`: a refusal that happens before the wire must never carry a timing
 * that implies work was done.
 */
const prepareRequest = (options: {
  request: DecisionRequest;
  model: string;
}):
  | {
      ok: true;
      serialized: string;
      order: readonly DecisionQuestion[];
      budget: number;
    }
  | { ok: false; refusal: DecisionAdapterResponse } => {
  const { request } = options;
  if (request.signal.aborted) {
    return { ok: false, refusal: refuseBeforeDispatch('cancelled', 'cancelled before dispatch') };
  }
  const { questions, order } = buildWireQuestions({ unit: request.unit, plan: request.plan });
  if (order.length === 0) {
    return {
      ok: false,
      refusal: refuseBeforeDispatch(
        'invalid-response',
        'no question in this unit is expressible in the jev-v1 dialect',
      ),
    };
  }
  const body: SystemOneRequest = { model: options.model, state: request.unit.state, questions };
  const serialized = JSON.stringify(body);
  const size = utf8ByteLength(serialized);
  if (size > SYSTEM_ONE_MAX_BODY_BYTES) {
    return {
      ok: false,
      refusal: refuseBeforeDispatch(
        'invalid-response',
        `request body is ${size} bytes; the dialect refuses more than ${SYSTEM_ONE_MAX_BODY_BYTES}`,
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

/** Reads one dispatch response into plan answers or a typed refusal. */
const readDispatchResponse = async (options: {
  response: { status: number; text(): Promise<string> };
  order: readonly DecisionQuestion[];
  inferenceMs: number;
  checkpoint: string;
}): Promise<DecisionAdapterResponse> => {
  const refusal = statusRefusal(options.response.status, options.inferenceMs);
  if (refusal !== undefined) {
    return refusal;
  }
  const body = await safeParse(options.response.text());
  const answered = answersFrom(body, options.order, options.inferenceMs);
  return answered.ok
    ? {
        ok: true,
        answers: answered.answers,
        queueMs: 0,
        inferenceMs: options.inferenceMs,
        checkpoint: options.checkpoint,
      }
    : answered;
};

/** Parses a response body without ever throwing on malformed JSON. */
const safeParse = async (text: Promise<string>): Promise<SystemOneResponse | undefined> => {
  try {
    return parseSystemOneResponse(JSON.parse(await text));
  } catch {
    return undefined;
  }
};

/**
 * Probes one endpoint for dialect readiness, under the caller's budget.
 *
 * The version floor is checked only for a runtime that HAS one. C-566 reported
 * `ready: true` as soon as `/api/version` answered 200 — which is exactly wrong
 * for an Ollama below the floor, and exactly unavailable on a generic Jev server
 * that serves no such route at all. Neither case is decided here: the runtime
 * probe owns it, and the sample decision in `readiness.ts` remains the only
 * proof a checkpoint can answer.
 */
const probeCapability = async (options: {
  base: DecisionCapability;
  runtime: DecisionRuntimeKind;
  transport: SystemOneTransport;
  endpoints: SystemOneEndpoints;
  model: string;
  probeTimeoutMs: number;
  authHeaders?: SystemOneAdapterOptions['authHeaders'];
  probe?: Pick<DecisionRequest, 'deadlineAt' | 'signal'>;
}): Promise<DecisionCapability> => {
  const budget = Math.min(
    options.probeTimeoutMs,
    options.probe ? remainingMs(options.probe.deadlineAt) : options.probeTimeoutMs,
  );
  const budgetRefusal = budgetRefusalFor({
    aborted: options.probe?.signal.aborted === true,
    budget,
  });
  if (budgetRefusal !== undefined) {
    return notReady(options.base, options.runtime, budgetRefusal);
  }
  const result = await probeDecisionRuntime({
    runtime: options.runtime,
    transport: options.transport,
    endpoints: options.endpoints,
    model: options.model,
    budgetMs: budget,
    signal: options.probe?.signal ?? new AbortController().signal,
    ...(options.authHeaders === undefined ? {} : { authHeaders: options.authHeaders }),
  });
  if (!result.ok) {
    return notReady(options.base, options.runtime, {
      reason: result.reason,
      state: result.state,
      ...(result.runtime === undefined ? {} : { runtime: result.runtime }),
    });
  }
  return {
    ...options.base,
    ready: true,
    runtime: result.runtime,
    checkpoint: result.listed.name,
  };
};

/**
 * Builds the adapter.
 *
 * @param options.transport - Defaults to `globalThis.fetch`. Injected in tests
 *   so the wire contract can be verified without a running backend.
 */
export const createSystemOneDecisionAdapter = (
  options: SystemOneAdapterOptions,
): DecisionAdapter => {
  const transport: SystemOneTransport = options.transport ?? {
    fetch: (input, init) => globalThis.fetch(input, init),
  };
  const probeTimeoutMs = options.probeTimeoutMs ?? 2000;
  const backendId = decisionBackendId({
    runtime: options.runtime,
    endpoint: options.endpoints.decision,
    model: options.model,
  });
  const limits: DecisionLimits = { ...JEV_DECISION_LIMITS, ...options.limits };

  const baseCapability = (): DecisionCapability => ({
    backendId,
    dialect: SYSTEM_ONE_DIALECT,
    ready: false,
    primitives: ['boolean', 'choice', 'combination'],
    maxOptions: limits.maxOptions,
    maxQuestions: limits.maxQuestions,
    maxContextBytes: limits.maxContextBytes,
    languages: options.languages,
    checkpoint: options.model,
  });

  return {
    backendId,
    dialect: SYSTEM_ONE_DIALECT,

    async capability(
      probe?: Pick<DecisionRequest, 'deadlineAt' | 'signal'>,
    ): Promise<DecisionCapability> {
      return probeCapability({
        base: baseCapability(),
        runtime: options.runtime,
        transport,
        endpoints: options.endpoints,
        model: options.model,
        probeTimeoutMs,
        ...(options.authHeaders === undefined ? {} : { authHeaders: options.authHeaders }),
        ...(probe === undefined ? {} : { probe }),
      });
    },

    async run(request: DecisionRequest): Promise<DecisionAdapterResponse> {
      const started = Date.now();
      const prepared = prepareRequest({ request, model: options.model });
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
        const inferenceMs = Date.now() - started;
        return readDispatchResponse({ response, order, inferenceMs, checkpoint: options.model });
      } catch (error) {
        return transportFailure({ error, request, started });
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener('abort', onAbort);
      }
    },
  };
};
