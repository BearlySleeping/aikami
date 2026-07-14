// scripts/src/lib/agents/contract_pipeline/models.ts
//
// 🔴 SINGLE SOURCE OF TRUTH: model + thinking tier configuration for the
// contract pipeline. Every pi spawn in herdr_adapter.ts passes explicit
// `--model` + `--thinking` from these maps — never inherits the user's
// default/last-used model.

export type ModelTier = 'pro' | 'flash' | 'free';

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

const TIERS = {
  pro: 'deepseek/deepseek-v4-pro',
  flash: 'deepseek/deepseek-v4-flash',
  free: 'opencode/big-pickle',
} as const;

const resolveTier = (tier: string): string =>
  (TIERS as Record<string, string>)[tier] ?? (TIERS as Record<string, string>).flash;

/** Per-stage model tiers for the contract pipeline. */
export const CONTRACT_ROLE_MODEL_TIER: Record<string, ModelTier> = {
  writer: 'pro',
  critic: 'flash',
  implementer: 'pro',
  verifier: 'flash',
  review: 'flash',
} as const;

/** Per-stage thinking levels — DeepSeek bills thinking tokens as output. */
export const CONTRACT_ROLE_THINKING_LEVEL: Record<string, ThinkingLevel> = {
  writer: 'medium',
  critic: 'low',
  implementer: 'medium',
  verifier: 'low',
  review: 'low',
} as const;

/** Resolve the model slug for a contract pipeline role. Never undefined. */
export const getContractModelForRole = (role: string): string =>
  resolveTier(CONTRACT_ROLE_MODEL_TIER[role] ?? 'flash');

/** Resolve the thinking level for a contract pipeline role. */
export const getContractThinkingForRole = (role: string): ThinkingLevel =>
  CONTRACT_ROLE_THINKING_LEVEL[role] ?? 'low';
