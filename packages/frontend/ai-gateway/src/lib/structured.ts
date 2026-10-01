// packages/frontend/ai-gateway/src/lib/structured.ts
//
// Structured-extraction helpers — schema compilation with strict
// additionalProperties enforcement, JSON sanitization, and TypeBox
// post-validation. Relocated from the client's text_generation_service.
// Contract: C-320 AC-2

import { schemaCheck } from '@aikami/schemas';
import type { AiTextUsage } from './gateway_types.ts';

// ---------------------------------------------------------------------------
// Canonical schema form
// ---------------------------------------------------------------------------

/**
 * Bumped whenever the transformation below changes the compiled OUTPUT for an
 * identical input schema.
 *
 * Part of every cache key, so a deployment that compiles differently cannot
 * read entries produced by the previous transformation. Without it a rolling
 * release would serve half the clients a schema the other half no longer
 * produces for the same name.
 */
export const SCHEMA_COMPILER_VERSION = 2;

/**
 * A schema contains a value that has no canonical form.
 *
 * Thrown rather than folded into a shared placeholder: a placeholder makes every
 * unrepresentable schema look identical, and two different schemas sharing a
 * cache entry is precisely the defect this canonical form exists to remove. A
 * caller that cannot canonicalize must skip the shared cache/coalescer path
 * rather than guess an identity.
 */
export class UncanonicalizableSchemaError extends Error {
  constructor(reason: string) {
    super(`Schema has no canonical form: ${reason}`);
    this.name = 'UncanonicalizableSchemaError';
  }
}

/**
 * Depth-first canonical text for a JSON-ish value.
 *
 * Rules, each one load-bearing:
 *
 *   - OBJECT KEYS ARE SORTED. Key order is not semantic in JSON Schema, so two
 *     callers describing the same schema in a different order ARE the same
 *     schema and must share.
 *   - ARRAY ORDER AND LENGTH ARE PRESERVED. `required: ['a','b']` and
 *     `required: ['b','a']` are different constraints, and `enum` order is
 *     likewise part of the value.
 *   - EVERY VALUE IS TYPE-TAGGED AND LENGTH-PREFIXED. `1`, `'1'`, `true` and
 *     `"1"` canonicalize differently, and no two distinct values can ever
 *     produce the same text. A bare `JSON.stringify` gives neither guarantee.
 *   - `undefined`, `NaN` and `Infinity` are tagged rather than dropped, because
 *     `JSON.stringify` silently discards an `undefined` property and two schemas
 *     differing only in one would collapse together.
 *   - CYCLES AND NON-JSON VALUES ARE REJECTED. A schema graph that JSON cannot
 *     represent is not a schema JSON Schema can express either.
 */
const canonicalize = (value: unknown, ancestors: Set<object>): string => {
  if (value === null) {
    return 'z';
  }
  switch (typeof value) {
    case 'boolean':
      return value ? 'b1' : 'b0';
    case 'string':
      // Length-prefixed, so no two strings can share a prefix with a different
      // continuation.
      return `s${value.length}:${value}`;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new UncanonicalizableSchemaError(`non-finite number ${String(value)}`);
      }
      // `Object.is` semantics: -0 and 0 are distinct JSON tokens.
      return `d${Object.is(value, -0) ? '-0' : String(value)}`;
    case 'undefined':
      return 'u';
    case 'object':
      break;
    default:
      throw new UncanonicalizableSchemaError(`unsupported value of type ${typeof value}`);
  }

  const node = value as object;
  if (ancestors.has(node)) {
    throw new UncanonicalizableSchemaError('cyclic reference');
  }
  ancestors.add(node);
  try {
    if (Array.isArray(node)) {
      const items = node.map((item) => canonicalize(item, ancestors));
      return `[${items.length}(${items.join(',')})]`;
    }
    const record = node as Record<string, unknown>;
    // Sort by code unit so the order is total and stable across engines.
    const keys = Object.keys(record).sort();
    const parts = keys.map((key) => {
      const value_ = canonicalize(record[key], ancestors);
      return `k${key.length}:${key}=${value_}`;
    });
    return `{${keys.length}{${parts.join(',')}}}`;
  } finally {
    ancestors.delete(node);
  }
};

/**
 * A deterministic, collision-free identity for a schema's CONTENT.
 *
 * This is a correctness identity, not a digest: it is compared, never hashed
 * down to a fixed width. A truncated hash would reintroduce, in a shorter form,
 * exactly the "different schemas look the same" failure the previous
 * `JSON.stringify(schema, Object.keys(schema).sort())` had — and it would do it
 * silently, because the collision would only surface as one caller's answer
 * served to another. The string is long, and only compared.
 *
 * @throws {UncanonicalizableSchemaError} for cycles, functions, symbols,
 *   bigints and non-finite numbers.
 */
