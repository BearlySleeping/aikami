// packages/frontend/ai-gateway/src/lib/structured.ts
//
// Structured-extraction helpers — schema compilation with strict
// additionalProperties enforcement, JSON sanitization, and TypeBox
// post-validation. Relocated from the client's text_generation_service.
// Contract: C-320 AC-2

import { schemaCheck } from '@aikami/schemas';

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
 *   every compile (used to preserve legacy diagnostics globals).
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
 * is still delivered (legacy lenient behavior).
 */
export const validateAgainstSchema = (options: {
  schema: Record<string, unknown>;
  parsed: unknown;
}): boolean => schemaCheck(options.schema, options.parsed);
