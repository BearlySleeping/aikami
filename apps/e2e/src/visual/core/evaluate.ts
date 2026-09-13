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
  /**
   * C-378: boolean schema fields that must be `true` for the case to
   * pass regardless of the score. E.g. `['overheadOccludesPlayer']` makes
   * the headline visual claim a hard gate instead of trusting a generous
   * score.
   */
  requiredTrueFields?: string[];
  /**
   * Per-case minimum score. Defaults to {@link PASS_SCORE_THRESHOLD}; a
   * headline case can demand more (e.g. 90) than the framework default.
   */
  minScore?: number;
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
 * A case passes when the score meets the threshold AND every
 * requiredTrueFields entry is explicitly true. C-378: required fields are
 * hard gates — a generous score can no longer paper over a headline claim
 * the schema says must be true. Required fields are evaluated BEFORE the
 * score threshold so a combined failure reports the failing field instead
 * of only "below threshold".
 *
 * Returns the failing field (when a field gate is what failed) so
 * the caller can surface *why* the case failed instead of blaming
 * the score. Score-only failures return no field.
 */
const _evaluateGates = (
  result: Record<string, unknown>,
  requiredTrueFields: readonly string[] = [],
  minScore: number = PASS_SCORE_THRESHOLD,
): { passed: boolean; failedField?: string; score?: number } => {
  const score = typeof result.score === 'number' ? result.score : 0;
  // C-378: headline fields are hard gates evaluated FIRST — a 95-score run
  // that fails only on a required field must report that field, not
  // "below threshold". Suites declare their own hard fields (e.g.
  // inCorrectCorner/onGreenGrass) via requiredTrueFields.
  for (const field of requiredTrueFields) {
    if (result[field] !== true) {
      return { passed: false, failedField: field };
    }
  }
  if (score < minScore) {
    return { passed: false, score };
  }
  return { passed: true };
};

/**
 * Builds the human-readable failure reason for a gated result, preferring a
 * named required field over the score so a 95-score run that fails only on a
 * headline field reports that field.
 */
const _gateError = (
  gate: { failedField?: string; score?: number },
  parsed: Record<string, unknown>,
  minScore: number | undefined,
): string | undefined => {
  if (gate.failedField !== undefined) {
    return `Required field "${gate.failedField}" was not true (got ${JSON.stringify(parsed[gate.failedField])})`;
  }
  if (gate.score !== undefined) {
    return `Score ${gate.score} is below the case minimum ${minScore ?? PASS_SCORE_THRESHOLD}`;
  }
  return undefined;
};

// ── Public API ────────────────────────────────────────────────

/**
 * Resolves the active VLM runtime configuration from environment.
 *
 * Delegates to the shared {@link vlmGetVlmConfig} in @aikami/utils.
 *
 * Contract: C-200 AC-2
 */
export const getVlmConfig = (): VlmRuntimeConfig => vlmGetVlmConfig();

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
  const { imageDataUri, prompt, schema, useCache = true, requiredTrueFields, minScore } = options;

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
  const gate = _evaluateGates(parsed, requiredTrueFields, minScore);

  return {
    caseName: result.fromCache ? '(from cache)' : '(eval)',
    passed: gate.passed,
    // C-378: when a required field gates the run, surface the failing
    // field instead of reporting the model score as "below threshold" —
    // a 95-score run that fails only on overheadOccludesPlayer must say so.
    // C-525: a per-case `minScore` gate reports the score against its own
    // threshold, not the framework default.
    error: _gateError(gate, parsed, minScore),
    result: parsed,
    fromCache: result.fromCache,
    score,
    rawContent: result.rawContent,
  };
};
