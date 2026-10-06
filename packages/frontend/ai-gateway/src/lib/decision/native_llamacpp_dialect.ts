// packages/frontend/ai-gateway/src/lib/decision/native_llamacpp_dialect.ts
//
// The NATIVE llama.cpp `/v1/systemone` wire shape (issue #381).
//
// This is deliberately a SEPARATE dialect from `dialect.ts` (`jev-v1`, served
// by Ollama 0.35.0+). They share a route name and almost nothing else, and
// pretending otherwise produced a real defect:
//
//   | fact                | jev-v1 (Ollama)          | native llama.cpp          |
//   |---------------------|--------------------------|---------------------------|
//   | request `model`     | required                 | NOT part of the contract   |
//   | `noul` answer       | `answers[q].value` bool  | `answers[q].noul` NUMBER   |
//   | `noul` probabilities| present                  | absent by construction     |
//   | `noul` confidence   | present                  | absent by construction     |
//   | non-decision model  | n/a                      | HTTP 501                  |
//   | `output_tokens`     | runtime-defined          | ALWAYS 0                   |
//   | option ceiling      | runtime-defined          | PER CHECKPOINT (52 / 255)  |
//
// The `noul` row is the important one. A native server answers a `noul` question
// with the PROBABILITY THAT THE ANSWER IS TRUE — a float in [0, 1] — and there
// is no boolean anywhere on the wire. Reading `answers[q].value` as a boolean
// yields `undefined`, every boolean decision abstains, and the failure looks
// like a policy refusal rather than a wire mismatch. `dialect.ts` describes the
// jev-v1 shape only; this file describes what llama.cpp actually answers.
//
// Contract source, verified at the pinned commit `a4cb4c61` (upstream PR
// #29818): `tools/server/README.md` ("TypeSafe-compatible API Endpoints") and
// `tools/server/tests/unit/test_systemone.py`. Fixtures below are transcribed
// from those two documents, not invented.
//
// Scope: `choice` and `noul` only. Upstream also serves `score`, and it serves
// image input, and Aikami's eligible decision-schema scope is neither. `score`
// and image questions are REFUSED here with a named reason. Upstream supporting
// a structure is not a reason to widen what Aikami is willing to send.

/** The dialect identifier reported in provenance for native llama.cpp. */
export const NATIVE_LLAMACPP_DIALECT = 'typesafe-systemone-v1';

/**
 * Upstream merge commit of the native endpoint (ggml-org/llama.cpp#29818).
 *
 * Pinned because "our llama.cpp supports /v1/systemone" is otherwise unfalsifiable:
 * any build predating this commit answers 404, and an old binary or a stale
 * container digest is not evidence that the route exists.
 */
export const NATIVE_LLAMACPP_MIN_BUILD_COMMIT = 'a4cb4c61fd9d9c2066c7c1747821d3d65b8943bd';

/**
 * Upstream PR that introduced it, for a player-facing reference.
 * Supports laya, julia-1, lev, openjev and kev.
 */
export const NATIVE_LLAMACPP_UPSTREAM_PR = 'https://github.com/ggml-org/llama.cpp/pull/29818';

/**
 * Request body byte ceiling before this client refuses to send.
 *
 * Upstream does not publish a body limit for `/v1/systemone`; this is OUR
 * transport ceiling, chosen well below any plausible server limit so a refusal
 * happens locally and cheaply rather than as an opaque upstream error. It is
 * deliberately not presented as a checkpoint limit.
 */
export const NATIVE_LLAMACPP_MAX_REQUEST_BYTES = 64 * 1024;

/** Question primitives this adapter will put on the wire. */
export type NativeQuestionPrimitive = 'choice' | 'noul';

/**
 * The primitives upstream serves that Aikami does NOT send.
 *
 * Declared as data, not as a comment, so the settings UI can say what is
 * refused and why instead of reporting a generic schema error.
 */
export const NATIVE_LLAMACPP_UNSUPPORTED_PRIMITIVES = {
  score:
    'upstream serves `score` (2-10 ordered levels) but Aikami has no eligible ' +
    'decision schema for it; refusing rather than widening application scope',
  image:
    'image input requires a multimodal projector and is not part of the eligible ' +
    'decision-schema scope',
} as const satisfies Readonly<Record<string, string>>;

/** One question exactly as native llama.cpp accepts it. */
export type NativeQuestion =
  | {
      readonly type: 'choice';
      readonly instructions: string;
      /** Option key -> description. Upstream allows `null` as a description. */
      readonly criteria: Readonly<Record<string, string | null>>;
    }
  | {
      readonly type: 'noul';
      readonly instructions: string;
      /**
       * Optional upstream. Descriptions of `true` and `false`.
       *
       * Carried when the plan has a question worth naming, omitted otherwise —
       * upstream rejects a `noul` question with no `instructions` (400) but
       * accepts one with no `criteria`.
       */
      readonly criteria?: Readonly<{ readonly true: string; readonly false: string }>;
    };

