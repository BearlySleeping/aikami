// scripts/src/lib/agents/contract_pipeline/models.test.ts
//
// C-474 AC-3: Model and thinking choices are explicit and valid.
// Verifies that resolution records requested/effective settings, rejects
// invalid overrides, and reports tier equivalence explicitly. Models are
// resolved from env fallback keys only — nothing is hardcoded.

import { beforeEach, describe, expect, test } from 'bun:test';
import { setRootEnvOverride } from '../../cli_utils';
import {
  CONTRACT_ROLE_MODEL_TIER,
  CONTRACT_ROLE_THINKING_LEVEL,
  getContractModelForRole,
  getContractThinkingForRole,
  hasBlockingModelErrors,
  resolveModelConfiguration,
  validateModelOverride,
  validateThinkingOverride,
} from './models.ts';

// ── Test environment ─────────────────────────────────────────

const ENV_KEYS = [
  'CONTRACT_PIPELINE_MODEL_PRO',
  'CONTRACT_PIPELINE_MODEL_FLASH',
  'CONTRACT_PIPELINE_MODEL_FREE',
  'CONTRACT_PIPELINE_THINKING',
  'PI_MODEL_PRO',
  'PI_MODEL_FLASH',
  'PI_MODEL_FREE',
  'PI_THINKING',
  'MODEL_PRO',
  'MODEL_FLASH',
  'MODEL_FREE',
  'MODEL',
  // Role-specific model overrides ({ROLE}_MODEL)
  'WRITER_MODEL',
  'CRITIC_MODEL',
  'IMPLEMENTER_MODEL',
  'VERIFIER_MODEL',
  'REVIEW_MODEL',
  // Role-specific thinking overrides ({ROLE}_THINKING_LEVEL)
  'WRITER_THINKING_LEVEL',
  'CRITIC_THINKING_LEVEL',
  'IMPLEMENTER_THINKING_LEVEL',
  'VERIFIER_THINKING_LEVEL',
  'REVIEW_THINKING_LEVEL',
  // Tier-specific thinking overrides ({TIER}_THINKING_LEVEL)
  'PRO_THINKING_LEVEL',
  'FLASH_THINKING_LEVEL',
  'FREE_THINKING_LEVEL',
] as const;

