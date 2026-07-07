// apps/e2e/src/visual/core/evaluate.ts
// Multi-provider AI visual evaluation — thin wrapper over @aikami/utils VLM client.
//
// Delegates provider routing, caching, JSON extraction, and schema validation
// to the shared ai_vlm_client. Adds e2e-specific pass/fail scoring logic
// on top (PASS_SCORE_THRESHOLD, corner-specific field checks).
//
// Contract: C-200 Visual Pipeline Optimization

import {
  type VlmProviderType,
  type VlmRuntimeConfig,
  evaluateImage as vlmEvaluateImage,
  getVlmConfig as vlmGetVlmConfig,
} from '@scripts/ai';
import type { TSchema } from 'typebox';

// ── Re-exports ────────────────────────────────────────────────

export type { VlmProviderType, VlmRuntimeConfig };

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

// ── Pass/fail computation ─────────────────────────────────────

/** Minimum score for a visual test to be considered passing. */
const PASS_SCORE_THRESHOLD = 80;

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

// ── Public API ────────────────────────────────────────────────

/**
 * Resolves the active VLM runtime configuration from environment.
 *
 * Delegates to the shared {@link vlmGetVlmConfig} in @aikami/utils.
 *
 * Contract: C-200 AC-2
 */
export const getVlmConfig = (): VlmRuntimeConfig => {
  return vlmGetVlmConfig();
};

/**
 * Evaluates a single screenshot using the active VLM provider with
 * TypeBox schema validation.
 *
 * Delegates provider routing, caching, JSON extraction, and validation
 * to {@link vlmEvaluateImage} from @aikami/utils. Adds e2e-specific
 * pass/fail scoring on top.
 *
 * @returns Structured evaluation result with pass/fail status.
 */
export const evaluateImage = async (options: EvaluateOptions): Promise<EvaluateResult> => {
  const { imageDataUri, prompt, schema, useCache = true } = options;

  const result = await vlmEvaluateImage<Record<string, unknown>>({
    imageDataUri,
    prompt,
    schema: schema as Record<string, unknown>,
    model: options.model,
    useCache,
  });

  if (result.error) {
    return {
      caseName: '(eval error)',
      passed: false,
      error: result.error,
      fromCache: result.fromCache,
    };
  }

  const parsed = result.result ?? {};
  const score = result.score ?? 0;

  return {
    caseName: result.fromCache ? '(from cache)' : '(eval)',
    passed: _computePassed(parsed),
    result: parsed,
    fromCache: result.fromCache,
    score,
    rawContent: result.rawContent,
  };
};
