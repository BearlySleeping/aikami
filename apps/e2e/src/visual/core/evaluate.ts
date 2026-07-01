// apps/e2e/src/visual/core/evaluate.ts
// Multi-provider AI visual evaluation with strict TypeBox schema enforcement.
//
// Supports two backends selected via VLM_PROVIDER env var:
//   - openrouter:    Remote hosted frontier models (default)
//   - local_ollama:  Local Ollama instance with vision models
//
// Both paths use identical prompt + image + response_format json_schema
// → TypeBox validation. The Ollama path additionally filters <think>
// reasoning tags before passing output to the schema parser.
//
// Contract: C-200 Visual Pipeline Optimization

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

/** Supported VLM backend providers (C-200 AC-2). */
export type VlmProviderType = 'local_ollama' | 'local_llamaccp' | 'openrouter';

/** Runtime configuration for a VLM backend. */
export type VlmRuntimeConfig = {
  provider: VlmProviderType;
  modelSlug: string;
  temperature: number;
  numPredict: number;
};

/** Options for a single AI evaluation call. */
export type EvaluateOptions = {
  /** Base64-encoded image data URI (e.g. data:image/png;base64,...). */
  imageDataUri: string;
  /** Natural-language prompt describing what to evaluate. */
  prompt: string;
  /** TypeBox schema for structured output validation. */
  schema: TSchema;
  /** Override the default VLM model name. */
  model?: string;
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
const OLLAMA_URL = 'http://localhost:11434/api/generate';

/** Selected via VLM_PROVIDER env var. Defaults to openrouter for cloud evaluation. */
const VLM_PROVIDER: VlmProviderType =
  (process.env.VLM_PROVIDER as VlmProviderType | undefined) ?? 'openrouter';

/** Default model per provider. */
const DEFAULT_MODELS: Record<VlmProviderType, string> = {
  openrouter: 'google/gemini-2.5-flash',
  // biome-ignore lint/style/useNamingConvention: matches VlmProviderType discriminant
  local_ollama: 'llama3.2-vision:11b',
  // biome-ignore lint/style/useNamingConvention: matches VlmProviderType discriminant
  local_llamaccp: 'llama-vision',
};

/** Default temperature — low for deterministic structured output. */
const DEFAULT_TEMPERATURE = 0.1;

/**
 * num_predict for Ollama — set to 4096 per C-200 AC-3 watch point
 * to provide adequate context window for deep-thinking chains
 * without clipping the trailing JSON result block.
 */
const OLLAMA_NUM_PREDICT = 4096;

/**
 * num_ctx for Ollama — 16384 to accommodate large 2016×2016 image
 * payloads alongside structured evaluation prompts. Default 4096
 * is insufficient for vision models processing high-res screenshots.
 */
const OLLAMA_NUM_CTX = 16384;

/** Minimum score for a visual test to be considered passing. */
const PASS_SCORE_THRESHOLD = 80;

// ── Thought-token removal (C-200 AC-3) ────────────────────────

/** Regex that matches <think>...</think> blocks across lines.
 *
 * Reasoning-capable vision models (Qwen, DeepSeek, etc.) emit
 * chain-of-thought tokens inside XML-style <think> tags before
 * the final structured output. These tags break JSON.parse()
 * because they appear before the leading `{`. This regex strips
 * them cleanly so the remaining text can be parsed as JSON.
 *
 * Contract: C-200 AC-3
 */
const THINK_TAG_RE = /<think>[\s\S]*?<\/think>/gi;

/**
 * Strips <think>...</think> reasoning tags from model output.
 *
 * Applies repeatedly in case of nested/adjacent think blocks.
 * Trims whitespace afterward so JSON.parse sees a clean leading `{`.
 */
const _stripThinkTags = (content: string): string => {
  let cleaned = content;
  // Loop to handle multiple sequential think blocks
  while (THINK_TAG_RE.test(cleaned)) {
    cleaned = cleaned.replace(THINK_TAG_RE, '');
  }
  return cleaned.trim();
};

// ── Pass/fail computation ─────────────────────────────────────

/**
 * Determines pass/fail from a validated result object.
 *
 * A case passes when the score meets the threshold AND, for
 * corner-specific schemas, both onGreenGrass and inCorrectCorner
 * are explicitly true.
 */
const _computePassed = (result: Record<string, unknown>): boolean => {
  const score = typeof result.score === 'number' ? result.score : 0;
  if (score < PASS_SCORE_THRESHOLD) {
    return false;
  }
  if (typeof result.inCorrectCorner === 'boolean' && result.inCorrectCorner !== true) {
    return false;
  }
  if (typeof result.onGreenGrass === 'boolean' && result.onGreenGrass !== true) {
    return false;
  }
  return true;
};

// ── JSON extraction helpers ───────────────────────────────────

/**
 * Attempts to extract a JSON object from arbitrary text content.
 *
 * Tries three strategies in order:
 *   1. Direct JSON.parse (content is clean JSON).
 *   2. Markdown code fence extraction (```json ... ```).
 *   3. Braced-object regex extraction ({...}).
 *
 * @throws If no valid JSON object can be extracted.
 */
const _extractJson = (content: string): unknown => {
  // Strategy 1: Direct parse
  try {
    return JSON.parse(content);
  } catch {
    // Fall through to fence extraction
  }

  // Strategy 2: Markdown code fence
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    return JSON.parse(fenceMatch[1]);
  }

  // Strategy 3: Braced-object regex
  const objMatch = content.match(/\{[\s\S]*\}/);
  if (objMatch) {
    return JSON.parse(objMatch[0]);
  }

  throw new Error(`Cannot extract JSON from AI response: ${content.slice(0, 200)}`);
};