/**
 * Request body of native `POST /v1/systemone`.
 *
 * NOTE the absent `model`. Native llama.cpp serves the model the SERVER was
 * started with; there is no per-request checkpoint selection, and inventing a
 * `model` field would be asserting a capability the contract does not have.
 * Checkpoint identity therefore comes from the RESPONSE (`model`) and from the
 * server process, never from the request.
 */
export type NativeRequest = {
  readonly state: string;
  readonly questions: Readonly<Record<string, NativeQuestion>>;
};

/** One answer exactly as native llama.cpp returns it. */
export type NativeAnswer = {
  readonly type: string;
  /** `choice`: the criteria key with the highest probability. */
  readonly choice?: string;
  /** `choice`: per-option probabilities; upstream states these sum to 1. */
  readonly probabilities?: Readonly<Record<string, number>>;
  /**
   * `choice`: 0..1, where 0 means all options are equally likely.
   *
   * NOT a probability of correctness, and NOT a substitute for `noul`.
   */
  readonly confidence?: number;
  /**
   * `noul`: THE PROBABILITY THAT THE ANSWER IS TRUE, in [0, 1].
   *
   * This is the whole boolean wire contract. There is no `value` field on a
   * native `noul` answer.
   */
  readonly noul?: number;
  /** `score`: expected level index. Never requested by this adapter. */
  readonly score?: number;
  /** `score`: level index -> description. Never requested by this adapter. */
  readonly legend?: Readonly<Record<string, string>>;
};

/**
 * Usage, as the dialect spells it.
 *
 * `output_tokens` is ALWAYS 0 for decision inference: the model emits no tokens,
 * it reads the prompt and scores it. A telemetry path that treats a zero here as
 * "nothing happened" or that prices it as a degenerate generation reports the
 * opposite of what happened.
 */
export type NativeUsage = {
  // biome-ignore lint/style/useNamingConvention: verbatim wire field name
  readonly input_tokens?: number;
  // biome-ignore lint/style/useNamingConvention: verbatim wire field name
  readonly output_tokens?: number;
};

/** Response body of native `POST /v1/systemone`. */
export type NativeResponse = {
  /** The model that answered, as the server spells it. */
  readonly model: string;
  readonly answers: Readonly<Record<string, NativeAnswer>>;
  readonly usage?: NativeUsage;
};

/**
 * Parsed body plus the server's error text when it sent one.
 *
 * Upstream answers an invalid request with 400 and a JSON body carrying
 * `{"error": "..."}`; keeping the text is what lets the settings UI say which
 * field was refused instead of only that something was.
 */
export type NativeParsedBody =
  | { readonly ok: true; readonly body: NativeResponse }
  | { readonly ok: false; readonly reason: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Reads the usage block.
 *
 * `output_tokens` is ALWAYS 0 upstream for a decision call: the model reads the
 * prompt and scores it, emitting nothing. It is recorded verbatim rather than
 * assumed, so a server that reported something else would be visible instead of
 * being silently normalised to zero.
 */
const readNativeUsage = (usage: Record<string, unknown>): NativeUsage => ({
  // biome-ignore lint/style/useNamingConvention: verbatim wire field name
  ...(typeof usage.input_tokens === 'number' ? { input_tokens: usage.input_tokens } : {}),
  // biome-ignore lint/style/useNamingConvention: verbatim wire field name
  ...(typeof usage.output_tokens === 'number' ? { output_tokens: usage.output_tokens } : {}),
});

/** Every answer must be a plain object carrying a string `type`. */
const answersAreShaped = (answers: unknown): answers is Record<string, NativeAnswer> => {
  if (!isRecord(answers)) {
    return false;
  }
  return Object.values(answers).every(
    (answer) => isRecord(answer) && typeof answer.type === 'string',
  );
};

/**
 * Extracts the human-readable part of an error response body.
 *
 * Measured against a running server: llama.cpp answers a refused request with
 * `{"error": {"code": 400, "message": "\"questions\" must be a non-empty object",
 * "type": "invalid_request_error"}}` — a nested OBJECT. A reader that accepts
 * only `{"error": "text"}` finds no error field, falls through to "the response
 * did not name the model that answered", and reports a bad request as a
 * malformed answer. Both spellings are accepted because a shim or proxy in front
 * of the server may use either.
 */
export const readNativeErrorMessage = (body: unknown): string | undefined => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return undefined;
  }
  const error = (body as Record<string, unknown>).error;
  if (typeof error === 'string') {
    return error.length > 0 ? error : undefined;
  }
  if (typeof error === 'object' && error !== null && !Array.isArray(error)) {
    const message = (error as Record<string, unknown>).message;
    return typeof message === 'string' && message.length > 0 ? message : undefined;
  }
  return undefined;
};

