// packages/frontend/ai-gateway/src/lib/native_options.ts
//
// Effective `TextParams` → Ollama native `options`.
//
// Two facts from the wire make this module the shape it is (both measured on
// Ollama 0.34.3, `docs/research/audits/382-native-transport-plan.md`):
//
//   1. `buildGenerationParams` used to return `{}` for Ollama, so every one of
//      these settings was silently UNHONOURED on the native route. A
//      connection configured with `maxTokens: 400` was generating without a
//      limit, and reporting no limit and honouring one are not the same claim.
//
//   2. Ollama answers **`200` to an option it does not understand.** A probe
//      request carrying `totally_made_up_option: 5` succeeded silently. So
//      support cannot be discovered from the provider at request time, and a
//      "send it and see" strategy is indistinguishable from a working one.
//
// (2) is the load-bearing constraint, and it dictates an ALLOW-LIST: a
// `TextParams` field is mapped only if its native spelling was measured on this
// surface. Everything else is OMITTED FROM THE BODY and named in
// `NativeOptionsReport.unmapped`, so a caller can be told "this setting is not
// in effect" instead of it being assumed honoured. A field that is sent and
// ignored is worse than a field that is not sent, because it produces a
// configuration that reads as configured and behaves as default.
//
// The token cap deserves a warning. `num_predict` bounds TOTAL generated
// tokens, and on a reasoning model that budget is shared between the thinking
// channel and the visible answer. Turning on a limit that was never in effect
// can therefore truncate an answer that previously completed — the provider
// reports it as `done_reason: "length"`, and callers must treat that as a
// possible output-quality regression, not as a speed-up.

import type { TextParams } from '@aikami/types';

/** A `TextParams` field, named for reporting. */
export type NativeOptionField = keyof TextParams;

/**
 * Fields with a MEASURED native spelling on Ollama 0.34.3.
 *
 * `presencePenalty` is deliberately absent: Ollama has no equivalent, and
 * OpenAI's `presence_penalty` is not accepted as a native option. It is
 * reported as unmapped rather than approximated — a repetition penalty is not a
 * presence penalty, and substituting one would change generation behaviour
 * under a name that claims otherwise.
 */
const MAPPED_FIELDS: Partial<Record<NativeOptionField, string>> = {
  maxTokens: 'num_predict',
  temperature: 'temperature',
  topP: 'top_p',
  topK: 'top_k',
  repetitionPenalty: 'repeat_penalty',
  contextSize: 'num_ctx',
};

/** The report accompanying a built `options` object. */
export type NativeOptionsReport = {
  /** The body fragment to merge into the request. */
  readonly options: Record<string, unknown>;
  /** Fields that took effect, as `TextParams` name → native name. */
  readonly mapped: readonly (readonly [NativeOptionField, string])[];
  /**
   * Fields deliberately NOT sent, because this surface has no measured native
   * spelling for them.
   *
   * Present in the report and not in the body on purpose. A setting that is
   * absent and a setting that is ignored look identical on the wire, so the only
   * honest place to record the difference is here.
   */
  readonly unmapped: readonly NativeOptionField[];
  /**
   * Fields dropped for being out of range rather than for being unmappable.
   *
   * Kept separate from `unmapped` because they are a different defect: an
   * unmapped field is a platform limitation, a rejected value is bad config.
   */
  readonly rejected: readonly NativeOptionField[];
  /**
   * The effective `num_predict` that was sent, when one was.
   *
   * Surfaced so a truncation can be attributed to this decision rather than
   * guessed at from a short output.
   */
  readonly effectiveMaxTokens?: number;
};

/** Numeric guard, so a bad config is reported rather than forwarded. */
const isUsable = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;

/**
 * The narrowest cap that can apply, from at most two candidates.
 *
 * Returns `undefined` when either candidate is present and unusable, so a
 * connection configured with a nonsensical cap cannot silently widen the
 * task's limit — the request reports nothing sent and the reason is visible.
 * Returns `undefined` when NEITHER is present, which is the honest "no cap
 * configured" answer; the native default then applies, unchanged from before.
 */
