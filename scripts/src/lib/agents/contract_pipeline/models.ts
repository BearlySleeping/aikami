// scripts/src/lib/agents/contract_pipeline/models.ts
/**
 * Per-role model configuration for the contract pipeline.
 *
 * Roles and rationale:
 *   writer      → pro,  high     (planning quality compounds downstream)
 *   critic      → pro,  high     (critical review needs full reasoning)
 *   implementer → pro,  medium   (implementation is the core work)
 *   verifier    → flash, low     (mechanical verification against contract)
 *
 * Review is interactive (no fixed model — user's pi defaults apply).
 */

import type { ContractWorkerRole } from './types.ts';

export type ModelTier = 'pro' | 'flash' | 'free';
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export const PIPELINE_MODELS = {
  tiers: {
    pro: 'deepseek/deepseek-v4-pro',
    flash: 'deepseek/deepseek-v4-flash',
    free: 'opencode/big-pickle',
  },
} as const;

export const ROLE_MODEL_TIER: Record<ContractWorkerRole, ModelTier> = {
  writer: 'pro',
  critic: 'pro',
  implementer: 'pro',
  verifier: 'flash',
};

export const ROLE_THINKING_LEVEL: Record<ContractWorkerRole, ThinkingLevel> = {
  writer: 'high',
  critic: 'high',
  implementer: 'medium',
  verifier: 'low',
};

export const getModelForTier = (tier: ModelTier): string => {
  return PIPELINE_MODELS.tiers[tier] ?? PIPELINE_MODELS.tiers.flash;
};

export const piModelFlags = (role: ContractWorkerRole): string[] => {
  const tier = ROLE_MODEL_TIER[role];
  const thinking = ROLE_THINKING_LEVEL[role];
  if (!tier) {
    return [];
  }
  const model = getModelForTier(tier);
  return ['--model', model, '--thinking', thinking];
};
