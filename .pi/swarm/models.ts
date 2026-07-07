// .pi/swarm/models.ts
/**
 * Swarm model configuration — single source of truth.
 *
 * Imported directly by swarm_run.ts, swarm_control.ts, and any other
 * swarm tooling that needs model-to-tier mappings.
 */

export type ModelTier = 'pro' | 'flash' | 'openrouter-free' | 'opencode-free';

export type ModelEntry = {
  model: string;
  roles: string[];
};

export type ModelsConfig = {
  default: string;
  models: Record<string, ModelEntry>;
};

export const SWARM_MODELS: ModelsConfig = {
  default: 'flash',
  models: {
    pro: {
      model: 'deepseek/deepseek-v4-pro',
      roles: ['architect', 'coder', 'qa'],
    },
    flash: {
      model: 'deepseek/deepseek-v4-flash',
      roles: ['git'],
    },
    'openrouter-free': {
      model: 'openrouter/free',
      roles: [],
    },
    'opencode-free': {
      model: 'opencode/big-pickle',
      roles: [],
    },
  },
} as const;

/** Get the model slug for a tier. */
export const getModelForTier = (tier: string): string =>
  SWARM_MODELS.models[tier]?.model ?? SWARM_MODELS.models.flash?.model ?? '';

/** Get the default tier. */
export const getDefaultTier = (): string => SWARM_MODELS.default;
