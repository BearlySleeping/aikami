// packages/frontend/ai-gateway/src/lib/decision/dialect.ts
//
// The `/v1/systemone`-compatible wire shape (issue #381, contract C-566).
//
// This is the ONLY file that knows a vendor DTO exists. It is deliberately
// quarantined so a business schema, a task policy or a plan can never acquire a
// dependency on one runtime's request body, and so two runtimes that happen to
// share a route can still be told apart by `dialect`.
//
// "Speaks this dialect" is not "is this model". A dialect describes a shape; a
// checkpoint describes a distribution. Both are reported separately in
// `DecisionCapability`, and equating them is how a benchmark ends up comparing
// two very different models and calling the result a runtime comparison.

/** Wire question primitives. `score` is intentionally absent. */
export type SystemOnePrimitive = 'choice' | 'noul';

/** One question as sent on the wire. */
export type SystemOneQuestion =
  | {
      readonly type: 'choice';
      readonly instructions: string;
      readonly criteria: Readonly<Record<string, string>>;
    }
  | { readonly type: 'noul'; readonly instructions: string };

/** Request body of `POST /v1/systemone`. */
export type SystemOneRequest = {
  readonly model: string;
  readonly state: string;
  readonly questions: Readonly<Record<string, SystemOneQuestion>>;
};

/** One answer as returned on the wire. */
export type SystemOneAnswer = {
  readonly type: string;
  /** Chosen criteria key, for `choice`. */
  readonly choice?: string;
  /** Answer for `noul`. */
  readonly value?: boolean;
  /**
   * Per-criteria probabilities from the model's own head.
   *
   * NOT the probability that the answer is correct. Calibration is a property
   * of (checkpoint, task, context distribution) and must be measured per task.
   */
  readonly probabilities?: Readonly<Record<string, number>>;
  /** The model's own reported confidence. Also not a correctness probability. */
  readonly confidence?: number;
};

/**
 * Token accounting as the dialect spells it.
 *
 * `input_tokens` / `output_tokens` are the wire's own names, kept verbatim and
 * exempt from the camelCase rule: renaming a DTO field to satisfy a linter
 * would make the shape stop describing the shape.
 */
export type SystemOneUsage = {
  // biome-ignore lint/style/useNamingConvention: verbatim wire field name
  readonly input_tokens?: number;
  // biome-ignore lint/style/useNamingConvention: verbatim wire field name
  readonly output_tokens?: number;
};

/** Response body of `POST /v1/systemone`. */
export type SystemOneResponse = {
  readonly model: string;
  readonly answers: Readonly<Record<string, SystemOneAnswer>>;
  readonly usage?: SystemOneUsage;
  readonly error?: string;
};

/**
 * Dialect identifiers.
 *
 * `jev-v1` is the shape served by Ollama's `/v1/systemone` (Ollama >= 0.35.0)
 * and by laya.cpp's JEV-compatible endpoint. Naming the shape rather than the
 * vendor is what lets one adapter serve both without pretending they run the
 * same checkpoint.
 */
export const SYSTEM_ONE_DIALECT = 'jev-v1';

/** Hard body bound advertised by the `/v1/systemone` endpoints we know. */
export const SYSTEM_ONE_MAX_BODY_BYTES = 64 * 1024;

/** Narrows an unknown parsed body to a {@link SystemOneResponse}. */
export const parseSystemOneResponse = (body: unknown): SystemOneResponse | undefined => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record.model !== 'string' ||
    typeof record.answers !== 'object' ||
    record.answers === null ||
    Array.isArray(record.answers)
  ) {
    return undefined;
  }
  for (const answer of Object.values(record.answers)) {
    if (
      typeof answer !== 'object' ||
      answer === null ||
      Array.isArray(answer) ||
      (Object.getPrototypeOf(answer) !== Object.prototype &&
        Object.getPrototypeOf(answer) !== null) ||
      !('type' in answer) ||
      typeof answer.type !== 'string'
    ) {
      return undefined;
    }
  }
  return body as SystemOneResponse;
};
