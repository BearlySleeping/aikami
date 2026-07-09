// .pi/swarm/models.ts
/**
 * Swarm model configuration — single source of truth for tier-to-model mapping.
 *
 * Per-role defaults:
 *   architect → pro (planning quality compounds downstream)
 *   coder → pro (flash only if architect flags complexity=trivial)
 *   qa → flash (pro if architect flags complexity=complex — QA LLM only spawns on failures)
 *   git → N/A (deterministic, no LLM)
 *   review → N/A (deterministic stdin script)
 *   docs → free (free_fallback on quota errors)
 *
 * --tier override:
 *   --tier pro    → all roles get pro (fixed from old bug where explicit flash was ignored)
 *   --tier flash  → all roles get flash (actually forces flash now)
 *   --tier default / absent → per-role matrix above with complexity adjustments
 */

export type ModelTier = 'pro' | 'flash' | 'free';

export const SWARM_MODELS = {
  tiers: {
    pro: 'deepseek/deepseek-v4-pro',
    flash: 'deepseek/deepseek-v4-flash',
    free: 'opencode/big-pickle',
    free_fallback: 'openrouter/free',
  },
} as const;

/** Per-role default tiers. git + review: deterministic, no LLM. */
export const ROLE_MODEL_TIER: Record<string, ModelTier> = {
  architect: 'pro',
  coder: 'pro', // flash if complexity=trivial
  qa: 'flash', // pro if complexity=complex (QA LLM only spawns on test failures)
  docs: 'free', // free_fallback on quota errors
  git: 'free',
} as const;

/** Get the model slug for a tier. Falls back to flash for unrecognized tiers. */
export const getModelForTier = (tier: string): string => {
  const t = tier as ModelTier;
  return SWARM_MODELS.tiers[t] ?? SWARM_MODELS.tiers.flash;
};

/** Get the default tier string. */
export const getDefaultTier = (): string => 'flash';