export const resolveNativeMaxTokens = (options: {
  connectionCap?: number;
  taskCap?: number;
}): number | undefined => {
  const { connectionCap, taskCap } = options;
  const present = [connectionCap, taskCap].filter((value): value is number => value !== undefined);
  if (present.length === 0) {
    return undefined;
  }
  if (present.some((value) => !isUsable(value, 1, 1_000_000) || !Number.isInteger(value))) {
    // A fractional cap is a different quantity wearing the same field name.
    // Flooring it would invent a limit the user never set.
    return undefined;
  }
  // min(connection cap, task cap): neither may widen the other.
  return Math.floor(Math.min(...present));
};

/**
 * Builds the native `options` object for one request.
 *
 * `taskCap` is the per-task preset's `maxTokens`; `connectionCap` is the
 * configured connection's. Both are respected, and the narrower one wins.
 * `effectiveMaxTokens` is echoed back so the caller can attribute a truncated
 * completion to this decision.
 */
export const buildNativeOptions = (options?: {
  params?: TextParams;
  /** Narrower cap from the task preset, when it declares one. */
  taskCap?: number;
  /** Whether to send `num_ctx` at all. Off by default — see `contextSize`. */
  includeContextSize?: boolean;
}): NativeOptionsReport => {
  const params = options?.params;
  const mapped: Array<readonly [NativeOptionField, string]> = [];
  const unmapped: NativeOptionField[] = [];
  const rejected: NativeOptionField[] = [];
  const body: Record<string, unknown> = {};

  if (params === undefined) {
    return { options: body, mapped, unmapped, rejected };
  }

  /**
   * Sends one field when its measured spelling exists and its value is sane.
   *
   * `integer` distinguishes the two kinds of parameter. `num_predict`,
   * `top_k` and `num_ctx` are counts and must be whole numbers; `temperature`,
   * `top_p` and `repeat_penalty` are continuous knobs and must NOT be rounded.
   * Flooring `temperature: 0.7` to `0` would silently make generation greedy
   * and deterministic — a change in creative output that looks like a
   * performance fix.
   */
  const send = (
    field: NativeOptionField,
    value: unknown,
    minimum: number,
    maximum: number,
    integer: boolean,
  ): void => {
    const nativeName = MAPPED_FIELDS[field];
    if (nativeName === undefined) {
      unmapped.push(field);
      return;
    }
    if (typeof value !== 'number') {
      rejected.push(field);
      return;
    }
    if (!isUsable(value, minimum, maximum)) {
      rejected.push(field);
      return;
    }
    body[nativeName] = integer ? Math.floor(value) : value;
    mapped.push([field, nativeName] as const);
  };

  // `maxTokens` is resolved from BOTH the connection and the task preset before
  // it is sent, so the cap that reaches the provider is the narrowest one that
  // was asked for.
  const effectiveMaxTokens = resolveNativeMaxTokens({
    ...(params.maxTokens === undefined ? {} : { connectionCap: params.maxTokens }),
    ...(options?.taskCap === undefined ? {} : { taskCap: options.taskCap }),
  });
  if (effectiveMaxTokens !== undefined) {
    body.num_predict = effectiveMaxTokens;
    mapped.push(['maxTokens', 'num_predict'] as const);
  } else if (params.maxTokens !== undefined) {
    rejected.push('maxTokens');
  }

  send('temperature', params.temperature, 0, 2, false);
  send('topP', params.topP, 0, 1, false);
  send('topK', params.topK, 0, 1_000, true);
  send('repetitionPenalty', params.repetitionPenalty, 0, 2, false);

  // `num_ctx` resizes the KV cache. It is a DEVICE-RESIDENCY decision, not a
  // per-request sampling preference, and sending it on every call would
  // reallocate the context on requests that did not need it. It is therefore
  // opt-in and off by default, which is a deliberate non-change: the request
  // body stays as it was rather than growing a field whose effect was not
  // measured here.
  if (options?.includeContextSize === true) {
    send('contextSize', params.contextSize, 512, 1_048_576, true);
  } else if (params.contextSize !== undefined) {
    unmapped.push('contextSize');
  }

  // `presencePenalty` has no native spelling on this surface.
  if (params.presencePenalty !== undefined) {
    unmapped.push('presencePenalty');
  }

  return {
    options: body,
    mapped,
    unmapped,
    rejected,
    ...(effectiveMaxTokens === undefined ? {} : { effectiveMaxTokens }),
  };
};
