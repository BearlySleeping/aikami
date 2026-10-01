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
import { probeSystemOneBackend } from '../systemone_readiness.ts';
import type {
  DecisionAnswer,
  DecisionCapability,
  DecisionDispatchUnit,
  DecisionPlan,
  DecisionQuestion,
} from '../types.ts';
import { utf8ByteLength } from '../util.ts';
import type { DecisionAdapter, DecisionAdapterResponse, DecisionRequest } from './types.ts';

/** Transport endpoints the adapter needs. All caller-supplied; nothing is assumed. */
export type SystemOneEndpoints = {
  /** Decision endpoint, e.g. `http://127.0.0.1:11434/v1/systemone`. */
  readonly decision: string;
  /** Runtime version probe, e.g. `http://127.0.0.1:11434/api/version`. */
  readonly version: string;
  /** Model listing, e.g. `http://127.0.0.1:11434/v1/models`. */
  readonly models?: string;
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
  readonly endpoints: SystemOneEndpoints;
  /** Checkpoint to request. Reported verbatim in provenance. */
  readonly model: string;
  /** Languages the checkpoint declares. */
  readonly languages: DecisionCapability['languages'];
  /** Read timeout for the readiness probe, in ms. */
  readonly probeTimeoutMs?: number;
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

/** Invalid JSON is a response failure, independent of transport availability. */
const parseResponseText = (text: string): SystemOneResponse | undefined => {
  try {
    return parseSystemOneResponse(JSON.parse(text));
  } catch {
    return undefined;
  }
};

/** Milliseconds remaining before the absolute deadline, floored at zero. */
const remainingMs = (deadlineAt: number): number => Math.max(0, deadlineAt - Date.now());

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

  return {
    backendId: `systemone:${options.model}`,
    dialect: SYSTEM_ONE_DIALECT,

    async capability(
      probe?: Pick<DecisionRequest, 'deadlineAt' | 'signal'>,
    ): Promise<DecisionCapability> {
      const base: DecisionCapability = {
        backendId: `systemone:${options.model}`,
        dialect: SYSTEM_ONE_DIALECT,
        ready: false,
        primitives: ['boolean', 'choice', 'combination'],
        maxOptions: Number.MAX_SAFE_INTEGER,
        maxQuestions: Number.MAX_SAFE_INTEGER,
        maxContextBytes: SYSTEM_ONE_MAX_BODY_BYTES,
        languages: options.languages,
        checkpoint: options.model,
      };

      const budget = Math.min(
        probeTimeoutMs,
        probe ? remainingMs(probe.deadlineAt) : probeTimeoutMs,
      );
      if (probe?.signal.aborted || budget === 0) {
        return { ...base, notReadyReason: 'probe cancelled or deadline exceeded' };
      }

      // C-566 reported `ready: true` as soon as `/api/version` answered 200.
      // That is the false-ready bug: this machine runs Ollama 0.34.3, whose
      // version route answers 200 while `/v1/systemone` answers 404. Readiness
      // now requires the real dialect probe — version floor, then checkpoint
      // availability, then an advertised decision-scoring capability.
      //
      // This still does NOT prove the checkpoint can answer: only a sample
      // decision does, and `probeDecisionBackend` owns that.
      const result = await probeSystemOneBackend({
        transport,
        endpoints: options.endpoints,
        model: options.model,
        budgetMs: budget,
        signal: probe?.signal ?? new AbortController().signal,
      });

      if (!result.ok) {
        return { ...base, runtime: result.runtime, notReadyReason: result.reason };
      }
      return {
        ...base,
        ready: true,
        runtime: result.runtime,
        checkpoint: result.listed.name,
      };
    },

    async run(request: DecisionRequest): Promise<DecisionAdapterResponse> {
      const started = Date.now();
      if (request.signal.aborted) {
        return {
          ok: false,
          reason: 'cancelled',
          detail: 'cancelled before dispatch',
          queueMs: 0,
          inferenceMs: 0,
        };
      }

      const { questions, order } = buildWireQuestions({ unit: request.unit, plan: request.plan });
      if (order.length === 0) {
        return {
          ok: false,
          reason: 'invalid-response',
          detail: 'no question in this unit is expressible in the jev-v1 dialect',
          queueMs: 0,
          inferenceMs: 0,
        };
      }

      const body: SystemOneRequest = { model: options.model, state: request.unit.state, questions };
      const serialized = JSON.stringify(body);
      const size = utf8ByteLength(serialized);
      if (size > SYSTEM_ONE_MAX_BODY_BYTES) {
        return {
          ok: false,
          reason: 'invalid-response',
          detail: `request body is ${size} bytes; the dialect refuses more than ${SYSTEM_ONE_MAX_BODY_BYTES}`,
          queueMs: 0,
          inferenceMs: 0,
        };
      }

      const budget = remainingMs(request.deadlineAt);
      if (budget === 0) {
        return {
          ok: false,
          reason: 'deadline-exceeded',
          detail: 'deadline already passed at dispatch',
          queueMs: 0,
          inferenceMs: 0,
        };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), budget);
      const onAbort = (): void => controller.abort();
      request.signal.addEventListener('abort', onAbort, { once: true });

      try {
        const response = await transport.fetch(options.endpoints.decision, {
          method: 'POST',
          body: serialized,
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
        });
        const inferenceMs = Date.now() - started;
        const refusal = statusRefusal(response.status, inferenceMs);
        if (refusal !== undefined) {
          return refusal;
        }
        const answered = answersFrom(parseResponseText(await response.text()), order, inferenceMs);
        if (!answered.ok) {
          return answered;
        }
        return {
          ok: true,
          answers: answered.answers,
          queueMs: 0,
          inferenceMs,
          checkpoint: options.model,
        };
      } catch (error) {
        return transportFailure({ error, request, started });
      } finally {
        clearTimeout(timer);
        request.signal.removeEventListener('abort', onAbort);
      }
    },
  };
};
