// scripts/src/lib/agents/contract_pipeline/validation_policy.test.ts
//
// Tests for the shared validation policy.
// AC-2: Consumers share the check policy.
// AC-4: Failed or unavailable checks prevent promotion.
// AC-5: Safety and cancellation cannot be bypassed.

import { describe, expect, it } from 'bun:test';
import {
  type CheckResult,
  createValidationArtifact,
  determineOverallOutcome,
  formatValidationReport,
  getPolicy,
  getRequiredChecks,
  isArtifactFresh,
  isBlockingOutcome,
  type ValidationProfile,
} from './validation_policy.ts';

// ── Policy Definitions (AC-2) ──────────────────────────────────────

describe('getPolicy (AC-2)', () => {
  it('returns a policy for the focused profile', () => {
    const policy = getPolicy('focused');
    expect(policy).toBeDefined();
    expect(policy?.profile).toBe('focused');
    expect(policy?.requiredChecks.length).toBeGreaterThan(0);
    expect(policy?.optionalChecks.length).toBe(0);
    expect(policy?.excludedChecks).toContain(':build');
  });

  it('returns a policy for the pre_publication profile', () => {
    const policy = getPolicy('pre_publication');
    expect(policy).toBeDefined();
    expect(policy?.profile).toBe('pre_publication');
    expect(policy?.requiredChecks.length).toBeGreaterThan(0);
    expect(policy?.structuralGuards.length).toBeGreaterThan(0);
  });

  it('returns a policy for the ci profile', () => {
    const policy = getPolicy('ci');
    expect(policy).toBeDefined();
    expect(policy?.profile).toBe('ci');
    // CI includes build and test as required
    const tasks = policy?.requiredChecks.map((c) => c.task);
    expect(tasks).toContain(':build');
    expect(tasks).toContain(':test');
  });

  it('returns undefined for unknown profiles', () => {
    expect(getPolicy('unknown' as ValidationProfile)).toBeUndefined();
  });

  it('equivalent policy inputs produce equivalent required checks (AC-2)', () => {
    const policy1 = getPolicy('focused');
    const policy2 = getPolicy('focused');
    expect(policy1?.requiredChecks).toEqual(policy2?.requiredChecks);
    expect(policy1?.structuralGuards).toEqual(policy2?.structuralGuards);
  });
});