beforeEach(() => {
  // Clear any repo-root .env values the resolver may have cached, then drop
  // every fallback key so each test starts from a clean, env-free slate
  // regardless of the developer's local .env.
  setRootEnvOverride({});
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

// ── Env-driven resolution ────────────────────────────────────

describe('model resolution is env-driven', () => {
  test('returns undefined for every role when nothing is configured', () => {
    for (const role of ['writer', 'critic', 'implementer', 'verifier', 'review']) {
      expect(getContractModelForRole(role)).toBeUndefined();
    }
  });

  test('resolves the generic MODEL fallback for every tier', () => {
    process.env.MODEL = 'provider/default-model';
    expect(getContractModelForRole('writer')).toBe('provider/default-model');
    expect(getContractModelForRole('critic')).toBe('provider/default-model');
    expect(getContractModelForRole('review')).toBe('provider/default-model');
  });

  test('PI_MODEL_PRO overrides MODEL for the pro tier only', () => {
    process.env.MODEL = 'provider/default-model';
    process.env.PI_MODEL_PRO = 'provider/pi-pro-model';
    expect(getContractModelForRole('writer')).toBe('provider/pi-pro-model');
    expect(getContractModelForRole('critic')).toBe('provider/default-model');
  });

  test('CONTRACT_PIPELINE_MODEL_PRO wins over PI_MODEL_PRO and MODEL', () => {
    process.env.MODEL = 'provider/default-model';
    process.env.PI_MODEL_PRO = 'provider/pi-pro-model';
    process.env.CONTRACT_PIPELINE_MODEL_PRO = 'provider/contract-pro-model';
    expect(getContractModelForRole('writer')).toBe('provider/contract-pro-model');
  });

  test('unknown role resolves to the flash tier', () => {
    process.env.CONTRACT_PIPELINE_MODEL_FLASH = 'provider/flash-model';
    expect(getContractModelForRole('unknown_role')).toBe('provider/flash-model');
  });

  test('thinking resolves from CONTRACT_PIPELINE_THINKING, then PI_THINKING', () => {
    process.env.PI_THINKING = 'low';
    expect(getContractThinkingForRole('writer')).toBe('low');

    process.env.CONTRACT_PIPELINE_THINKING = 'high';
    expect(getContractThinkingForRole('writer')).toBe('high');
  });

  test('thinking resolves from the tier level (FLASH_THINKING_LEVEL) before global keys', () => {
    process.env.PI_THINKING = 'low';
    process.env.CONTRACT_PIPELINE_THINKING = 'medium';
    process.env.FLASH_THINKING_LEVEL = 'xhigh';
    // critic/implementer/verifier map to the flash tier.
    expect(getContractThinkingForRole('critic')).toBe('xhigh');
    expect(getContractThinkingForRole('implementer')).toBe('xhigh');
    // writer/review map to pro — flash tier level does not apply.
    expect(getContractThinkingForRole('writer')).toBe('medium');
  });

  test('thinking resolves from the role level (WRITER_THINKING_LEVEL) before the tier level', () => {
    process.env.FLASH_THINKING_LEVEL = 'xhigh';
    process.env.WRITER_THINKING_LEVEL = 'minimal';
    expect(getContractThinkingForRole('writer')).toBe('minimal');
    expect(getContractThinkingForRole('critic')).toBe('xhigh');
  });

  test('PRO_THINKING_LEVEL applies to pro-tier roles', () => {
    process.env.PRO_THINKING_LEVEL = 'high';
    process.env.CONTRACT_PIPELINE_THINKING = 'minimal';
    expect(getContractThinkingForRole('writer')).toBe('high');
    expect(getContractThinkingForRole('review')).toBe('high');
    expect(getContractThinkingForRole('critic')).toBe('minimal');
  });

  test('role-specific thinking overrides each role independently', () => {
    process.env.CRITIC_THINKING_LEVEL = 'low';
    process.env.REVIEW_THINKING_LEVEL = 'xhigh';
    expect(getContractThinkingForRole('critic')).toBe('low');
    expect(getContractThinkingForRole('review')).toBe('xhigh');
    expect(getContractThinkingForRole('writer')).toBeUndefined();
  });

  test('a role-specific thinking override shadows the global keys for that role only', () => {
    process.env.WRITER_THINKING_LEVEL = 'off';
    process.env.CONTRACT_PIPELINE_THINKING = 'high';
    expect(getContractThinkingForRole('writer')).toBe('off');
    expect(getContractThinkingForRole('critic')).toBe('high');
  });

  test('WRITER_MODEL overrides the pro tier for the writer role only', () => {
    process.env.CONTRACT_PIPELINE_MODEL_PRO = 'provider/pro-model';
    process.env.CONTRACT_PIPELINE_MODEL_FLASH = 'provider/flash-model';
    process.env.WRITER_MODEL = 'provider/writer-model';
    expect(getContractModelForRole('writer')).toBe('provider/writer-model');
    expect(getContractModelForRole('review')).toBe('provider/pro-model');
    expect(getContractModelForRole('critic')).toBe('provider/flash-model');
  });

  test('role-specific model overrides every role independently', () => {
    process.env.CONTRACT_PIPELINE_MODEL_PRO = 'provider/pro-model';
    process.env.CONTRACT_PIPELINE_MODEL_FLASH = 'provider/flash-model';
    process.env.IMPLEMENTER_MODEL = 'provider/impl-model';
    process.env.VERIFIER_MODEL = 'provider/verifier-model';
    expect(getContractModelForRole('writer')).toBe('provider/pro-model');
    expect(getContractModelForRole('implementer')).toBe('provider/impl-model');
    expect(getContractModelForRole('verifier')).toBe('provider/verifier-model');
    expect(getContractModelForRole('critic')).toBe('provider/flash-model');
  });

  test('WRITER_MODEL wins over every tier key', () => {
    process.env.MODEL = 'provider/default-model';
    process.env.MODEL_PRO = 'provider/pro-model';
    process.env.PI_MODEL_PRO = 'provider/pi-pro-model';
    process.env.CONTRACT_PIPELINE_MODEL_PRO = 'provider/contract-pro-model';
    process.env.WRITER_MODEL = 'provider/writer-model';
    expect(getContractModelForRole('writer')).toBe('provider/writer-model');
  });

  test('an empty WRITER_MODEL falls through to the tier chain', () => {
    process.env.WRITER_MODEL = '';
    process.env.CONTRACT_PIPELINE_MODEL_PRO = 'provider/pro-model';
    expect(getContractModelForRole('writer')).toBe('provider/pro-model');
  });

  test('thinking returns undefined when unset or invalid', () => {
    expect(getContractThinkingForRole('writer')).toBeUndefined();

    process.env.CONTRACT_PIPELINE_THINKING = 'turbo';
    expect(getContractThinkingForRole('writer')).toBeUndefined();
  });
});

// ── AC-3: Model resolution records settings ──────────────────

describe('AC-3: Model resolution records settings', () => {
  test('resolveModelConfiguration returns all fields', () => {
    process.env.CONTRACT_PIPELINE_MODEL_PRO = 'provider/pro-model';
    const resolved = resolveModelConfiguration({ role: 'writer' });
    expect(resolved.requestedTier).toBe('pro');
    expect(resolved.requestedTierValue).toBe('provider/pro-model');
    expect(resolved.effectiveModel).toBe('provider/pro-model');
    expect(resolved.requestedThinking).toBeUndefined();
    expect(resolved.effectiveThinking).toBeUndefined();
    expect(Array.isArray(resolved.issues)).toBe(true);
  });

  test('writer resolves to pro tier', () => {
    const resolved = resolveModelConfiguration({ role: 'writer' });
    expect(resolved.requestedTier).toBe('pro');
  });

  test('critic resolves to flash tier', () => {
    const resolved = resolveModelConfiguration({ role: 'critic' });
    expect(resolved.requestedTier).toBe('flash');
  });

  test('implementer resolves to flash tier', () => {
    const resolved = resolveModelConfiguration({ role: 'implementer' });
    expect(resolved.requestedTier).toBe('flash');
  });

  test('verifier resolves to flash tier', () => {
    const resolved = resolveModelConfiguration({ role: 'verifier' });
    expect(resolved.requestedTier).toBe('flash');
  });

  test('review resolves to pro tier', () => {
    const resolved = resolveModelConfiguration({ role: 'review' });
    expect(resolved.requestedTier).toBe('pro');
  });

  test('unknown role resolves to flash (safe default)', () => {
    const resolved = resolveModelConfiguration({ role: 'unknown_role' });
    expect(resolved.requestedTier).toBe('flash');
  });
});

// ── AC-3: Tier equivalence reporting ─────────────────────────

describe('AC-3: Tier equivalence', () => {
  test('reports equivalence when pro and flash resolve to the same slug', () => {
    process.env.CONTRACT_PIPELINE_MODEL_PRO = 'provider/same-model';
    process.env.CONTRACT_PIPELINE_MODEL_FLASH = 'provider/same-model';
    const pro = resolveModelConfiguration({ role: 'implementer' });
    expect(pro.effectiveModel).toBe('provider/same-model');
    expect(pro.tierEquivalence).toContain('equivalent');
  });

  test('does NOT report equivalence when tiers are differentiated', () => {
    process.env.CONTRACT_PIPELINE_MODEL_PRO = 'provider/pro-model';
    process.env.CONTRACT_PIPELINE_MODEL_FLASH = 'provider/flash-model';
    const resolved = resolveModelConfiguration({ role: 'implementer' });
    expect(resolved.tierEquivalence).toBeNull();
  });

  test('does NOT report equivalence when neither tier is configured', () => {
    const resolved = resolveModelConfiguration({ role: 'implementer' });
    expect(resolved.effectiveModel).toBeUndefined();
    expect(resolved.tierEquivalence).toBeNull();
  });
});

// ── AC-3: Validation ─────────────────────────────────────────

describe('AC-3: Model override validation', () => {
  test('accepts a valid model slug', () => {
    const issues = validateModelOverride({ tier: 'pro', value: 'provider/model' });
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  test('rejects a model override that is too short', () => {
    const issues = validateModelOverride({ tier: 'pro', value: 'ab' });
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.field).toContain('MODEL_PRO');
  });

  test('rejects a model override with whitespace', () => {
    const issues = validateModelOverride({ tier: 'flash', value: 'invalid slug with spaces' });
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
  });

  test('no issues when no override is set (undefined)', () => {
    const issues = validateModelOverride({ tier: 'pro', value: undefined });
    expect(issues).toHaveLength(0);
  });

  test('an empty override falls through to the fallback keys (no error)', () => {
    process.env.CONTRACT_PIPELINE_MODEL_PRO = '';
    process.env.PI_MODEL_PRO = 'provider/pi-pro-model';
    const resolved = resolveModelConfiguration({ role: 'writer' });
    expect(resolved.requestedTierValue).toBe('provider/pi-pro-model');
    expect(resolved.effectiveModel).toBe('provider/pi-pro-model');
    expect(resolved.issues.filter((issue) => issue.severity === 'error')).toHaveLength(0);
  });

  test('an invalid role-specific model reports the role env key as the field', () => {
    process.env.WRITER_MODEL = 'bad model with spaces';
    const resolved = resolveModelConfiguration({ role: 'writer' });
    expect(resolved.effectiveModel).toBe('bad model with spaces');
    const errors = resolved.issues.filter((issue) => issue.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    const writerModelError = errors.find((error) => error.field === 'WRITER_MODEL');
    expect(writerModelError?.field).toBe('WRITER_MODEL');
  });

  test('an invalid role-specific thinking reports the role env key as the field', () => {
    process.env.WRITER_THINKING_LEVEL = 'turbo';
    const resolved = resolveModelConfiguration({ role: 'writer' });
    expect(resolved.requestedThinking).toBe('turbo');
    expect(resolved.effectiveThinking).toBeUndefined();
    expect(resolved.issues.some((issue) => issue.field === 'WRITER_THINKING_LEVEL')).toBe(true);
  });

  test('resolveModelConfiguration honours a role-specific model override', () => {
    process.env.WRITER_MODEL = 'provider/writer-model';
    process.env.CONTRACT_PIPELINE_MODEL_PRO = 'provider/pro-model';
    const resolved = resolveModelConfiguration({ role: 'writer' });
    expect(resolved.requestedTier).toBe('pro');
    expect(resolved.requestedTierValue).toBe('provider/pro-model');
    expect(resolved.effectiveModel).toBe('provider/writer-model');
  });
});

describe('AC-3: Thinking level validation', () => {
  test('accepts valid thinking levels', () => {
    for (const level of ['off', 'high', 'xhigh'] as const) {
      const issues = validateThinkingOverride({ value: level });
      expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    }
  });

  test('rejects invalid thinking level', () => {
    const issues = validateThinkingOverride({ value: 'turbo' });
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toContain('turbo');
  });

  test('no issues when thinking is not overridden', () => {
    const issues = validateThinkingOverride({ value: undefined });
    expect(issues).toHaveLength(0);
  });

  test('keeps invalid requested thinking distinct from the effective fallback', () => {
    process.env.CONTRACT_PIPELINE_THINKING = 'turbo';
    const resolved = resolveModelConfiguration({ role: 'implementer' });
    expect(resolved.requestedThinking).toBe('turbo');
    expect(resolved.effectiveThinking).toBeUndefined();
    expect(resolved.issues.some((issue) => issue.field === 'CONTRACT_PIPELINE_THINKING')).toBe(
      true,
    );
  });
});

describe('AC-3: hasBlockingModelErrors', () => {
  test('returns false for no issues', () => {
    expect(hasBlockingModelErrors([])).toBe(false);
  });

  test('returns false for warnings only', () => {
    const issues = [{ field: 'test', severity: 'warning' as const, message: 'warning' }];
    expect(hasBlockingModelErrors(issues)).toBe(false);
  });

  test('returns true when an error exists', () => {
    const issues = [{ field: 'test', severity: 'error' as const, message: 'error' }];
    expect(hasBlockingModelErrors(issues)).toBe(true);
  });
});

// ── AC-3: Legacy API preserved ───────────────────────────────

describe('AC-3: Legacy API', () => {
  test('CONTRACT_ROLE_MODEL_TIER has all roles', () => {
    for (const role of ['writer', 'critic', 'implementer', 'verifier', 'review']) {
      expect(CONTRACT_ROLE_MODEL_TIER[role]).toBeDefined();
    }
  });

  test('CONTRACT_ROLE_THINKING_LEVEL has all roles', () => {
    for (const role of ['writer', 'critic', 'implementer', 'verifier', 'review']) {
      expect(Object.hasOwn(CONTRACT_ROLE_THINKING_LEVEL, role)).toBe(true);
    }
  });
});
