// apps/e2e/src/visual/core/evaluate.ts
// OpenRouter AI visual evaluation with strict TypeBox schema enforcement.
//
// Follows the vision-example.ts pattern: defines a TypeBox schema,
// sends it as response_format json_schema to OpenRouter, and validates
// the parsed result with Value.Check().
//
// If validation fails, the exact schema errors are logged and the
// case is marked as failed rather than silently returning bad data.

import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { computeCacheKey, getCachedResult, setCachedResult } from './cache';

// ── Base Visual Schema ────────────────────────────────────────

/**
 * Base schema that all visual test cases must conform to.
 *
 * Individual suites can extend this via Type.Object({ ...BaseSchema.properties, ... }).
 */
export const BaseVisualSchema = {
  score: { type: 'number', description: '0-100 score of visual correctness' },
  characterVisible: { type: 'boolean' },
  issues: {
    type: 'array',
    items: { type: 'string' },
    description: 'List of visual issues detected',
  },
} as const;

// ── Types ─────────────────────────────────────────────────────

/** Options for a single AI evaluation call. */
export type EvaluateOptions = {
  /** Base64-encoded image data URI (e.g. data:image/png;base64,...). */
  imageDataUri: string;
  /** Natural-language prompt describing what to evaluate. */
  prompt: string;
  /** TypeBox schema for structured output validation. */
  schema: TSchema;
  /** OpenRouter model name. Defaults to google/gemini-2.5-flash. */
  model?: string;
  /** OpenRouter API key. Falls back to OPENROUTER_API_KEY env var. */
  apiKey?: string;
  /** Maximum retries for JSON parse / validation failures. */
  maxRetries?: number;
  /** Whether to use the cache. Default: true. */
  useCache?: boolean;
};

/** Result of a single evaluation, regardless of pass/fail. */
export type EvaluateResult = {
  /** The case name this result belongs to. */
  caseName: string;
  /** Whether the evaluation passed (schema valid + score above threshold). */
  passed: boolean;
  /** The parsed JSON result (only present if passed). */
  result?: unknown;
  /** Error message if evaluation failed. */
  error?: string;
  /** Whether the result came from cache. */
  fromCache: boolean;
  /** AI score (0-100) if available. */
  score?: number;
  /** Raw AI response content for debugging. */
  rawContent?: string;
};

// ── Configuration ─────────────────────────────────────────────

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemini-2.5-flash';

// ── Public API ────────────────────────────────────────────────

/**
 * Evaluates a single screenshot using OpenRouter with TypeBox schema validation.
 *
 * The evaluation pipeline:
 *   1. Compute cache key from (image + prompt + schema).
 *   2. Check cache — if hit, return cached result immediately.
 *   3. Call OpenRouter with the image + prompt + json_schema response_format.
 *   4. Parse the JSON response.
 *   5. Validate against the TypeBox schema with Value.Check().
 *   6. Cache the result for future runs.
 *
 * @returns Structured evaluation result with pass/fail status.
 */
export const evaluateImage = async (options: EvaluateOptions): Promise<EvaluateResult> => {
  const {
    imageDataUri,
    prompt,
    schema,
    model = DEFAULT_MODEL,
    apiKey: key = process.env.OPENROUTER_API_KEY,
    maxRetries = 2,
    useCache = true,
  } = options;

  // ── Cache check ───────────────────────────────────────────
  if (useCache) {
    const cacheKey = computeCacheKey({ imageDataUri, prompt, schema });
    const cached = getCachedResult(cacheKey);

    if (cached !== undefined) {
      const score = (cached as Record<string, unknown>).score as number | undefined;

      return {
        caseName: '(from cache)',
        passed: true,
        result: cached,
        fromCache: true,
        score,
      };
    }
  }

  // ── Guard: API key required ───────────────────────────────
  if (!key) {
    return {
      caseName: '(eval error)',
      passed: false,
      error: 'OPENROUTER_API_KEY not set. Export it or pass apiKey in options.',
      fromCache: false,
    };
  }

  // ── OpenRouter call ───────────────────────────────────────
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // biome-ignore lint/style/useNamingConvention: HTTP header name
          Authorization: `Bearer ${key}`,
          'HTTP-Referer': 'https://localhost:3000',
          'X-Title': 'Aikami Visual Test Framework',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                // biome-ignore lint/style/useNamingConvention: OpenAI-compatible API field
                { type: 'image_url', image_url: { url: imageDataUri } },
              ],
            },
          ],
          // biome-ignore lint/style/useNamingConvention: OpenAI API field names
          response_format: {
            type: 'json_schema',
            // biome-ignore lint/style/useNamingConvention: OpenAI API field names
            json_schema: {
              name: 'visual_evaluation',
              strict: true,
              schema,
            },
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '(no body)');
        throw new Error(`OpenRouter ${response.status}: ${errorText}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from OpenRouter — no content in choices');
      }

      // Parse JSON from content
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        // Try extracting from markdown code fences
        const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch?.[1]) {
          parsed = JSON.parse(fenceMatch[1]);
        } else {
          const objMatch = content.match(/\{[\s\S]*\}/);
          if (objMatch) {
            parsed = JSON.parse(objMatch[0]);
          } else {
            throw new Error(`Cannot extract JSON from AI response: ${content.slice(0, 200)}`);
          }
        }
      }

      // Validate against the TypeBox schema
      const isValid = Value.Check(schema, parsed);

      if (!isValid) {
        const errors = [...Value.Errors(schema, parsed)];
        const errorMessages = errors.map((e) => `${e.message}`);
        throw new Error(
          `Schema validation failed:\n${errorMessages.join('\n')}\nRaw content: ${JSON.stringify(parsed)}`,
        );
      }

      const result = parsed as Record<string, unknown>;
      const score = typeof result.score === 'number' ? result.score : 0;

      // Cache successful result
      if (useCache) {
        const cacheKey = computeCacheKey({ imageDataUri, prompt, schema });
        setCachedResult({ hash: cacheKey, result: parsed });
      }

      return {
        caseName: '(eval)',
        passed: true,
        result: parsed,
        fromCache: false,
        score,
      };
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  // All retries exhausted
  return {
    caseName: '(eval error)',
    passed: false,
    error: lastError instanceof Error ? lastError.message : String(lastError),
    fromCache: false,
  };
};
