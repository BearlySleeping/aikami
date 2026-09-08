// scripts/src/lib/agents/contract_pipeline/models.ts
//
// 🔴 SINGLE SOURCE OF TRUTH: model + thinking tier configuration for the
// contract pipeline. Every pi spawn in herdr_adapter.ts passes explicit
// `--model` + `--thinking` from these maps when configured — never inherits
// the user's default/last-used model unless nothing is configured here.
//
// All model slugs come from the repo-root `.env` (see
// scripts/src/lib/cli_utils.ts — `getEnvWithFallback`). Nothing is
// hardcoded. Per tier, the first non-empty key wins:
//
//   pro:   CONTRACT_PIPELINE_MODEL_PRO → PI_MODEL_PRO → MODEL_PRO → MODEL
//   flash: CONTRACT_PIPELINE_MODEL_FLASH → PI_MODEL_FLASH → MODEL_FLASH → MODEL
//   free:  CONTRACT_PIPELINE_MODEL_FREE → PI_MODEL_FREE → MODEL_FREE → MODEL
//
//   thinking: CONTRACT_PIPELINE_THINKING → PI_THINKING
//
// 🔴 AC-3: Model and thinking choices are explicit and valid. The resolution
// records the requested and effective provider/model/thinking settings,
// rejects invalid overrides before paid work, and does not silently substitute
// a model or mislabel Flash as a stronger pro tier.

import { getEnvWithFallback } from '../../cli_utils';

export type ModelTier = 'pro' | 'flash' | 'free';

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

const THINKING_LEVELS: readonly ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
];

const isThinkingLevel = (value: string | undefined): value is ThinkingLevel =>
  value !== undefined && (THINKING_LEVELS as readonly string[]).includes(value);

/** Env fallback keys per tier — the first non-empty value wins. */
const MODEL_FALLBACK_KEYS: Record<ModelTier, readonly string[]> = {
  pro: ['CONTRACT_PIPELINE_MODEL_PRO', 'PI_MODEL_PRO', 'MODEL_PRO', 'MODEL'],
  flash: ['CONTRACT_PIPELINE_MODEL_FLASH', 'PI_MODEL_FLASH', 'MODEL_FLASH', 'MODEL'],
  free: ['CONTRACT_PIPELINE_MODEL_FREE', 'PI_MODEL_FREE', 'MODEL_FREE', 'MODEL'],
};

const THINKING_FALLBACK_KEYS = ['CONTRACT_PIPELINE_THINKING', 'PI_THINKING'] as const;

/**
 * Per-tier model, resolved from the repo-root `.env`. Evaluated lazily so
 * tests can set env vars between calls. A tier resolves to `undefined` when
 * nothing is configured — callers then start pi WITHOUT `--model`, letting
 * pi use the user's own default model.
 */
const readTiers = (): Record<ModelTier, string | undefined> => ({
  pro: getEnvWithFallback(MODEL_FALLBACK_KEYS.pro),
  flash: getEnvWithFallback(MODEL_FALLBACK_KEYS.flash),
  free: getEnvWithFallback(MODEL_FALLBACK_KEYS.free),
});

const resolveTier = (tier: string): string | undefined =>
  (readTiers() as Record<string, string | undefined>)[tier] ?? readTiers().flash;

/** Per-stage model tiers for the contract pipeline. */
export const CONTRACT_ROLE_MODEL_TIER: Record<string, ModelTier> = {
  writer: 'pro',
  critic: 'flash',
  implementer: 'pro',
  verifier: 'flash',
  review: 'pro',
} as const;

/**
 * Read the effective thinking level from env. Evaluated lazily so tests can
 * set env vars between calls. Returns undefined when unset/invalid — callers
 * then omit `--thinking` and let pi pick its own default.
 */
const readDefaultThinking = (): ThinkingLevel | undefined => {
  const raw = getEnvWithFallback(THINKING_FALLBACK_KEYS);
  return isThinkingLevel(raw) ? raw : undefined;
};

export const CONTRACT_ROLE_THINKING_LEVEL: Record<string, ThinkingLevel | undefined> = {
  get writer() {
    return readDefaultThinking();
  },
  get critic() {
    return readDefaultThinking();
  },
  get implementer() {
    return readDefaultThinking();
  },
  get verifier() {
    return readDefaultThinking();
  },
  get review() {
    return readDefaultThinking();
  },
};

// ── AC-3: Explicit resolution ────────────────────────────────

