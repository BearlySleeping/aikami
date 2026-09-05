// scripts/src/lib/agents/contract_pipeline/models.test.ts
//
// C-474 AC-3: Model and thinking choices are explicit and valid.
// Verifies that resolution records requested/effective settings, rejects
// invalid overrides, and reports tier equivalence explicitly.

import { beforeEach, describe, expect, test } from 'bun:test';
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
] as const;

beforeEach(() => {
  // Reset env vars to defaults for each test
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

// ── AC-3: Model resolution records requested and effective settings ──

describe('AC-3: Model resolution records settings', () => {
  test('resolveModelConfiguration returns all fields', () => {
    const resolved = resolveModelConfiguration({ role: 'implementer' });
    expect(resolved.requestedTier).toBe('pro');
    expect(resolved.requestedTierValue).toBeDefined();
    expect(resolved.effectiveModel).toBeDefined();
    expect(resolved.effectiveModel.length).toBeGreaterThan(0);
    expect(resolved.defaultModel).toBeDefined();
    expect(typeof resolved.overridden).toBe('boolean');
    expect(resolved.requestedThinking).toBeDefined();
    expect(resolved.effectiveThinking).toBeDefined();
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

  test('implementer resolves to pro tier', () => {
    const resolved = resolveModelConfiguration({ role: 'implementer' });
    expect(resolved.requestedTier).toBe('pro');
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

// ── AC-3: Env override detection ──

describe('AC-3: Env override detection', () => {
  test('detects no override when env is not set', () => {
    const resolved = resolveModelConfiguration({ role: 'implementer' });
    expect(resolved.overridden).toBe(false);
    expect(resolved.effectiveModel).toBe(resolved.defaultModel);
  });

  test('detects override when env is set', () => {
    process.env.CONTRACT_PIPELINE_MODEL_PRO = 'deepseek/deepseek-v4-pro';
    const resolved = resolveModelConfiguration({ role: 'implementer' });
    expect(resolved.overridden).toBe(true);
    expect(resolved.effectiveModel).not.toBe(resolved.defaultModel);
  });

  test('override affects only the overridden tier', () => {
    process.env.CONTRACT_PIPELINE_MODEL_FLASH = 'deepseek/deepseek-v4-flash';
    const pro = resolveModelConfiguration({ role: 'writer' }); // pro tier
    const flash = resolveModelConfiguration({ role: 'critic' }); // flash tier
    expect(pro.overridden).toBe(false); // pro not overridden
    expect(flash.overridden).toBe(true); // flash overridden
  });
});

// ── AC-3: Tier equivalence reporting ──

describe('AC-3: Tier equivalence', () => {
  test('reports equivalence when pro and flash are the same slug', () => {
    // Default: both pro and flash point at the same DeepSeek-V4-Flash
    const resolved = resolveModelConfiguration({ role: 'implementer' });
    if (resolved.effectiveModel === resolveModelConfiguration({ role: 'critic' }).effectiveModel) {
      expect(resolved.tierEquivalence).not.toBeNull();
      expect(resolved.tierEquivalence).toContain('equivalent');
    }
  });

  test('does NOT report equivalence when tiers are differentiated', () => {
    process.env.CONTRACT_PIPELINE_MODEL_PRO = 'deepseek/deepseek-v4-pro';
    const resolved = resolveModelConfiguration({ role: 'implementer' });
    // pro is now differentiated from flash
    const flashModel = resolveModelConfiguration({ role: 'critic' });
    if (resolved.effectiveModel !== flashModel.effectiveModel) {
      expect(resolved.tierEquivalence).toBeNull();
    }
  });

  test('warns when the role uses a tier that is equivalent to another', () => {
    const resolved = resolveModelConfiguration({ role: 'implementer' });
    const tierWarnings = resolved.issues.filter(
      (i) => i.field.startsWith('tier:') && i.severity === 'warning',
    );
    if (resolved.tierEquivalence) {
      expect(tierWarnings.length).toBeGreaterThan(0);
    }
  });
});

// ── AC-3: Validation ──

describe('AC-3: Model override validation', () => {
  test('accepts a valid model slug', () => {
    const issues = validateModelOverride({
      tier: 'pro',
      value: 'deepinfra/deepseek-ai/DeepSeek-V4-Flash',
    });
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  test('rejects a model override that is too short', () => {
    const issues = validateModelOverride({ tier: 'pro', value: 'ab' });
    const errors = issues.filter((i) => i.severity === 'error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].field).toContain('MODEL_PRO');
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
    expect(errors[0].message).toContain('turbo');
  });

  test('no issues when thinking is not overridden', () => {
    const issues = validateThinkingOverride({ value: undefined });
    expect(issues).toHaveLength(0);
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

// ── AC-3: Legacy API preserved ──

describe('AC-3: Legacy API', () => {
  test('getContractModelForRole returns a string for known roles', () => {
    for (const role of ['writer', 'critic', 'implementer', 'verifier', 'review']) {
      const model = getContractModelForRole(role);
      expect(typeof model).toBe('string');
      expect(model.length).toBeGreaterThan(0);
    }
  });

  test('getContractThinkingForRole returns a valid thinking level', () => {
    for (const role of ['writer', 'critic', 'implementer', 'verifier', 'review']) {
      const level = getContractThinkingForRole(role);
      expect(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).toContain(level);
    }
  });

  test('CONTRACT_ROLE_MODEL_TIER has all roles', () => {
    for (const role of ['writer', 'critic', 'implementer', 'verifier', 'review']) {
      expect(CONTRACT_ROLE_MODEL_TIER[role]).toBeDefined();
    }
  });

  test('CONTRACT_ROLE_THINKING_LEVEL has all roles', () => {
    for (const role of ['writer', 'critic', 'implementer', 'verifier', 'review']) {
      expect(CONTRACT_ROLE_THINKING_LEVEL[role]).toBeDefined();
    }
  });
});
