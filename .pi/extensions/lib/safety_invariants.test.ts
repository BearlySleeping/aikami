// .pi/extensions/lib/safety_invariants.test.ts
//
// C-474 AC-5: Personal configuration and startup behavior remain safe.
// Verifies that global files are never rewritten, effective resource choices
// are inspectable, unknown config fails clearly, and the non-pipeline session
// remains usable.

import { describe, expect, test } from 'bun:test';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getForbiddenExtensions,
  getOptionalExtensions,
  getRoleProfile,
  isToolEnabledForRole,
  preflightRoleProfile,
  resolveEnabledExtensions,
} from './role_profiles.ts';

// ── AC-5: Non-pipeline session remains usable ──

describe('AC-5: Non-pipeline session loads all tools', () => {
  test('isToolEnabledForRole without role returns true for any key', () => {
    // This is the critical AC-5 invariant: a developer running a normal
    // Pi session (not a pipeline worker) must have access to ALL tools.
    const keys = [
      'gh_pr',
      'gh_release',
      'browser',
      'vision',
      'gcloud_exec',
      'direnv',
      'bash',
      'read',
      'edit',
      'write',
      'contract_stage',
      'mcp',
    ];
    for (const key of keys) {
      expect(isToolEnabledForRole(key)).toBe(true);
    }
  });

  test('resolveEnabledExtensions returns undefined (all tools) for non-pipeline', () => {
    expect(resolveEnabledExtensions(undefined)).toBeUndefined();
    expect(resolveEnabledExtensions('')).toBeUndefined();
  });

  test('getRoleProfile returns undefined for non-pipeline context', () => {
    expect(getRoleProfile(undefined)).toBeUndefined();
    expect(getRoleProfile('')).toBeUndefined();
  });
});

// ── AC-5: Effective resource choices are inspectable ──

describe('AC-5: Effective resource choices are inspectable', () => {
  test('getRoleProfile returns the full profile for any role', () => {
    for (const role of ['writer', 'critic', 'implementer', 'verifier', 'review']) {
      const profile = getRoleProfile(role);
      expect(profile).toBeDefined();
      expect(profile?.description).toBeTruthy();
      expect(Array.isArray(profile?.required)).toBe(true);
      expect(Array.isArray(profile?.optional)).toBe(true);
      expect(Array.isArray(profile?.forbidden)).toBe(true);
    }
  });

  test('resolveEnabledExtensions shows what is active for each role', () => {
    const writerExts = resolveEnabledExtensions('writer');
    expect(writerExts).toBeDefined();
    expect(writerExts?.length).toBeGreaterThan(0);

    const implementerExts = resolveEnabledExtensions('implementer');
    expect(implementerExts).toBeDefined();
    // Implementer has more extensions than writer
    const implLen = (implementerExts as NonNullable<typeof implementerExts>).length;
    const writerLen = (writerExts as NonNullable<typeof writerExts>).length;
    expect(implLen).toBeGreaterThanOrEqual(writerLen);
  });

  test('getForbiddenExtensions shows what is blocked for each role', () => {
    const writerForbidden = getForbiddenExtensions('writer');
    expect(writerForbidden.length).toBeGreaterThan(0);

    const reviewForbidden = getForbiddenExtensions('review');
    expect(reviewForbidden).toHaveLength(0); // review has no forbidden
  });

  test('getOptionalExtensions shows what can be enabled', () => {
    const implementerOptional = getOptionalExtensions('implementer');
    expect(implementerOptional).toContain('browser');
    expect(implementerOptional).toContain('vision');
  });
});

// ── AC-5: Unknown required configuration fails clearly ──

describe('AC-5: Unknown config fails clearly', () => {
  test('preflight for an unknown role produces errors', () => {
    const issues = preflightRoleProfile({ role: 'unknown_role' });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.key).toBe('unknown_role');
  });

  test('tool gating stays usable for an unknown role', () => {
    expect(isToolEnabledForRole('gh_pr', 'unknown_role')).toBe(true); // conservative default
  });

  test('preflight for profiles without capability overlap produces no errors', () => {
    for (const role of ['writer', 'critic', 'review']) {
      const issues = preflightRoleProfile({ role });
      expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    }
  });
});

// ── AC-5: No global file writes ──

describe('AC-5: No global file writes', () => {
  test('role_profiles module does not write files on isolated import', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'aikami-role-profiles-'));
    const fixtureModule = join(fixtureRoot, 'role_profiles.ts');
    copyFileSync(join(import.meta.dir, 'role_profiles.ts'), fixtureModule);
    const filesBefore = readdirSync(fixtureRoot, { recursive: true });
    const sourceBefore = readFileSync(fixtureModule, 'utf8');

    try {
      const result = Bun.spawnSync({
        cmd: [process.execPath, '-e', 'await import("./role_profiles.ts")'],
        cwd: fixtureRoot,
        stderr: 'pipe',
        stdout: 'pipe',
      });

      expect(result.exitCode).toBe(0);
      expect(readdirSync(fixtureRoot, { recursive: true })).toEqual(filesBefore);
      expect(readFileSync(fixtureModule, 'utf8')).toBe(sourceBefore);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });

  test('isToolEnabledForRole is a pure function with no side effects', () => {
    const before = getForbiddenExtensions('writer');
    isToolEnabledForRole('gh_pr', 'writer');
    const after = getForbiddenExtensions('writer');
    expect(after).toEqual(before); // No mutation
  });
});
