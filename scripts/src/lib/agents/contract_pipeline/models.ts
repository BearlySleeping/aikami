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

/** Per-tier model, overridable via `CONTRACT_PIPELINE_MODEL_<TIER>` in `.env.local`. */
const TIERS: Record<ModelTier, string> = {
  pro: process.env.CONTRACT_PIPELINE_MODEL_PRO ?? DEFAULT_TIERS.pro,
  flash: process.env.CONTRACT_PIPELINE_MODEL_FLASH ?? DEFAULT_TIERS.flash,
  free: process.env.CONTRACT_PIPELINE_MODEL_FREE ?? DEFAULT_TIERS.free,
};

const resolveTier = (tier: string): string =>
  (TIERS as Record<string, string>)[tier] ?? TIERS.flash;

/** Per-stage model tiers for the contract pipeline. */
export const CONTRACT_ROLE_MODEL_TIER: Record<string, ModelTier> = {
  writer: 'pro',
  critic: 'flash',
  implementer: 'pro',
  verifier: 'flash',
  review: 'pro',
} as const;

const rawThinking = process.env.CONTRACT_PIPELINE_THINKING;

/**
 * Thinking level applied to every stage, overridable with
 * `CONTRACT_PIPELINE_THINKING` in `.env.local`.
 *
 * DeepSeek V4 (direct or via DeepInfra) only natively supports three
 * thinking levels: off (non-thinking), high, max. `low` and `medium` are
 * NOT native — wrappers silently map them to `high`, adding routing overhead
 * and latency. Stick to native levels here to avoid the mapping layer.
 *
 * 🔴 DeepSeek bills thinking tokens as output tokens. `max` costs ~3.7x more
 * than `high` for a marginal quality gain — `high` is the better default.
 */
const DEFAULT_THINKING: ThinkingLevel = isThinkingLevel(rawThinking) ? rawThinking : 'high';

export const CONTRACT_ROLE_THINKING_LEVEL: Record<string, ThinkingLevel> = {
  writer: DEFAULT_THINKING,
  critic: DEFAULT_THINKING,
  implementer: DEFAULT_THINKING,
  verifier: DEFAULT_THINKING,
  review: DEFAULT_THINKING,
};

/** Resolve the model slug for a contract pipeline role. Never undefined. */
export const getContractModelForRole = (role: string): string =>
  resolveTier(CONTRACT_ROLE_MODEL_TIER[role] ?? 'flash');

/** Resolve the thinking level for a contract pipeline role. */
export const getContractThinkingForRole = (role: string): ThinkingLevel =>
  CONTRACT_ROLE_THINKING_LEVEL[role] ?? 'high';