// ── Provider clients ──────────────────────────────────────────

/**
 * Calls OpenRouter with an image + prompt + json_schema response_format.
 *
 * Returns the raw content string from the model's response.
 */
const _callOpenRouter = async (options: {
  imageDataUri: string;
  prompt: string;
  schema: TSchema;
  model: string;
}): Promise<string> => {
  const { imageDataUri, prompt, schema, model } = options;
  const key = process.env.OPENROUTER_API_KEY;

  if (!key) {
    throw new Error('OPENROUTER_API_KEY not set');
  }

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // biome-ignore lint/style/useNamingConvention: HTTP header
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
            // biome-ignore lint/style/useNamingConvention: OpenAI-compatible field
            { type: 'image_url', image_url: { url: imageDataUri } },
          ],
        },
      ],
      // biome-ignore lint/style/useNamingConvention: OpenAI field
      response_format: {
        type: 'json_schema',
        // biome-ignore lint/style/useNamingConvention: OpenAI field
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

  return content;
};

/**
 * Calls a local Ollama instance with an image + prompt.
 *
 * Uses the /api/generate endpoint with the vision model. Ollama
 * does not natively support response_format json_schema, so the
 * schema definition is embedded directly in the prompt alongside
 * explicit formatting instructions.
 *
 * The result is post-processed by {@link _stripThinkTags} to remove
 * reasoning traces before TypeBox validation.
 *
 * C-200 AC-3: Sets num_predict=4096 to prevent JSON truncation
 * during deep-thinking chains.
 */