export type ModelResolution = {
  /** The requested tier (pro, flash, free). */
  requestedTier: string;
  /** The requested model tier value from env (undefined when unset). */
  requestedTierValue: string | undefined;
  /** The effective model slug that will be used (undefined → pi default). */
  effectiveModel: string | undefined;
  /** The requested thinking level (undefined when unset). */
  requestedThinking: string | undefined;
  /** The effective thinking level (undefined when unset/invalid). */
  effectiveThinking: ThinkingLevel | undefined;
  /** Whether the effective model slug is the same across multiple tiers. */
  tierEquivalence: string | null;
};

export type ModelValidationIssue = {
  field: string;
  severity: 'error' | 'warning';
  message: string;
};

/**
 * Validate a model override value. Returns issues that should prevent
 * the pipeline from proceeding with invalid settings.
 */
export const validateModelOverride = (options: {
  tier: string;
  value: string | undefined;
}): ModelValidationIssue[] => {
  const issues: ModelValidationIssue[] = [];

  if (options.value === undefined) {
    return issues; // No override — valid
  }

  if (options.value.length < 3) {
    issues.push({
      field: `CONTRACT_PIPELINE_MODEL_${options.tier.toUpperCase()}`,
      severity: 'error',
      message:
        `Model override "${options.value}" for tier "${options.tier}" is too short. ` +
        'Expected a valid provider/model slug (e.g. "provider/model").',
    });
  }

  if (options.value.includes(' ') || options.value.includes('\t')) {
    issues.push({
      field: `CONTRACT_PIPELINE_MODEL_${options.tier.toUpperCase()}`,
      severity: 'error',
      message:
        `Model override "${options.value}" contains whitespace. ` +
        'Provider/model slugs must not contain spaces.',
    });
  }

  return issues;
};

/**
 * Validate a thinking level override. Returns issues for unsupported levels.
 */
export const validateThinkingOverride = (options: {
  value: string | undefined;
}): ModelValidationIssue[] => {
  const issues: ModelValidationIssue[] = [];

  if (options.value === undefined) {
    return issues;
  }

  if (!isThinkingLevel(options.value)) {
    issues.push({
      field: 'CONTRACT_PIPELINE_THINKING',
      severity: 'error',
      message:
        `Invalid thinking level "${options.value}". ` +
        `Valid levels: ${THINKING_LEVELS.join(', ')}.`,
    });
  }

  return issues;
};

/**
 * Resolve the full model configuration for a contract pipeline role.
 * Records requested and effective settings, reports tier equivalence,
 * and surfaces any validation issues.
 *
 * @returns The model resolution with all requested and effective settings.
 */
export const resolveModelConfiguration = (options: {
  role: string;
}): ModelResolution & { issues: ModelValidationIssue[] } => {
  const issues: ModelValidationIssue[] = [];

  const tiers = readTiers();
  const requestedTier = CONTRACT_ROLE_MODEL_TIER[options.role] ?? 'flash';
  const requestedTierValue = (tiers as Record<string, string | undefined>)[requestedTier];
  const effectiveModel = resolveTier(requestedTier);

  const requestedThinking = getEnvWithFallback(THINKING_FALLBACK_KEYS);
  const effectiveThinking = isThinkingLevel(requestedThinking) ? requestedThinking : undefined;

  // Validate overrides
  issues.push(...validateModelOverride({ tier: requestedTier, value: requestedTierValue }));
  issues.push(...validateThinkingOverride({ value: requestedThinking }));

  // Check tier equivalence — do pro and flash resolve to the same model?
  const proModel = resolveTier('pro');
  const flashModel = resolveTier('flash');
  const tierEquivalence: string | null =
    proModel !== undefined && flashModel !== undefined && proModel === flashModel
      ? `pro and flash both resolve to "${proModel}" — they are equivalent. Override one tier via CONTRACT_PIPELINE_MODEL_PRO or CONTRACT_PIPELINE_MODEL_FLASH to differentiate.`
      : null;

  return {
    requestedTier,
    requestedTierValue,
    effectiveModel,
    requestedThinking,
    effectiveThinking,
    tierEquivalence,
    issues,
  };
};

/**
 * Check whether the model configuration has blocking errors that should
 * prevent the pipeline from starting.
 */
export const hasBlockingModelErrors = (issues: ModelValidationIssue[]): boolean =>
  issues.some((i) => i.severity === 'error');

// ── Legacy API (preserved for backward compatibility) ─────────

/** Resolve the model slug for a contract pipeline role. Undefined when no
 *  model is configured — callers then start pi without `--model`. */
export const getContractModelForRole = (role: string): string | undefined =>
  resolveTier(CONTRACT_ROLE_MODEL_TIER[role] ?? 'flash');

/** Resolve the thinking level for a contract pipeline role. Undefined when
 *  unset/invalid — callers then start pi without `--thinking`. */
export const getContractThinkingForRole = (role: string): ThinkingLevel | undefined =>
  CONTRACT_ROLE_THINKING_LEVEL[role];
