// .pi/extensions/lib/cost_accounting.ts
//
// Pure accounting and message-shape helpers extracted from `cost_guard.ts`.
//
// The guard mixes three genuinely different concerns:
//
//   1. WHAT DID THIS TURN COST, and what did the assistant actually produce?
//      — the pure functions in this file;
//   2. repetition / runaway / loop detection — counters and thresholds, driven
//      by (1);
//   3. policy and enforcement — which cap was hit, what the agent is told, and
//      whether the pipeline needs a structured exit.
//
// (1) is pure, depends on nothing, and is the part worth testing in isolation.
// Extracting it also makes the boundary explicit: nothing in this file reads
// the environment, the session, or pi's context. `envNumber`/`envBool` are here
// because they are the pure reading of a configuration value, not the policy
// that decides what the default should be.
//
// 🔴 Behaviour is unchanged by this move — these are the same functions, with
// the leading underscore dropped now that they are module exports. The guard's
// regression tests (`lib/cost_guard.test.ts`) exercise the guard itself.

/** Convert model-registry cost (per 1M tokens) to per-token cost. */
export const PER_MILLION = 1_000_000;

/** Parse a positive number from env, falling back when unset or malformed. */
export const envNumber = (name: string, fallback: number): number => {
  const parsed = Number(process.env[name] ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Parse a boolean env var. Anything but the standard off-values enables. */
export const envBool = (name: string, fallback: boolean): boolean => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  return !['0', 'false', 'no', 'off'].includes(raw.toLowerCase());
};

/**
 * pi usage objects use `input`/`output`/`cacheRead`/`cacheWrite` field names.
 * Cost is already computed by pi when available; falls back to manual calc.
 */
export const computeTurnCost = (
  usage: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
    cost?: { total?: number };
  },
  pricing: { input: number; output: number; cacheRead?: number; cacheWrite?: number },
): number => {
  // Prefer pi's built-in cost calculation when available
  if (usage.cost?.total !== undefined && usage.cost.total > 0) {
    return usage.cost.total;
  }

  return (
    (usage.input / PER_MILLION) * pricing.input +
    (usage.output / PER_MILLION) * pricing.output +
    ((usage.cacheRead ?? 0) / PER_MILLION) * (pricing.cacheRead ?? 0) +
    ((usage.cacheWrite ?? 0) / PER_MILLION) * (pricing.cacheWrite ?? 0)
  );
};

/** Flatten an assistant message's content into plain text for analysis. */
export const assistantText = (content: unknown): string => {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((block) => {
      const b = block as { type?: string; text?: string } | undefined;
      return b?.type === 'text' && typeof b.text === 'string' ? b.text : '';
    })
    .join('\n');
};

/**
 * Flatten an assistant message's REASONING blocks into plain text.
 *
 * 🔴 On DeepSeek this is where all the narration lives: across the 285 stored
 * sessions there are 27,783 `thinking` blocks against 18,113 `text` blocks,
 * and every degenerate turn on record had `text` completely empty. A collapse
 * check that reads only `text` therefore scores the worst turns zero — the
 * 2026-08-23 session emitted 169,607 characters of reasoning repeating one
 * sentence 177 times while `assistantText` saw the empty string.
 */
export const assistantThinking = (content: unknown): string => {
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((block) => {
      const b = block as { type?: string; thinking?: string; text?: string } | undefined;
      if (b?.type !== 'thinking' && b?.type !== 'reasoning') {
        return '';
      }
      return b.thinking ?? b.text ?? '';
    })
    .join('\n');
};

/** Extract an assistant message's tool calls for loop-signature purposes. */
export const toolCalls = (content: unknown): { name: string; arguments: unknown }[] => {
  if (!Array.isArray(content)) {
    return [];
  }
  return content
    .filter((block) => (block as { type?: string } | undefined)?.type === 'toolCall')
    .map((block) => {
      const b = block as { name?: string; arguments?: unknown };
      return { name: b.name ?? '', arguments: b.arguments };
    });
};