describe('getRequiredChecks (AC-2)', () => {
  it('includes both required checks and structural guards', () => {
    const checks = getRequiredChecks('pre_publication');
    expect(checks.length).toBeGreaterThanOrEqual(2);
    // At least one guard should be present
    const guards = checks.filter((c) => c.guard);
    expect(guards.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty array for unknown profile', () => {
    expect(getRequiredChecks('unknown' as ValidationProfile)).toEqual([]);
  });
});

// ── Check Outcomes (AC-4, AC-5) ────────────────────────────────────

describe('isBlockingOutcome (AC-4, AC-5)', () => {
  it('failed is blocking', () => {
    expect(isBlockingOutcome('failed')).toBe(true);
  });

  it('unavailable is blocking', () => {
    expect(isBlockingOutcome('unavailable')).toBe(true);
  });

  it('cancelled is blocking (AC-5)', () => {
    expect(isBlockingOutcome('cancelled')).toBe(true);
  });

  it('passed is not blocking', () => {
    expect(isBlockingOutcome('passed')).toBe(false);
  });

  it('not_applicable is not blocking', () => {
    expect(isBlockingOutcome('not_applicable')).toBe(false);
  });
});

// ── Overall Outcome Determination (AC-4) ───────────────────────────

describe('determineOverallOutcome (AC-4)', () => {
  const profile: ValidationProfile = 'focused';

  it('all required checks passed → passed', () => {
    const results: CheckResult[] = [
      { check: ':fix', label: 'Fix', outcome: 'passed', diagnostics: '' },
      { check: ':typecheck', label: 'Typecheck', outcome: 'passed', diagnostics: '' },
    ];
    expect(determineOverallOutcome({ profile, results })).toBe('passed');
  });

  it('a required check failed → failed', () => {
    const results: CheckResult[] = [
      { check: ':fix', label: 'Fix', outcome: 'passed', diagnostics: '' },
      { check: ':typecheck', label: 'Typecheck', outcome: 'failed', diagnostics: 'TS error' },
    ];
    expect(determineOverallOutcome({ profile, results })).toBe('failed');
  });

  it('a required check is unavailable → unavailable', () => {
    const results: CheckResult[] = [
      { check: ':fix', label: 'Fix', outcome: 'unavailable', diagnostics: 'moon not found' },
      { check: ':typecheck', label: 'Typecheck', outcome: 'passed', diagnostics: '' },
    ];
    expect(determineOverallOutcome({ profile, results })).toBe('unavailable');
  });

  it('a required check is cancelled → unavailable (AC-5)', () => {
    const results: CheckResult[] = [
      { check: ':fix', label: 'Fix', outcome: 'cancelled', diagnostics: 'killed by signal' },
      { check: ':typecheck', label: 'Typecheck', outcome: 'passed', diagnostics: '' },
    ];
    expect(determineOverallOutcome({ profile, results })).toBe('unavailable');
  });

  it('optional check failures are ignored for overall outcome', () => {
    // focused profile has no optional checks by default, so this tests
    // that a result for an unknown check doesn't affect outcome
    const results: CheckResult[] = [
      { check: ':fix', label: 'Fix', outcome: 'passed', diagnostics: '' },
      { check: ':typecheck', label: 'Typecheck', outcome: 'passed', diagnostics: '' },
      { check: 'e2e:test', label: 'E2E', outcome: 'failed', diagnostics: 'timeout' },
    ];
    expect(determineOverallOutcome({ profile, results })).toBe('passed');
  });
});

// ── Validation Artifact (AC-3) ─────────────────────────────────────

describe('createValidationArtifact (AC-3)', () => {
  it('creates a versioned artifact with candidate binding', () => {
    const artifact = createValidationArtifact({
      candidateFingerprint: 'abc123def456',
      profile: 'focused',
      results: [{ check: ':fix', label: 'Fix', outcome: 'passed', diagnostics: '' }],
    });
    expect(artifact.version).toBe(1);
    expect(artifact.candidateFingerprint).toBe('abc123def456');
    expect(artifact.profile).toBe('focused');
    expect(artifact.overallOutcome).toBe('passed');
    expect(artifact.timestamp).toBeTruthy();
  });

  it('records overall failure', () => {
    const artifact = createValidationArtifact({
      candidateFingerprint: 'hash1',
      profile: 'focused',
      results: [{ check: ':fix', label: 'Fix', outcome: 'failed', diagnostics: 'lint error' }],
    });
    expect(artifact.overallOutcome).toBe('failed');
  });
});

describe('isArtifactFresh (AC-3)', () => {
  const artifact = createValidationArtifact({
    candidateFingerprint: 'abc123',
    baseFingerprint: 'base-1',
    profile: 'focused',
    results: [{ check: ':fix', label: 'Fix', outcome: 'passed', diagnostics: '' }],
  });

  it('same candidate → fresh', () => {
    expect(isArtifactFresh({ artifact, currentFingerprint: 'abc123' })).toBe(true);
  });

  it('different candidate → stale', () => {
    expect(isArtifactFresh({ artifact, currentFingerprint: 'different' })).toBe(false);
  });

  it('same candidate but different base → stale', () => {
    expect(
      isArtifactFresh({
        artifact,
        currentFingerprint: 'abc123',
        currentBaseFingerprint: 'base-2',
      }),
    ).toBe(false);
  });

  it('same candidate and same base → fresh', () => {
    expect(
      isArtifactFresh({
        artifact,
        currentFingerprint: 'abc123',
        currentBaseFingerprint: 'base-1',
      }),
    ).toBe(true);
  });

  it('artifact without base fingerprint is still fresh when candidate matches', () => {
    const noBase = createValidationArtifact({
      candidateFingerprint: 'xyz',
      profile: 'focused',
      results: [],
    });
    expect(isArtifactFresh({ artifact: noBase, currentFingerprint: 'xyz' })).toBe(true);
  });
});

// ── Formatting ─────────────────────────────────────────────────────

describe('formatValidationReport', () => {
  it('includes profile, outcome, and freshness', () => {
    const artifact = createValidationArtifact({
      candidateFingerprint: 'abc123',
      profile: 'focused',
      results: [{ check: ':fix', label: 'Fix', outcome: 'passed', diagnostics: '' }],
    });
    const report = formatValidationReport({ artifact, fresh: true });
    expect(report).toContain('Validation [focused]');
    expect(report).toContain('✅');
    expect(report).not.toContain('STALE');
  });

  it('marks stale artifacts', () => {
    const artifact = createValidationArtifact({
      candidateFingerprint: 'old',
      profile: 'focused',
      results: [],
    });
    const report = formatValidationReport({ artifact, fresh: false });
    expect(report).toContain('STALE');
  });

  it('shows diagnostics for failed checks', () => {
    const artifact = createValidationArtifact({
      candidateFingerprint: 'h1',
      profile: 'focused',
      results: [
        { check: ':fix', label: 'Fix', outcome: 'failed', diagnostics: 'lint error in src/' },
      ],
    });
    const report = formatValidationReport({ artifact, fresh: true });
    expect(report).toContain('lint error in src/');
  });
});
