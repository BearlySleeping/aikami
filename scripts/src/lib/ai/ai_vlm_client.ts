// scripts/src/lib/ai/ai_vlm_client.ts
// Multi-provider Vision Language Model client with structured output.
//
// Supports: OpenRouter (remote hosted), Ollama (local), llama.cpp (local).
// Provides: evaluate (structured scoring) + describe (free-form caption).
//
// Used by: e2e visual tests, scripts/ops, Pi ai-describe/validate extensions.
//
// Contract: C-200 (Visual Pipeline Optimization)

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Types ─────────────────────────────────────────────────────

/** Supported VLM backend providers. */
export type VlmProviderType = 'local_ollama' | 'local_llamaccp' | 'openrouter';

/** Runtime configuration for a VLM backend. */
export type VlmRuntimeConfig = {
  provider: VlmProviderType;
  /** Fully qualified model slug (e.g. 'google/gemini-2.5-flash'). */
  modelSlug: string;
  temperature: number;
  numPredict: number;
  /** Override the API endpoint base URL. */
  endpoint?: string;
};

/** Options for an AI image evaluation call. */
export type VlmEvaluateOptions = {
  /** Base64-encoded image data URI (e.g. data:image/png;base64,...). */
  imageDataUri: string;
  /** Natural-language prompt describing what to evaluate. */
  prompt: string;
  /** Optional JSON Schema for structured output validation. */
  schema?: Record<string, unknown>;
  /** Override the default VLM model name. */
  model?: string;
  /** Maximum retries for JSON parse / validation failures. Default: 2. */
  /** Whether to use the disk cache. Default: true. */
  useCache?: boolean;
  /** Cache file path. Default: tmp/vlm-cache.json. */
  cachePath?: string;
};

/** Options for a free-form image description call. */
export type VlmDescribeOptions = {
  /** Base64-encoded image data URI. */
  imageDataUri: string;
  /** Natural-language prompt asking what to describe. */
  prompt: string;
  /** Override the default VLM model name. */
  model?: string;
};

/** Result of a VLM evaluation. */
export type VlmEvaluateResult<T = Record<string, unknown>> = {
  /** The parsed structured output (only present if validation passed). */
  result?: T;
  /** AI score (0-100) if the schema included a score field. */
  score?: number;
  /** Natural-language review/feedback string if the schema included one. */
  review?: string;
  /** Whether the result came from cache. */
  fromCache: boolean;
  /** Error message if evaluation failed. */
  error?: string;
  /** Raw AI response content for debugging. */
  rawContent?: string;
  /** Which provider served this result (useful when fallback was used). */
  provider?: string;
  /** Which model served this result. */
  model?: string;
};

/** Result of a VLM describe call. */
export type VlmDescribeResult = {
  /** The AI-generated description text. */
  description: string;
  /** Error message if description failed. */
  error?: string;
};

// ── Model capability registry ─────────────────────────────────

/**
 * Set of model prefixes known to support native image/vision encoding.
 *
 * Models NOT in this set will receive the image as a base64 string
 * embedded in the prompt text rather than as a native image_url block.
 * This allows text-only models to at least attempt image understanding
 * from the raw base64 data (rarely effective, but better than rejecting).
 */
const VISION_CAPABLE_MODEL_PREFIXES = new Set([
  // OpenAI
  'openai/gpt-4o',
  'openai/gpt-4-turbo',
  'openai/gpt-4-vision',
  // Google
  'google/gemini-2.5',
  'google/gemini-2.0',
  'google/gemini-1.5',
  'google/gemini-pro-vision',
  'google/gemini-flash',
  // Anthropic
  'anthropic/claude-3',
  'anthropic/claude-3.5',
  'anthropic/claude-3.7',
  // Meta
  'meta-llama/llama-3.2-vision',
  'meta-llama/llama-4',
  // Generic local vision
  'llama3.2-vision',
  'llava',
  'bakllava',
  'minicpm-v',
  'cogvlm',
  'qwen-vl',
  'qwen2-vl',
]);

/**
 * Checks whether a model slug supports native vision/image encoding.
 *
 * Matches by prefix — e.g. 'google/gemini-2.5-flash' starts with
 * 'google/gemini-2.5' and is therefore vision-capable.
 */
export const isVisionCapable = (modelSlug: string): boolean => {
  for (const prefix of VISION_CAPABLE_MODEL_PREFIXES) {
    if (modelSlug.startsWith(prefix)) {
      return true;
    }
  }
  return false;
};

