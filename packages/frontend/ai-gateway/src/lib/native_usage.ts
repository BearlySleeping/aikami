// packages/frontend/ai-gateway/src/lib/native_usage.ts
//
// Ollama's NATIVE token accounting, in its own field names.
//
// Kept in its own module, and not folded into the OpenAI-compatible reader in
// `structured.ts`, for two reasons. `structured.ts` is owned by a different lane
// in this program and is being edited in parallel, so a shared file would be a
// merge hazard rather than a deduplication. And the shapes are genuinely
// different: OpenAI reports a `usage` block whose `prompt_tokens` is a TOTAL
// including any cached portion, while Ollama reports three independent counters
// on the top level. A single reader over both would have to branch on a
// heuristic, and a heuristic in an accounting path is how a fabricated zero gets
// into a cost column.
//
// Measured on Ollama 0.34.3 (see `docs/research/audits/382-native-transport-plan.md`):
// `prompt_eval_cached_count` IS present, and it is NOT always zero — a warm
// streamed call reported 18 against `prompt_eval_count 22`. Current official
// documentation for newer releases describes capabilities this pinned runtime
// may not have; the wire is the authority, and an absent counter stays unknown.

import type { AiTextUsage } from './gateway_types.ts';

/** Ollama's counters, in its own field names. */
type NativeCounters = {
  // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
  prompt_eval_count?: unknown;
  // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
  eval_count?: unknown;
  /**
   * Cached prompt tokens.
   *
   * Present on 0.34.3. Newer releases document it; an older runtime omits it
   * entirely, which is a different fact from reporting zero, and is recorded
   * as unknown rather than as "no cache".
   */
  // biome-ignore lint/style/useNamingConvention: Ollama API contract field name
  prompt_eval_cached_count?: unknown;
};

/**
 * True when a value is a plausible token count.
 *
 * Integers only, and non-negative. A fractional or negative count is a provider
 * bug or a different quantity wearing the same field name, and recording it
 * would put a fabricated figure into the cost column.
 */
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;

/**
 * Reads Ollama's native counters off one frame.
 *
 * Returns `undefined` unless BOTH `prompt_eval_count` and `eval_count` are
 * present and valid. A partial pair is not a smaller count — reporting half of
 * a total as if it were the total is the exact failure this guards.
 *
 * `partial: true` marks counters that do not cover the whole dispatched attempt
 * — a stream that ended before its `done` frame, or a frame from a superseded
 * attempt. Known numbers plus an unknown remainder must never be presented as a
 * complete total.
 */
export const readNativeUsage = (
  payload: unknown,
  options?: { partial?: boolean },
): AiTextUsage | undefined => {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const counters = payload as NativeCounters;
  if (!isCount(counters.prompt_eval_count) || !isCount(counters.eval_count)) {
    return undefined;
  }
  const cached = counters.prompt_eval_cached_count;
  const hasCached = isCount(cached);
  return {
    inputTokens: counters.prompt_eval_count,
    outputTokens: counters.eval_count,
    // Absent cached counter => 'unknown'. Never defaulted to 0, which would
    // read as "this call reused no cache" on a runtime that simply does not
    // report the field.
    cachedSource: hasCached ? 'provider' : 'unknown',
    ...(hasCached ? { cachedTokens: cached } : {}),
    source: 'provider',
    ...(options?.partial === true ? { partial: true } : {}),
  };
};

/**
 * Ollama's own phase timings, in NANOSECONDS, converted to milliseconds.
 *
 * Present only where the provider sent them. An absent counter is unknown, not
 * zero: "the provider said 0 ms of prefill" and "the provider said nothing about
 * prefill" are different claims, and collapsing them makes a cached-model call
 * look like a cold one.
 */
export type NativePhaseTimings = {
  /** Model load into the runtime. */
  readonly modelLoadMs?: number;
  /** Prompt evaluation (prefill). */
  readonly prefillMs?: number;
  /** Token generation. */
  readonly generationMs?: number;
  /** The provider's own total. */
  readonly providerTotalMs?: number;
};

const nanos = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value / 1e6)
    : undefined;

/**
 * Reads the native phase timings off one frame.
 *
 * The nanosecond conversion lives here, at the single point where a raw
 * provider value becomes a millisecond, so no caller can forget it and report
 * prefill as a million times too large.
 */
export const readNativePhaseTimings = (payload: unknown): NativePhaseTimings => {
  if (typeof payload !== 'object' || payload === null) {
    return {};
  }
  const record = payload as Record<string, unknown>;
  const load = nanos(record.load_duration);
  const prefill = nanos(record.prompt_eval_duration);
  const generation = nanos(record.eval_duration);
  const total = nanos(record.total_duration);
  return {
    ...(load === undefined ? {} : { modelLoadMs: load }),
    ...(prefill === undefined ? {} : { prefillMs: prefill }),
    ...(generation === undefined ? {} : { generationMs: generation }),
    ...(total === undefined ? {} : { providerTotalMs: total }),
  };
};

/**
 * Sums the accounting of two attempts on one logical request.
 *
 * When a structured attempt is rejected and the adapter retries, the provider
 * BILLED both. Keeping only the surviving attempt's numbers under-reports real
 * spend by whatever the discarded one cost, so both are counted.
 *
 * Two properties are preserved rather than smoothed over:
 *   - `partial` survives if EITHER side was partial, because the sum of one
 *     known half and one unknown half is still not a complete total;
 *   - `cachedSource` degrades to `'unknown'` if only one side reported a
 *     cached count, because a sum with an unknown component is unknown, not
 *     provider-reported.
 */
export const combineNativeUsage = (options: {
  first?: AiTextUsage;
  second?: AiTextUsage;
}): AiTextUsage | undefined => {
  const { first, second } = options;
  if (first === undefined) {
    return second;
  }
  if (second === undefined) {
    return first;
  }
  const bothCached = first.cachedTokens !== undefined && second.cachedTokens !== undefined;
  return {
    inputTokens: first.inputTokens + second.inputTokens,
    outputTokens: first.outputTokens + second.outputTokens,
    ...(bothCached
      ? { cachedTokens: first.cachedTokens + second.cachedTokens, cachedSource: 'provider' }
      : { cachedSource: 'unknown' }),
    source: first.source === 'provider' && second.source === 'provider' ? 'provider' : 'estimated',
    ...(first.partial === true || second.partial === true ? { partial: true } : {}),
  };
};