export const canonicalSchemaFingerprint = (schema: unknown): string =>
  canonicalize(schema, new Set<object>());

/** True when the value has a canonical form. Never throws. */
export const isCanonicalizableSchema = (schema: unknown): boolean => {
  try {
    canonicalSchemaFingerprint(schema);
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

/** Compiles TypeBox schemas into strict JSON Schema dictionaries with caching. */
export type SchemaCompiler = {
  compile(options: {
    schema: Record<string, unknown>;
    schemaName: string;
  }): Record<string, unknown>;
  /** Number of cached compiled schemas. */
  readonly size: number;
  /** Empties the cache without disturbing callers holding a compiled result. */
  clear(): void;
};

/** Compiled schemas retained before the least-recently-compiled is evicted. */
const DEFAULT_SCHEMA_CACHE_ENTRIES = 32;

/**
 * Freezes a compiled schema and everything under it.
 *
 * The compiled object is SHARED: every caller that hits the cache receives this
 * exact instance, and a caller that mutated it would silently redefine the
 * schema for every later compile under the same identity. Freezing turns that
 * silent corruption into a loud TypeError at the mutation site. The compiled
 * form is only ever read (serialised into a prompt, embedded in
 * `response_format`), so nothing legitimate writes to it.
 */
const deepFreeze = <T>(value: T): T => {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
};

/**
 * The transport form: a deep clone with strictness enforced at every depth.
 *
 * Cloning first means the caller's own schema object is never rewritten.
 *
 * This is the TRANSPORT artifact, not the application's validity rule: the
 * adapter validates the response against the ORIGINAL schema
 * ({@link validateAgainstSchema}), so forcing `additionalProperties: false` here
 * cannot quietly redefine what the application accepts. Any change to that
 * rewrite must therefore bump {@link SCHEMA_COMPILER_VERSION}.
 */
const compileStrict = (schema: Record<string, unknown>): Record<string, unknown> => {
  const raw = enforceStrictSchema(JSON.parse(JSON.stringify(schema))) as Record<string, unknown>;
  // Set BEFORE freezing: freezing first would make this write a TypeError.
  raw.additionalProperties = false;
  return raw;
};

/**
 * Creates a schema compiler with an internal cache keyed by schema identity.
 *
 * The key is `schemaName + canonical content + compiler version`, NOT the name
 * alone. A name is a label, not a content hash: two callers reusing one name
 * over different shapes were previously served whichever schema compiled
 * first, which is the same defect as coalescing two different schemas onto one
 * request.
 *
 * The cache is bounded. An unbounded map keyed by content would retain every
 * schema the session ever compiled for the lifetime of the app.
 *
 * @param options.onCacheSize - Debug hook invoked with the cache size after
 *   every compile (used to preserve diagnostics globals).
 */
export const createSchemaCompiler = (options?: {
  onCacheSize?: (size: number) => void;
  maxEntries?: number;
}): SchemaCompiler => {
  const cache = new Map<string, Record<string, unknown>>();
  const onCacheSize = options?.onCacheSize;
  const maxEntries = Math.max(1, options?.maxEntries ?? DEFAULT_SCHEMA_CACHE_ENTRIES);

  const put = (key: string, compiled: Record<string, unknown>): void => {
    // Map preserves insertion order, so the first key is the least recently
    // compiled. Re-inserting on hit would make this LRU; eviction is a cold
    // path and name reuse is rare enough that the simpler FIFO is honest.
    if (cache.size >= maxEntries && !cache.has(key)) {
      const oldest = cache.keys().next();
      if (!oldest.done) {
        cache.delete(oldest.value);
      }
    }
    cache.set(key, compiled);
    onCacheSize?.(cache.size);
  };

  return {
    get size(): number {
      return cache.size;
    },

    clear(): void {
      cache.clear();
      onCacheSize?.(cache.size);
    },

    compile({ schema, schemaName }): Record<string, unknown> {
      // A schema with no canonical form cannot be CACHED at all. Its key would
      // be a constant, and a constant key means every such schema shares one
      // entry — which is the collision this whole scheme exists to remove. So
      // it compiles, and the result is simply not retained.
      let fingerprint: string | undefined;
      try {
        fingerprint = canonicalSchemaFingerprint(schema);
      } catch {
        fingerprint = undefined;
      }

      if (fingerprint !== undefined) {
        const key = `${schemaName.length}:${schemaName}|${fingerprint}|${SCHEMA_COMPILER_VERSION}`;
        const cached = cache.get(key);
        if (cached) {
          onCacheSize?.(cache.size);
          return cached;
        }
        const compiled = deepFreeze(compileStrict(schema));
        put(key, compiled);
        return compiled;
      }

      return deepFreeze(compileStrict(schema));
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
