// .pi/swarm/models.ts
/**
 * Swarm model configuration — single source of truth for tier-to-model mapping.
 *
 * Per-role defaults:
 *   architect → pro (planning quality compounds downstream)
 *   coder → pro by default, flash if architect flags complexity=trivial
 *   qa → flash (running tests doesn't need reasoning)
 *   git → free (validates before deterministic commit script)
 *   review → N/A (deterministic script, no LLM)
 */

export type ModelTier = 'pro' | 'flash' | 'free';

export const SWARM_MODELS = {
  default: 'flash' as const,
  tiers: {
    pro: 'deepseek/deepseek-v4-pro',
    flash: 'deepseek/deepseek-v4-flash',
    free: 'openrouter/free',
  } as Record<ModelTier, string>,
};

export const ROLE_MODEL_TIER: Record<string, ModelTier> = {
  architect: 'pro',
  coder: 'pro', // downgraded to 'flash' if architect flags complexity=trivial
  qa: 'flash',
  git: 'free', // validates handoffs, generates commit plan
  review: 'flash', // N/A — deterministic script
} as const;

/** Get the model slug for a tier. */
export const getModelForTier = (tier: string): string =>
  SWARM_MODELS.tiers[tier as ModelTier] ?? SWARM_MODELS.tiers.flash;

/** Get the default tier. */
export const getDefaultTier = (): string => SWARM_MODELS.default;