/**
 * Narrows an unknown parsed body to {@link NativeParsedBody}.
 *
 * Strict on the envelope and permissive on answer payloads: the per-answer
 * fields are validated by {@link readNativeNoul} / {@link readNativeChoice},
 * which know the question they asked, so a `noul` answer carrying a `choice`
 * key is caught with a specific reason rather than silently accepted.
 */
export const parseNativeResponse = (body: unknown): NativeParsedBody => {
  if (!isRecord(body)) {
    return { ok: false, reason: 'response body was not a JSON object' };
  }
  const error = readNativeErrorMessage(body);
  if (error !== undefined) {
    return { ok: false, reason: error };
  }
  if (typeof body.model !== 'string' || body.model.length === 0) {
    return { ok: false, reason: 'response did not name the model that answered' };
  }
  if (!answersAreShaped(body.answers)) {
    return { ok: false, reason: 'response `answers` was not a map of typed answers' };
  }
  const usage = isRecord(body.usage) ? readNativeUsage(body.usage) : undefined;
  return {
    ok: true,
    body: {
      model: body.model,
      answers: body.answers,
      ...(usage === undefined ? {} : { usage }),
    },
  };
};

/** A refusal from the native endpoint, with the reason it means. */
export type NativeRefusal = {
  readonly reason:
    | 'not-a-decision-model'
    | 'invalid-request'
    | 'request-too-large'
    | 'unauthorized'
    | 'backend-unavailable';
  readonly detail: string;
};

/**
 * Whether a server error message is upstream's batch-layer overflow.
 *
 * Matched on the words upstream actually uses ("too large to process",
 * "batch size") rather than on the status alone, because the status alone does
 * not identify this failure. Deliberately case-insensitive and substring-based:
 * upstream has changed the exact wording between releases, and a missed match
 * degrades to the honest `backend-unavailable` rather than to a wrong fix.
 */
const isBatchOverflowMessage = (body: string | undefined): boolean => {
  if (body === undefined) {
    return false;
  }
  const text = body.toLowerCase();
  return text.includes('too large to process') || text.includes('batch size');
};

/**
 * Maps an HTTP status onto a refusal.
 *
 * 501 is the load-bearing case: upstream returns it when the LOADED MODEL IS NOT
 * A DECISION MODEL. That is the server's own authoritative statement about the
 * checkpoint, obtained by asking rather than by pattern-matching a model name
 * or trusting a `/v1/models` listing — both of which happily list a chat GGUF
 * that will answer this route with 501.
 *
 * 400 is upstream's invalid-request refusal: a shape this adapter built, so it
 * is a bug report, not a player-facing incompatibility. It is ALSO not the status
 * an oversized question earns — llama.cpp raises that from the batch layer as a
 * 500 ("input is too large to process. increase the physical batch size"). That
 * is a different failure with a different fix, so it gets its own reason rather
 * than being folded into "bad request".
 *
 * @param status HTTP status of the refusal.
 * @param body Server-supplied error text, when one was read. Used ONLY to
 * disambiguate 500, which upstream uses for more than one failure.
 */
export const nativeStatusRefusal = (status: number, body?: string): NativeRefusal | undefined => {
  if (status === 200) {
    return undefined;
  }
  if (status === 501) {
    return {
      reason: 'not-a-decision-model',
      detail:
        'HTTP 501: the loaded checkpoint is not a decision model. Native /v1/systemone ' +
        'requires a purpose-trained decision checkpoint (laya, julia-1, lev, openjev or ' +
        'kev); a general chat GGUF cannot answer it.',
    };
  }
  if (status === 400) {
    return {
      reason: 'invalid-request',
      detail: 'HTTP 400: llama.cpp refused the request body as invalid',
    };
  }
  if (status === 500) {
    // 500 is upstream's generic server-error status, NOT a dedicated
    // "too large" code. Reporting every one of them as a batch-size overflow
    // would send an operator to raise `-ub` when the real fault is anywhere
    // else in the server — a bad template, an exhausted context slot, a failed
    // decode. Only the batch-layer message earns that diagnosis.
    if (isBatchOverflowMessage(body)) {
      return {
        reason: 'request-too-large',
        detail:
          'HTTP 500: llama.cpp could not batch the prompt. The assembled question exceeds the ' +
          "server's --ubatch-size, not the checkpoint's option ceiling. Reduce the context, or " +
          'start the server with a larger -ub.',
      };
    }
    return {
      reason: 'backend-unavailable',
      detail:
        body === undefined || body.length === 0
          ? 'HTTP 500: llama.cpp failed to serve the request, and reported no cause'
          : `HTTP 500: llama.cpp failed to serve the request: ${body}`,
    };
  }
  if (status === 401 || status === 403) {
    return { reason: 'unauthorized', detail: `HTTP ${status}` };
  }
  if (status === 413) {
    return {
      reason: 'invalid-request',
      detail: 'HTTP 413: llama.cpp refused the request body as too large',
    };
  }
  return { reason: 'backend-unavailable', detail: `HTTP ${status}` };
};