const _callOllama = async (options: {
  imageDataUri: string;
  prompt: string;
  model: string;
  schema: TSchema;
}): Promise<string> => {
  const { imageDataUri, prompt, model, schema } = options;

  // Embed the full JSON schema so Ollama knows the exact shape to output.
  const schemaJson = JSON.stringify(schema, null, 2);
  const jsonPrompt = [
    prompt,
    '',
    'OUTPUT FORMAT — Return ONLY a single JSON object matching this EXACT schema:',
    '```json',
    schemaJson,
    '```',
    'Do NOT include explanations, markdown, or text outside the JSON object.',
    'EVERY field in the schema is REQUIRED — do not skip or omit any field.',
    'Boolean fields MUST be `true` or `false` (never omitted).',
    'Array fields MUST be `[]` even if empty.',
  ].join('\n');

  // Extract base64 bytes from data URI (strip "data:image/png;base64," prefix)
  const base64 = imageDataUri.replace(/^data:image\/\w+;base64,/, '');

  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: jsonPrompt,
      images: [base64],
      stream: false,
      options: {
        temperature: DEFAULT_TEMPERATURE,
        // biome-ignore lint/style/useNamingConvention: Ollama API field
        num_predict: OLLAMA_NUM_PREDICT,
        // biome-ignore lint/style/useNamingConvention: Ollama API field
        num_ctx: OLLAMA_NUM_CTX,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '(no body)');
    throw new Error(`Ollama ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as { response?: string; error?: string };

  if (data.error) {
    throw new Error(`Ollama error: ${data.error}`);
  }

  const raw = data.response;
  if (!raw) {
    throw new Error('Empty response from Ollama — no "response" field');
  }

  // C-200 AC-3: Strip <think> reasoning tags before TypeBox parsing
  return _stripThinkTags(raw);
};

// ── Public API ────────────────────────────────────────────────

/**
 * Resolves the active VLM runtime configuration from environment.
 *
 * Reads VLM_PROVIDER, VLM_MODEL, VLM_TEMPERATURE, and VLM_NUM_PREDICT
 * env vars to build a {@link VlmRuntimeConfig} with sensible defaults.
 *
 * Contract: C-200 AC-2
 */
export const getVlmConfig = (): VlmRuntimeConfig => {
  return {
    provider: VLM_PROVIDER,
    modelSlug: process.env.VLM_MODEL || DEFAULT_MODELS[VLM_PROVIDER],
    temperature:
      process.env.VLM_TEMPERATURE !== undefined
        ? Number.parseFloat(process.env.VLM_TEMPERATURE)
        : DEFAULT_TEMPERATURE,
    numPredict:
      process.env.VLM_NUM_PREDICT !== undefined
        ? Number.parseInt(process.env.VLM_NUM_PREDICT, 10)
        : OLLAMA_NUM_PREDICT,
  };
};

/**
 * Evaluates a single screenshot using the active VLM provider with
 * TypeBox schema validation.
 *
 * The evaluation pipeline:
 *   1. Compute cache key from (image + prompt + schema).
 *   2. Check cache — if hit, return cached result immediately.
 *   3. Route to the active provider (OpenRouter or Ollama) based on
 *      VLM_PROVIDER env var.
 *   4. For Ollama: strip <think> tags before JSON parsing.
 *   5. Extract JSON from the response.
 *   6. Validate against the TypeBox schema with Value.Check().
 *   7. Cache the result for future runs.
 *
 * @returns Structured evaluation result with pass/fail status.
 */
export const evaluateImage = async (options: EvaluateOptions): Promise<EvaluateResult> => {
  const { imageDataUri, prompt, schema, maxRetries = 2, useCache = true } = options;

  const config = getVlmConfig();
  const model = options.model ?? config.modelSlug;

  // ── Cache check ───────────────────────────────────────────
  if (useCache) {
    const cacheKey = computeCacheKey({ imageDataUri, prompt, schema });
    const cached = getCachedResult(cacheKey);

    if (cached !== undefined) {
      const result = cached as Record<string, unknown>;
      const score = typeof result.score === 'number' ? result.score : 0;

      return {
        caseName: '(from cache)',
        passed: _computePassed(result),
        result: cached,
        fromCache: true,
        score,
      };
    }
  }

  // ── Retry loop ────────────────────────────────────────────
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Route to the configured VLM provider (C-200 AC-2)
      const rawContent =
        VLM_PROVIDER === 'local_ollama'
          ? await _callOllama({ imageDataUri, prompt, model, schema })
          : await _callOpenRouter({ imageDataUri, prompt, schema, model });

      // Parse JSON from content
      const parsed = _extractJson(rawContent);

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
        passed: _computePassed(result),
        result: parsed,
        fromCache: false,
        score,
        rawContent,
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