// ── Configuration ─────────────────────────────────────────────

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OLLAMA_URL = 'http://localhost:11434/api/generate';
const OLLAMA_NUM_PREDICT = 4096;
const OLLAMA_NUM_CTX = 16384;
const DEFAULT_TEMPERATURE = 0.1;

/** Default model per provider. */
const DEFAULT_MODELS: Record<VlmProviderType, string> = {
  openrouter: 'google/gemini-2.5-flash',
  // biome-ignore lint/style/useNamingConvention: discriminant value
  local_ollama: 'llama3.2-vision:11b',
  // biome-ignore lint/style/useNamingConvention: discriminant value
  local_llamaccp: 'llama-vision',
};

// ── Thought-token removal ─────────────────────────────────────

/** Regex that matches <think>...</think> blocks across lines.
 *
 * Reasoning-capable vision models emit chain-of-thought tokens inside
 * XML-style <think> tags before the final structured output.
 *
 * Contract: C-200 AC-3
 */
const THINK_TAG_RE = /<think>[\s\S]*?<\/think>/gi;

/**
 * Strips <think>...</think> reasoning tags from model output.
 */
const _stripThinkTags = (content: string): string => {
  let cleaned = content;
  while (THINK_TAG_RE.test(cleaned)) {
    cleaned = cleaned.replace(THINK_TAG_RE, '');
  }
  return cleaned.trim();
};

// ── JSON extraction ───────────────────────────────────────────

/**
 * Attempts to extract a JSON object from arbitrary text content.
 *
 * Strategies (in order):
 *   1. Direct JSON.parse (clean JSON).
 *   2. Markdown code fence extraction (```json ... ```).
 *   3. Braced-object regex ({...}).
 */
