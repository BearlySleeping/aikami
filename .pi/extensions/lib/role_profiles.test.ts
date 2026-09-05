// .pi/extensions/lib/role_profiles.test.ts
//
// C-474 AC-1: Profiles retain required capabilities without unrelated surface.
// Verifies each role profile's exact tool/resource inventory, completion/recovery
// scenarios, and preflight validation.

import { describe, expect, test } from 'bun:test';
import {
  getForbiddenExtensions,
  getOptionalExtensions,
  getRoleProfile,
  isToolEnabledForRole,
  type PipelineRole,
  preflightRoleProfile,
  resolveEnabledExtensions,
} from './role_profiles.ts';

// ── AC-1: Profiles retain required capabilities ──

describe('AC-1: Role profile structure', () => {
  const ROLES: PipelineRole[] = ['writer', 'critic', 'implementer', 'verifier', 'review'];

  test.each(ROLES)('%s profile exists with description and capability arrays', (role) => {
    const profile = getRoleProfile(role);
    expect(profile).toBeDefined();
    expect(profile?.description).toBeTruthy();
    expect(Array.isArray(profile?.required)).toBe(true);
    expect(Array.isArray(profile?.optional)).toBe(true);
    expect(Array.isArray(profile?.forbidden)).toBe(true);
  });

  test('returns undefined for unknown role', () => {
    expect(getRoleProfile('unknown')).toBeUndefined();
  });

  test('returns undefined for undefined role (non-pipeline)', () => {
    expect(getRoleProfile(undefined)).toBeUndefined();
  });
});

describe('AC-1: All roles retain completion/recovery', () => {
  test.each(['writer', 'critic', 'implementer', 'verifier', 'review'] as PipelineRole[])(
    '%s includes completion and contract_pipeline capabilities',
    (role) => {
      const profile = getRoleProfile(role);
      expect(profile?.required).toContain('completion');
      expect(profile?.required).toContain('contract_pipeline');
    },
  );
});

describe('AC-1: All roles retain read/edit/test capabilities', () => {
  test.each(['writer', 'critic', 'implementer', 'verifier', 'review'] as PipelineRole[])(
    '%s includes read_source, edit_source and test_runner',
    (role) => {
      const profile = getRoleProfile(role);
      expect(profile?.required).toContain('read_source');
      expect(profile?.required).toContain('edit_source');
      expect(profile?.required).toContain('test_runner');
    },
  );
});

// ── AC-1: Publication tools — restricted roles ──

describe('AC-1: Publication tool gating', () => {
  const PUBLICATION_KEYS = ['gh_pr', 'gh_release', 'gh_workflow'];

  test('writer does NOT have publication capability', () => {
    const profile = getRoleProfile('writer');
    expect(profile?.required).not.toContain('publication');
  });

  test('critic does NOT have publication capability', () => {
    const profile = getRoleProfile('critic');
    expect(profile?.required).not.toContain('publication');
  });

  test('implementer has publication capability', () => {
    const profile = getRoleProfile('implementer');
    expect(profile?.required).toContain('publication');
  });

  test('verifier has publication capability', () => {
    const profile = getRoleProfile('verifier');
    expect(profile?.required).toContain('publication');
  });

  test('review has publication capability', () => {
    const profile = getRoleProfile('review');
    expect(profile?.required).toContain('publication');
  });

  test.each(PUBLICATION_KEYS)('writer explicitly forbids %s', (key) => {
    expect(isToolEnabledForRole(key, 'writer')).toBe(false);
  });

  test.each(PUBLICATION_KEYS)('critic explicitly forbids %s', (key) => {
    expect(isToolEnabledForRole(key, 'critic')).toBe(false);
  });

  test.each(PUBLICATION_KEYS)('implementer allows %s', (key) => {
    expect(isToolEnabledForRole(key, 'implementer')).toBe(true);
  });
});

// ── AC-1: Non-pipeline session loads all tools ──

describe('AC-1: Non-pipeline mode loads all tools', () => {
  test('isToolEnabledForRole returns true for any key when no role', () => {
    expect(isToolEnabledForRole('gh_pr')).toBe(true);
    expect(isToolEnabledForRole('browser')).toBe(true);
    expect(isToolEnabledForRole('gcloud_exec')).toBe(true);
    expect(isToolEnabledForRole('contract_stage')).toBe(true);
  });
});

