// packages/shared/constants/src/lib/text_pricing.ts
//
// Versioned text-model pricing metadata and cost estimation.
//
// Rules this file exists to enforce (issue #382):
//
//   - Token COUNTS come from the provider when it reports usage; only the
//     character-based estimate is ours. `TextCostEstimate.source` says which.
//   - Token PRICES come from a versioned table. A model absent from the table
//     yields `usd: undefined` and `source: 'unknown'` — never a guess and
//     never a fabricated "cache saving" derived from provider marketing.
//   - An on-device (offline) route has no marginal provider bill, which is a
//     fact about the route rather than a price guess, so it reports `local`.
//
// Contract: issue #382 P0 instrumentation.

import { type TextTask, type TextTaskPriority, textTaskPreset } from './text_task.ts';

// ---------------------------------------------------------------------------
// Versioned price table
// ---------------------------------------------------------------------------

/**
 * Identifies the price table a cost figure was computed from.
 *
 * Bump this whenever a rate changes, so a recorded figure can always be traced
 * back to the rates that produced it.
 */
export const TEXT_PRICING_VERSION = '2026-09-28.1';

/** Per-million-token rates in USD for one model. */
export type TextModelPricing = {
  /** USD per 1M uncached input tokens. */
  inputPerMillionUsd: number;
  /** USD per 1M output tokens. */
  outputPerMillionUsd: number;
  /** USD per 1M provider-cached input tokens, when the provider prices them. */
  cachedInputPerMillionUsd?: number;
};

/**
 * Known per-model rates, keyed by the lowercased model id.
 *
 * This is a deliberately SMALL, auditable table. A model that is not listed is
 * unknown-cost, not zero-cost: adding a rate here is a reviewed change, and
 * rates are re-checked against provider billing on each version bump.
 */
export const TEXT_MODEL_PRICING: Readonly<Record<string, TextModelPricing>> = {
  // Local / on-device. No marginal provider bill — handled by route, not price.
  'local-qwen3': { inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
  local: { inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
} as const;

/** Where a cost figure's provenance, and whether it exists at all. */
export type TextCostSource = 'priced' | 'local' | 'unknown';

/** One cost figure plus the provenance needed to interpret it. */
export type TextCostEstimate = {
  /** USD cost, or `undefined` when the price is genuinely unknown. */
  readonly usd: number | undefined;
  /** `priced` = rate table; `local` = on-device route; `unknown` = no rate. */
  readonly source: TextCostSource;
  /** Price table version the figure came from; `undefined` when unknown. */
  readonly pricingVersion: string | undefined;
};

// ---------------------------------------------------------------------------
// Estimation
// ---------------------------------------------------------------------------

/** Routes served by an on-device engine, which have no marginal provider bill. */
const LOCAL_ROUTE_PROVIDERS: ReadonlySet<string> = new Set([
  'local-qwen3',
  'local',
  'local-tasks',
  'ollama',
  'llamacpp',
  'ooba',
  'ollama',
]);

/** True when a provider is an on-device route rather than a billed endpoint. */
export const isLocalTextRoute = (provider: string): boolean =>
  LOCAL_ROUTE_PROVIDERS.has(provider.trim().toLowerCase());

/** The recorded price table version, exported for diagnostics. */
export const textPricingVersion = (): string => TEXT_PRICING_VERSION;

/**
 * Estimates the USD cost of one completed text call.
 *
 * Cost uses the supplied token counts without verifying their source. The
 * returned `source` describes pricing provenance; callers must separately
 * record whether their counts are provider-reported or estimated.
 *
 * An unknown model is deliberately left uncosted: inventing a number from a
 * neighbouring model's rate would corrupt every aggregate downstream.
 */
export const estimateTextCostUsd = (options: {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Provider-reported cached input tokens; omitted when unknown. */
  cachedTokens?: number;
  /** Overrides the compiled table; used by tests and future price syncs. */
  table?: Readonly<Record<string, TextModelPricing>>;
}): TextCostEstimate => {
  const { provider, model, inputTokens, outputTokens, cachedTokens } = options;
  const providerId = provider.trim().toLowerCase();
  const modelId = model.trim().toLowerCase();

  // A local route is free of marginal provider spend even when its price is
  // not in the table (an arbitrary sidecar model id, for instance).
  if (isLocalTextRoute(providerId)) {
    return { usd: 0, source: 'local', pricingVersion: undefined };
  }

  const table = options.table ?? TEXT_MODEL_PRICING;
  const rate = table[modelId];
  if (rate === undefined) {
    return { usd: undefined, source: 'unknown', pricingVersion: undefined };
  }

  const cached = Math.min(Math.max(0, cachedTokens ?? 0), Math.max(0, inputTokens));
  const uncachedInput = Math.max(0, inputTokens) - cached;
  const cachedRate = rate.cachedInputPerMillionUsd ?? rate.inputPerMillionUsd;
  const usd =
    (uncachedInput * rate.inputPerMillionUsd +
      cached * cachedRate +
      Math.max(0, outputTokens) * rate.outputPerMillionUsd) /
    1_000_000;

  return { usd, source: 'priced', pricingVersion: TEXT_PRICING_VERSION };
};

// ---------------------------------------------------------------------------
// Per-task budget
// ---------------------------------------------------------------------------

/**
 * Default end-to-end budget for one logical text request, in ms.
 *
 * A budget is the DEADLINE for the whole request — routing, queueing, model
 * load, prefill, generation and fallback all draw from it. Layers must never
 * restart a budget they inherited; a layer that needs a window derives
 * `min(its own slice, what is left)`.
 *
 * Only latency-sensitive interactive tasks carry a budget. Background work has
 * none, because its deadline is the encounter/campaign lifetime rather than a
 * player's attention span — bounding it would trade a cheap background task
 * for a player-visible failure.
 */
export const DEFAULT_TEXT_TASK_BUDGET_MS = 20_000;

/** Resolves the end-to-end budget for a task, or `undefined` when unbounded. */
export const textTaskBudgetMs = (task: TextTask | undefined): number | undefined =>
  textTaskPreset(task).budgetMs;

/**
 * Scheduling class for a task, for inference admission (#382).
 *
 * A task that declared NONE is treated as `interactive`. That is the
 * conservative direction: an untasked call is usually one someone wrote by hand
 * for a player-visible moment, and starving an unknown call behind
 * best-effort background summarization would degrade the game on the strength
 * of a classification nobody made. An untasked call is not a licence to be
 * deprioritised — it is an absence of evidence that it is safe to deprioritise.
 */
export const textTaskPriority = (task: TextTask | undefined): TextTaskPriority =>
  task === undefined ? 'interactive' : textTaskPreset(task).priority;