const _extractJson = (content: string): unknown => {
  // Strategy 1: Direct parse
  try {
    return JSON.parse(content);
  } catch {
    // Fall through
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
 * Calls OpenRouter with an image + prompt.
 *
 * For vision-capable models, send image as native `image_url` block.
 * For non-vision models, embed base64 in the text prompt (degraded fallback).
 */
const _callOpenRouter = async (options: {
  imageDataUri: string;
  prompt: string;
  model: string;
  responseFormat?: Record<string, unknown>;
}): Promise<string> => {
  const { imageDataUri, prompt, model, responseFormat } = options;

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error('OPENROUTER_API_KEY not set');
  }

  const hasVision = isVisionCapable(model);

  const body: Record<string, unknown> = {
    model,
    messages: [
      {
        role: 'user',
        content: hasVision
          ? [
              { type: 'text', text: prompt },
              // biome-ignore lint/style/useNamingConvention: OpenAI field
              { type: 'image_url', image_url: { url: imageDataUri } },
            ]
          : [
              {
                type: 'text',
                text: `${prompt}\n\nThe image is embedded as base64 below:\n${imageDataUri}`,
              },
            ],
      },
    ],
  };

  if (responseFormat) {
    // biome-ignore lint/style/useNamingConvention: OpenAI field
    body.response_format = responseFormat;
  }

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // biome-ignore lint/style/useNamingConvention: HTTP header
      Authorization: `Bearer ${key}`,
      'HTTP-Referer': 'https://localhost:3000',
      'X-Title': 'Aikami',
    },
    body: JSON.stringify(body),
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
 * For Ollama, the image is always sent as a separate `images` field
 * (raw base64 bytes, no data URI prefix). Model-agnostic.
 */
const _callOllama = async (options: {
  imageDataUri: string;
  prompt: string;
  model: string;
  temperature: number;
}): Promise<string> => {
  const { imageDataUri, prompt, model, temperature } = options;

  // Extract base64 bytes from data URI
  const base64 = imageDataUri.replace(/^data:image\/\w+;base64,/, '');

  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      images: [base64],
      stream: false,
      options: {
        temperature,
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

  return _stripThinkTags(raw);
};

// ── Cache layer ───────────────────────────────────────────────

/** Shape of a single cache entry. */
type CacheEntry = {
  hash: string;
  timestamp: string;
  result: unknown;
};

/** Shape of the on-disk cache file. */
type CacheFile = {
  entries: Record<string, CacheEntry>;
};

const _readCache = (cachePath: string): Record<string, CacheEntry> => {
  if (!existsSync(cachePath)) {
    return {};
  }
  try {
    const raw = readFileSync(cachePath, 'utf-8');
    const data = JSON.parse(raw) as CacheFile;
    return data.entries ?? {};
  } catch {
    return {};
  }
};

const _writeCache = (cachePath: string, entries: Record<string, CacheEntry>): void => {
  mkdirSync(resolve(cachePath, '..'), { recursive: true });
  writeFileSync(cachePath, JSON.stringify({ entries }, null, 2));
};

const _computeHash = (imageDataUri: string, prompt: string, schemaJson: string): string => {
  return createHash('sha256').update(`${imageDataUri}|${prompt}|${schemaJson}`).digest('hex');
};

// ── Fallback chain ───────────────────────────────────────────

/**
 * Provider fallback order. When the primary provider fails, the client
 * tries the next provider in this list before giving up.
 *
 * Default: openrouter → local_ollama (or vice-versa depending on VLM_PROVIDER).
 */
const PROVIDER_FALLBACK_ORDER: VlmProviderType[] = ['openrouter', 'local_ollama'];

/**
 * Model fallback chain for OpenRouter. When the primary model fails,
 * try these alternatives in order. All are vision-capable.
 */
const MODEL_FALLBACK_CHAIN = [
  'google/gemini-2.5-flash',
  'google/gemini-2.0-flash-001',
  'openai/gpt-4o',
];

/**
 * Builds the ordered list of (provider, model) pairs to try.
 *
 * Starts with the configured primary, then alternates provider or model
 * on each failure until the fallback chain is exhausted.
 */
const _buildFallbackChain = (
  primaryProvider: VlmProviderType,
  primaryModel: string,
): Array<{ provider: VlmProviderType; model: string }> => {
  const chain: Array<{ provider: VlmProviderType; model: string }> = [
    { provider: primaryProvider, model: primaryModel },
  ];

  // Try the opposite provider with the same model
  for (const fbProvider of PROVIDER_FALLBACK_ORDER) {
    if (fbProvider !== primaryProvider) {
      chain.push({ provider: fbProvider, model: primaryModel });
    }
  }

  // Try fallback models on the primary provider
  for (const fbModel of MODEL_FALLBACK_CHAIN) {
    if (fbModel !== primaryModel) {
      chain.push({ provider: primaryProvider, model: fbModel });
    }
  }

  // Cross-combine: fallback provider + fallback model
  for (const fbProvider of PROVIDER_FALLBACK_ORDER) {
    if (fbProvider === primaryProvider) {
      continue;
    }
    for (const fbModel of MODEL_FALLBACK_CHAIN) {
      chain.push({ provider: fbProvider, model: fbModel });
    }
  }

  return chain;
};

// ── Environment config ────────────────────────────────────────

/**
 * Resolves the active VLM runtime configuration from environment.
 *
 * Reads VLM_PROVIDER, VLM_MODEL, VLM_TEMPERATURE, VLM_NUM_PREDICT env vars.
 *
 * Contract: C-200 AC-2
 */
export const getVlmConfig = (): VlmRuntimeConfig => {
  const provider: VlmProviderType =
    (process.env.VLM_PROVIDER as VlmProviderType | undefined) ?? 'openrouter';

  return {
    provider,
    modelSlug: process.env.VLM_MODEL || DEFAULT_MODELS[provider],
    temperature:
      process.env.VLM_TEMPERATURE !== undefined
        ? Number.parseFloat(process.env.VLM_TEMPERATURE)
        : DEFAULT_TEMPERATURE,
    numPredict:
      process.env.VLM_NUM_PREDICT !== undefined
        ? Number.parseInt(process.env.VLM_NUM_PREDICT, 10)
        : OLLAMA_NUM_PREDICT,
    endpoint: process.env.VLM_ENDPOINT,
  };
};

// ── Public API: evaluate ──────────────────────────────────────

/**
 * Evaluates a single image using the active VLM provider with
 * optional JSON schema validation.
 *
 * Pipeline:
 *   1. Compute cache key from (image + prompt + schema).
 *   2. Check cache → return cached result if hit.
 *   3. Route to provider (OpenRouter or Ollama) based on VLM_PROVIDER.
 *   4. Extract JSON from response.
 *   5. Validate against optional TypeBox schema.
 *   6. Cache successful result.
 *
 * @returns Structured evaluation result with score and review.
 */
export const evaluateImage = async <T = Record<string, unknown>>(
  options: VlmEvaluateOptions,
): Promise<VlmEvaluateResult<T>> => {
  const { imageDataUri, prompt, schema, useCache = true, cachePath } = options;

  const config = getVlmConfig();
  const model = options.model ?? config.modelSlug;
  const schemaJson = schema ? JSON.stringify(schema) : '';
  const resolvedCachePath = cachePath ?? resolve('tmp/vlm-cache.json');

  // ── Cache check ───────────────────────────────────────────
  if (useCache) {
    const hash = _computeHash(imageDataUri, prompt, schemaJson);
    const cache = _readCache(resolvedCachePath);
    const entry = cache[hash];

    if (entry?.result) {
      const result = entry.result as Record<string, unknown>;
      return {
        result: result as T,
        score: typeof result.score === 'number' ? result.score : undefined,
        review: typeof result.review === 'string' ? result.review : undefined,
        fromCache: true,
      };
    }
  }

  // ── Fallback chain: try providers/models in order ─────────
  const fallbackChain = _buildFallbackChain(config.provider, model);
  let lastError: unknown;

  for (const [index, entry] of fallbackChain.entries()) {
    try {
      const isLocal = entry.provider === 'local_ollama' || entry.provider === 'local_llamaccp';
      const responseFormat = schema
        ? {
            type: 'json_schema',
            // biome-ignore lint/style/useNamingConvention: OpenAI field
            json_schema: {
              name: 'visual_evaluation',
              strict: true,
              schema,
            },
          }
        : undefined;

      const rawContent = isLocal
        ? await _callOllama({
            imageDataUri,
            prompt,
            model: entry.model,
            temperature: config.temperature,
          })
        : await _callOpenRouter({ imageDataUri, prompt, model: entry.model, responseFormat });

      // Parse JSON from content
      const parsed = _extractJson(rawContent) as Record<string, unknown>;

      // Optional TypeBox schema validation
      if (schema) {
        try {
          const { Value } = await import('typebox/value');
          const isValid = Value.Check(schema as import('typebox').TSchema, parsed);

          if (!isValid) {
            const errors = [...Value.Errors(schema as import('typebox').TSchema, parsed)];
            const errorMessages = errors.map((e) => `${e.message}`);
            throw new Error(
              `Schema validation failed:\n${errorMessages.join('\n')}\nRaw: ${JSON.stringify(parsed)}`,
            );
          }
        } catch (validationError) {
          if ((validationError as Error).message.includes('Schema validation failed')) {
            throw validationError;
          }
          // typebox not available — skip validation, accept as-is
        }
      }

      // Cache successful result
      if (useCache) {
        const hash = _computeHash(imageDataUri, prompt, schemaJson);
        const cache = _readCache(resolvedCachePath);
        cache[hash] = {
          hash,
          timestamp: new Date().toISOString(),
          result: parsed,
        };
        _writeCache(resolvedCachePath, cache);
      }

      return {
        result: parsed as T,
        score: typeof parsed.score === 'number' ? parsed.score : undefined,
        review: typeof parsed.review === 'string' ? parsed.review : undefined,
        fromCache: false,
        rawContent,
        provider: entry.provider,
        model: entry.model,
      };
    } catch (error) {
      lastError = error;
      // Don't delay on the last entry
      if (index < fallbackChain.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  return {
    error: lastError instanceof Error ? lastError.message : String(lastError),
    fromCache: false,
  };
};

// ── Public API: describe ──────────────────────────────────────

/**
 * Describes an image using the active VLM provider (free-form text).
 *
 * Uses OpenRouter or Ollama depending on VLM_PROVIDER env var.
 * Returns a plain-text description string — no structured output.
 */
export const describeImage = async (options: VlmDescribeOptions): Promise<VlmDescribeResult> => {
  const { imageDataUri, prompt } = options;

  const config = getVlmConfig();
  const model = options.model ?? config.modelSlug;

  // ── Fallback chain ──────────────────────────────────────────
  const fallbackChain = _buildFallbackChain(config.provider, model);
  let lastError: unknown;

  for (const [index, entry] of fallbackChain.entries()) {
    try {
      const isLocal = entry.provider === 'local_ollama' || entry.provider === 'local_llamaccp';

      const rawContent = isLocal
        ? await _callOllama({
            imageDataUri,
            prompt,
            model: entry.model,
            temperature: config.temperature,
          })
        : await _callOpenRouter({
            imageDataUri,
            prompt: `${prompt}\n\nDescribe the image in detail. Return ONLY plain text — no JSON, no markdown.`,
            model: entry.model,
          });

      return { description: rawContent.trim() };
    } catch (error) {
      lastError = error;
      if (index < fallbackChain.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  return {
    description: '',
    error: lastError instanceof Error ? lastError.message : String(lastError),
  };
};

// ── Re-export model registry for consumers ────────────────────

/**
 * Registers additional vision-capable model prefixes at runtime.
 *
 * Useful when consumers add custom local models or provider aliases.
 */
export const registerVisionModel = (prefix: string): void => {
  VISION_CAPABLE_MODEL_PREFIXES.add(prefix);
};