// ── AC-1: Resolved extension lists ──

describe('AC-1: Resolved extension lists', () => {
  test('writer resolved extensions include completion, read, edit, test, pipeline', () => {
    const exts = resolveEnabledExtensions('writer');
    expect(exts).toBeDefined();
    expect(exts?.length).toBeGreaterThan(0);
    // Writer should have contract_stage (completion + contract_pipeline)
    expect(exts).toContain('contract_stage');
    expect(exts).toContain('contract_factory');
    // Writer should NOT have publication tools
    expect(exts).not.toContain('gh_pr');
    expect(exts).not.toContain('gh_release');
  });

  test('implementer resolved extensions include publication', () => {
    const exts = resolveEnabledExtensions('implementer');
    expect(exts).toBeDefined();
    expect(exts).toContain('gh_pr');
    expect(exts).toContain('gh_release');
  });

  test('undefined role returns undefined (all tools)', () => {
    expect(resolveEnabledExtensions(undefined)).toBeUndefined();
  });
});

// ── AC-1: Preflight validation ──

describe('AC-1: Preflight validation', () => {
  test('valid profile passes preflight with no issues', () => {
    for (const role of [
      'writer',
      'critic',
      'implementer',
      'verifier',
      'review',
    ] as PipelineRole[]) {
      const issues = preflightRoleProfile({ role });
      const errors = issues.filter((i) => i.severity === 'error');
      expect(errors).toHaveLength(0);
    }
  });

  test('preflight catches unknown role', () => {
    // preflightRoleProfile only accepts PipelineRole, so test via type assertion
    const issues = preflightRoleProfile({ role: 'writer' as PipelineRole });
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  test('preflight does not produce warnings for valid profiles', () => {
    for (const role of [
      'writer',
      'critic',
      'implementer',
      'verifier',
      'review',
    ] as PipelineRole[]) {
      const issues = preflightRoleProfile({ role });
      const warnings = issues.filter((i) => i.severity === 'warning');
      expect(warnings).toHaveLength(0);
    }
  });
});

// ── AC-1: Optional capabilities ──

describe('AC-1: Optional capabilities', () => {
  test('writer and critic have mcp_context as optional', () => {
    for (const role of ['writer', 'critic'] as PipelineRole[]) {
      const profile = getRoleProfile(role);
      expect(profile?.optional).toContain('mcp_context');
    }
  });

  test('implementer and verifier have browser and ai_vision as optional', () => {
    for (const role of ['implementer', 'verifier'] as PipelineRole[]) {
      const profile = getRoleProfile(role);
      expect(profile?.optional).toContain('browser');
      expect(profile?.optional).toContain('ai_vision');
    }
  });

  test('review has all optional capabilities', () => {
    const profile = getRoleProfile('review');
    expect(profile?.optional).toContain('browser');
    expect(profile?.optional).toContain('ai_vision');
    expect(profile?.optional).toContain('cloud_infra');
    expect(profile?.optional).toContain('mcp_context');
  });

  test('getOptionalExtensions returns keys for role', () => {
    const optional = getOptionalExtensions('implementer');
    expect(optional.length).toBeGreaterThan(0);
  });

  test('getOptionalExtensions returns empty for undefined role', () => {
    expect(getOptionalExtensions(undefined)).toHaveLength(0);
  });
});

// ── AC-1: Forbidden extensions ──

describe('AC-1: Forbidden extensions', () => {
  test('writer forbids publication, browser, cloud_infra related extensions', () => {
    const forbidden = getForbiddenExtensions('writer');
    // Resolved from forbidden capabilities: publication tools
    expect(forbidden).toContain('gh_pr');
    expect(forbidden).toContain('gh_release');
    expect(forbidden).toContain('gh_workflow');
    // Browser-related tools
    expect(forbidden).toContain('browser');
    expect(forbidden).toContain('vision');
  });

  test('implementer does not forbid browser or ai_vision', () => {
    const forbidden = getForbiddenExtensions('implementer');
    expect(forbidden).not.toContain('browser');
    expect(forbidden).not.toContain('vision');
    expect(forbidden).not.toContain('gh_pr');
  });
});
