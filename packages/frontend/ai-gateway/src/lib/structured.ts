// packages/frontend/ai-gateway/src/lib/structured.ts
//
// Structured-extraction helpers — schema compilation with strict
// additionalProperties enforcement, JSON sanitization, and TypeBox
// post-validation. Relocated from the client's text_generation_service.
// Contract: C-320 AC-2

import { schemaCheck } from '@aikami/schemas';
import type { AiTextUsage } from './gateway_types.ts';

/** Compiles TypeBox schemas into strict JSON Schema dictionaries with caching. */
export type SchemaCompiler = {
  compile(options: {
    schema: Record<string, unknown>;
    schemaName: string;
  }): Record<string, unknown>;
  /** Number of cached compiled schemas. */
  readonly size: number;
};

/**
 * Creates a schema compiler with an internal cache keyed by schema name.
 *
 * @param options.onCacheSize - Debug hook invoked with the cache size after
 *   every compile (used to preserve diagnostics globals).
 */
export const createSchemaCompiler = (options?: {
  onCacheSize?: (size: number) => void;
}): SchemaCompiler => {
  const cache = new Map<string, Record<string, unknown>>();
  const onCacheSize = options?.onCacheSize;

  return {
    get size(): number {
      return cache.size;
    },
    compile({ schema, schemaName }): Record<string, unknown> {
      const cached = cache.get(schemaName);
      if (cached) {
        onCacheSize?.(cache.size);
        return cached;
      }

      const raw = enforceStrictSchema(JSON.parse(JSON.stringify(schema)));
      const compiled = raw as Record<string, unknown>;
      compiled.additionalProperties = false;

      cache.set(schemaName, compiled);
      onCacheSize?.(cache.size);
      return compiled;
    },
  };
};

/**
 * Recursively enforces `additionalProperties: false` on every object
 * schema node in the JSON Schema tree.
 */
export const enforceStrictSchema = (node: unknown): unknown => {
  if (node === null || typeof node !== 'object') {
    return node;
  }

  const obj = node as Record<string, unknown>;

  if (obj.type === 'object' || obj.properties !== undefined) {
    obj.additionalProperties = false;

    if (obj.properties && typeof obj.properties === 'object') {
      for (const key of Object.keys(obj.properties as Record<string, unknown>)) {
        (obj.properties as Record<string, unknown>)[key] = enforceStrictSchema(
          (obj.properties as Record<string, unknown>)[key],
        );
      }
    }
  }

  if (obj.type === 'array' && obj.items) {
    if (Array.isArray(obj.items)) {
      obj.items = (obj.items as unknown[]).map((item) => enforceStrictSchema(item));
    } else {
      obj.items = enforceStrictSchema(obj.items);
    }
  }

  for (const combinator of ['allOf', 'anyOf', 'oneOf']) {
    if (Array.isArray(obj[combinator])) {
      obj[combinator] = (obj[combinator] as unknown[]).map((item) => enforceStrictSchema(item));
    }
  }

  return obj;
};

/**
 * Strips markdown fences and extracts the first JSON object/array from a
 * string that may contain explanatory text. Throws when no balanced JSON
 * value is found.
 */
export const sanitizeJsonResponse = (raw: string): string => {
  let text = raw.trim();

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  const objectStart = text.indexOf('{');
  const arrayStart = text.indexOf('[');

  let startIndex = objectStart;
  if (objectStart === -1 || (arrayStart !== -1 && arrayStart < objectStart)) {
    startIndex = arrayStart;
  }

  if (startIndex === -1) {
    throw new Error('No JSON object found in response');
  }

  text = text.slice(startIndex);

  let depth = 0;
  const opener = text[0];
  const closer = opener === '{' ? '}' : ']';
  let inString = false;
  let escapeNext = false;
  let endIndex = -1;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (ch === '\\') {
      escapeNext = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (ch === opener) {
      depth++;
    } else if (ch === closer) {
      depth--;
      if (depth === 0) {
        endIndex = i + 1;
        break;
      }
    }
  }

  if (endIndex === -1) {
    throw new Error('Unbalanced JSON in response');
  }

  return text.slice(0, endIndex);
};

/**
 * Validates a parsed value against the original TypeBox schema.
 * Returns false on mismatch — callers decide whether to warn; the value
 * is still delivered (lenient behavior).
 */
export const validateAgainstSchema = (options: {
  schema: Record<string, unknown>;
  parsed: unknown;
}): boolean => schemaCheck(options.schema, options.parsed);

// ---------------------------------------------------------------------------
// Token accounting
// ---------------------------------------------------------------------------

/**
 * True when a value is a plausible token count.
 *
 * Integers only: a fractional count is a provider bug or a different quantity
 * wearing the same field name, and recording it as "the provider said 1.5
 * tokens" would put a fabricated figure into the cost column.
 */
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;

/**
 * The OpenAI-compatible accounting block, in the providers' own field names.
 *
 * Lives here, beside the other payload-reading helpers, because two very
 * different readers need it: the non-streaming response bodies and the trailing
 * SSE accounting frame. A copy in each would drift, and a drifted cost figure is
 * worse than no cost figure.
 */
type OpenAiUsagePayload = {
  // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
  prompt_tokens?: unknown;
  // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
  completion_tokens?: unknown;
  // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
  prompt_tokens_details?: { cached_tokens?: unknown };
};

/**
 * Reads provider-reported token accounting off an OpenAI-compatible payload.
 *
 * `inputTokens` is the provider's TOTAL prompt count, which already includes
 * any cached portion — so a consumer pricing it must subtract `cachedTokens`
 * rather than add them.
 *
 * Returns `undefined` when the body carries no accounting, or carries an
 * incomplete or non-numeric block. A partial count is not a smaller count, and
 * reporting a fabricated zero would make "not measured" indistinguishable from
 * "this was free".
 */
export const readOpenAiUsage = (payload: unknown): AiTextUsage | undefined => {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }
  const usage = (payload as { usage?: unknown }).usage;
  if (typeof usage !== 'object' || usage === null) {
    return undefined;
  }
  const counts = usage as OpenAiUsagePayload;
  if (!isCount(counts.prompt_tokens) || !isCount(counts.completion_tokens)) {
    return undefined;
  }
  const details = counts.prompt_tokens_details;
  const cachedTokens =
    typeof details === 'object' && details !== null && isCount(details.cached_tokens)
      ? details.cached_tokens
      : undefined;
  return {
    inputTokens: counts.prompt_tokens,
    outputTokens: counts.completion_tokens,
    ...(cachedTokens === undefined ? {} : { cachedTokens }),
    source: 'provider',
  };
};