/**
 * Reads a `noul` answer into (probability of true, probability of false).
 *
 * The wire's `noul` is p(true) and nothing else. The pair is EXACT, not an
 * estimate: p(false) is its complement by construction, which is why it is safe
 * to hand to the task's existing threshold policy.
 *
 * Fails closed on: a missing `noul`, a non-finite value, a value outside [0, 1],
 * and a `noul` answer that carries a `value` field instead (the jev-v1 shape),
 * because a native server that answered in the other dialect is a proxy or a
 * shim and its numbers mean something else.
 */
export const readNativeNoul = (
  answer: NativeAnswer | undefined,
  questionKey: string,
):
  | { readonly ok: true; readonly pTrue: number; readonly pFalse: number }
  | { readonly ok: false; readonly detail: string } => {
  if (answer === undefined) {
    return { ok: false, detail: `no answer for "${questionKey}"` };
  }
  if (answer.type !== 'noul') {
    return {
      ok: false,
      detail: `asked a noul question for "${questionKey}" but the answer type is "${answer.type}"`,
    };
  }
  if ('value' in answer) {
    return {
      ok: false,
      detail:
        `answer for "${questionKey}" carries a boolean \`value\`; native llama.cpp answers ` +
        'noul questions with a numeric `noul` probability. This endpoint is not native.',
    };
  }
  const noul = answer.noul;
  if (typeof noul !== 'number') {
    return { ok: false, detail: `answer for "${questionKey}" has no numeric \`noul\` probability` };
  }
  if (!Number.isFinite(noul)) {
    return { ok: false, detail: `\`noul\` for "${questionKey}" is ${noul}, which is not finite` };
  }
  if (noul < 0 || noul > 1) {
    return {
      ok: false,
      detail: `\`noul\` for "${questionKey}" is ${noul}; a probability must lie in [0, 1]`,
    };
  }
  return { ok: true, pTrue: noul, pFalse: 1 - noul };
};

/**
 * Reads a `choice` answer into the chosen key plus its probability.
 *
 * Upstream states the per-option probabilities sum to 1; that is checked rather
 * than assumed, because a distribution that does not sum to 1 makes every
 * threshold comparison meaningless and would otherwise be accepted silently.
 */
export const readNativeChoice = (
  answer: NativeAnswer | undefined,
  questionKey: string,
  optionKeys: readonly string[],
):
  | { readonly ok: true; readonly optionKey: string; readonly probability: number }
  | { readonly ok: false; readonly detail: string } => {
  if (answer === undefined) {
    return { ok: false, detail: `no answer for "${questionKey}"` };
  }
  if (answer.type !== 'choice') {
    return {
      ok: false,
      detail: `asked a choice question for "${questionKey}" but the answer type is "${answer.type}"`,
    };
  }
  const choice = answer.choice;
  if (typeof choice !== 'string' || choice.length === 0) {
    return { ok: false, detail: `choice answer for "${questionKey}" named no option` };
  }
  if (!optionKeys.includes(choice)) {
    return {
      ok: false,
      detail: `choice answer for "${questionKey}" named "${choice}", which was not offered`,
    };
  }
  const probability = answer.probabilities?.[choice];
  if (typeof probability !== 'number' || !Number.isFinite(probability)) {
    return {
      ok: false,
      detail: `choice answer for "${questionKey}" carried no finite probability for "${choice}"`,
    };
  }
  if (probability < 0 || probability > 1) {
    return {
      ok: false,
      detail: `probability for "${questionKey}/${choice}" is ${probability}; expected [0, 1]`,
    };
  }
  return { ok: true, optionKey: choice, probability };
};

/**
 * Checks that a choice answer's probability distribution sums to 1.
 *
 * Upstream documents this invariant. Enforcing it here turns a silently
 * miscalibrated server into one typed refusal instead of thresholds applied to
 * numbers that do not mean what they claim.
 */
export const distributionSumsToOne = (
  probabilities: Readonly<Record<string, number>>,
  optionKeys: readonly string[],
): { readonly ok: true } | { readonly ok: false; readonly detail: string } => {
  let total = 0;
  for (const key of optionKeys) {
    const value = probabilities[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, detail: `probability for option "${key}" is missing or not finite` };
    }
    total += value;
  }
  return Math.abs(total - 1) <= 1e-3
    ? { ok: true }
    : { ok: false, detail: `option probabilities sum to ${total.toFixed(6)}, not 1` };
};
