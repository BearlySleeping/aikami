// scripts/src/lib/agents/contract_pipeline/models.ts
//
// 🔴 SINGLE SOURCE OF TRUTH: model + thinking tier configuration for the
// contract pipeline. Every pi spawn in herdr_adapter.ts passes explicit
// `--model` + `--thinking` from these maps — never inherits the user's
// default/last-used model.
//
// Defaults point at DeepSeek-V4-Flash served via DeepInfra (the
// `pi-deepinfra` package). Override any tier or the thinking level with env
// vars in `.env.local` (gitignored, never committed) — e.g. to fall back to
// the direct `deepseek` provider or point at a different checkpoint:
//
//   CONTRACT_PIPELINE_MODEL_PRO=deepseek/deepseek-v4-pro
//   CONTRACT_PIPELINE_MODEL_FLASH=deepseek/deepseek-v4-flash
//   CONTRACT_PIPELINE_THINKING=high
//
// 🔴 AC-3: Model and thinking choices are explicit and valid. The resolution
// records the requested and effective provider/model/thinking settings,
// rejects invalid overrides before paid work, and does not silently substitute
// a model or mislabel Flash as a stronger pro tier.

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

/** Default model per tier — DeepSeek-V4-Flash via DeepInfra (see `pi-deepinfra`). */
const DEFAULT_TIERS = {
  // The 0731 GA checkpoint is cheaper than v4-pro on every axis with near-identical
  // SWE-bench quality, so both tiers point at it. Override per tier below if needed.
  pro: 'deepinfra/deepseek-ai/DeepSeek-V4-Flash',
  flash: 'deepinfra/deepseek-ai/DeepSeek-V4-Flash',
  free: 'opencode/big-pickle',
} as const satisfies Record<ModelTier, string>;

/**
 * Per-tier model, overridable via `CONTRACT_PIPELINE_MODEL_<TIER>` in `.env.local`.
 * Evaluated lazily so tests can set env vars between calls.
 */
const readTiers = (): Record<ModelTier, string> => ({
  pro: process.env.CONTRACT_PIPELINE_MODEL_PRO ?? DEFAULT_TIERS.pro,
  flash: process.env.CONTRACT_PIPELINE_MODEL_FLASH ?? DEFAULT_TIERS.flash,
  free: process.env.CONTRACT_PIPELINE_MODEL_FREE ?? DEFAULT_TIERS.free,
});

const resolveTier = (tier: string): string =>
  (readTiers() as Record<string, string>)[tier] ?? readTiers().flash;

/** Per-stage model tiers for the contract pipeline. */
export const CONTRACT_ROLE_MODEL_TIER: Record<string, ModelTier> = {
  writer: 'pro',
  critic: 'flash',
  implementer: 'pro',
  verifier: 'flash',
  review: 'pro',
} as const;

/**
 * Read the effective thinking level from env or default.
 * Evaluated lazily so tests can set env vars between calls.
 *
 * DeepSeek V4 (direct or via DeepInfra) only natively supports three
 * thinking levels: off (non-thinking), high, max. `low` and `medium` are
 * NOT native — wrappers silently map them to `high`, adding routing overhead
 * and latency. Stick to native levels here to avoid the mapping layer.
 *
 * 🔴 DeepSeek bills thinking tokens as output tokens. `max` costs ~3.7x more
 * than `high` for a marginal quality gain — `high` is the better default.
 */
const readDefaultThinking = (): ThinkingLevel => {
  const raw = process.env.CONTRACT_PIPELINE_THINKING;
  return isThinkingLevel(raw) ? raw : 'high';
};

export const CONTRACT_ROLE_THINKING_LEVEL: Record<string, ThinkingLevel> = {
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
  /** The requested model tier value. */
  requestedTierValue: string | undefined;
  /** The effective model slug that will be used. */
  effectiveModel: string;
  /** The default model slug for this tier (before env override). */
  defaultModel: string;
  /** Whether the effective model differs from the default (env override). */
  overridden: boolean;
  /** The requested thinking level. */
  requestedThinking: string;
  /** The effective thinking level (may differ after validation). */
  effectiveThinking: string;
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

  if (!options.value) {
    return issues; // No override, using default — valid
  }

  if (options.value.length < 3) {
    issues.push({
      field: `CONTRACT_PIPELINE_MODEL_${options.tier.toUpperCase()}`,
      severity: 'error',
      message:
        `Model override "${options.value}" for tier "${options.tier}" is too short. ` +
        'Expected a valid provider/model slug (e.g. "deepinfra/deepseek-ai/DeepSeek-V4-Flash").',
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

  if (!options.value) {
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
  const requestedTierValue = (tiers as Record<string, string>)[requestedTier];
  const defaultModel = DEFAULT_TIERS[requestedTier as ModelTier] ?? DEFAULT_TIERS.flash;
  const effectiveModel = resolveTier(requestedTier);
  const overridden = effectiveModel !== defaultModel;

  const requestedThinking = CONTRACT_ROLE_THINKING_LEVEL[options.role] ?? 'high';
  const effectiveThinking = isThinkingLevel(requestedThinking) ? requestedThinking : 'high';

  // Validate overrides
  issues.push(...validateModelOverride({ tier: requestedTier, value: requestedTierValue }));
  issues.push(...validateThinkingOverride({ value: process.env.CONTRACT_PIPELINE_THINKING }));

  // Check tier equivalence — do pro and flash resolve to the same model?
  const proModel = resolveTier('pro');
  const flashModel = resolveTier('flash');
  const tierEquivalence: string | null =
    proModel === flashModel
      ? `pro and flash both resolve to "${proModel}" — they are equivalent. Override one tier via CONTRACT_PIPELINE_MODEL_PRO or CONTRACT_PIPELINE_MODEL_FLASH to differentiate.`
      : null;

  // If tier equivalence exists and this role uses pro or flash, add a warning
  if (tierEquivalence && (requestedTier === 'pro' || requestedTier === 'flash')) {
    issues.push({
      field: `tier:${requestedTier}`,
      severity: 'warning',
      message:
        `Role "${options.role}" uses tier "${requestedTier}" which resolves to "${effectiveModel}". ` +
        `Note: ${tierEquivalence}`,
    });
  }

  return {
    requestedTier,
    requestedTierValue,
    effectiveModel,
    defaultModel,
    overridden,
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

/** Resolve the model slug for a contract pipeline role. Never undefined. */
export const getContractModelForRole = (role: string): string =>
  resolveTier(CONTRACT_ROLE_MODEL_TIER[role] ?? 'flash');

/** Resolve the thinking level for a contract pipeline role. */
export const getContractThinkingForRole = (role: string): ThinkingLevel =>
  CONTRACT_ROLE_THINKING_LEVEL[role] ?? 'high';
