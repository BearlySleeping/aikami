// scripts/src/lib/ops/__tests__/guard_policy_diff.test.ts
//
// Tests for guard-policy change classification: the three verdicts, the lint
// severity comparison, and the requirement that an unauthorized allowance
// increase is machine-detectable rather than left to a reviewer's eye.

import { describe, expect, test } from 'bun:test';
import {
  classifyPolicyChange,
  compareLintSeverities,
  policyKindFor,
  renderPolicyReport,
} from '../guards/policy_diff.ts';

describe('policyKindFor', () => {
  test('classifies each kind of policy artifact', () => {
    expect(policyKindFor('scripts/src/lib/ops/guard_type_safety_baseline.json')).toBe('allowance');
    expect(policyKindFor('scripts/src/lib/ops/guard_source_file_size_waivers.json')).toBe(
      'allowance',
    );
    expect(policyKindFor('scripts/src/lib/ops/guard_source_file_size_exceptions.json')).toBe(
      'allowance',
    );
    expect(policyKindFor('biome.json')).toBe('lint-config');
    expect(policyKindFor('.github/workflows/pr-checks.yml')).toBe('ci-wiring');
    expect(policyKindFor('.moon/tasks/scripts.yml')).toBe('ci-wiring');
    expect(policyKindFor('scripts/src/lib/agents/contract_pipeline/validation_policy.ts')).toBe(
      'ci-wiring',
    );
    expect(policyKindFor('scripts/src/lib/agents/contract_pipeline/pre_push_gate.ts')).toBe(
      'ci-wiring',
    );
    expect(policyKindFor('scripts/src/lib/ops/guard_source_file_size.ts')).toBe(
      'guard-implementation',
    );
    expect(policyKindFor('scripts/src/lib/ops/guards/ratchet.ts')).toBe('guard-implementation');
  });
});

describe('compareLintSeverities', () => {
  const config = (rule: string, level: string) => ({
    linter: { rules: { complexity: { [rule]: level } } },
  });

  test('detects a relaxed severity', () => {
    const { relaxed, tightened } = compareLintSeverities({
      before: config('noExcessiveCognitiveComplexity', 'error'),
      after: config('noExcessiveCognitiveComplexity', 'warn'),
    });
    expect(relaxed).toEqual(['complexity/noExcessiveCognitiveComplexity: error → warn']);
    expect(tightened).toEqual([]);
  });

  test('detects a tightened severity', () => {
    const { relaxed, tightened } = compareLintSeverities({
      before: config('noExcessiveCognitiveComplexity', 'warn'),
      after: config('noExcessiveCognitiveComplexity', 'error'),
    });
    expect(tightened).toEqual(['complexity/noExcessiveCognitiveComplexity: warn → error']);
    expect(relaxed).toEqual([]);
  });

  test('reads the object form of a rule configuration', () => {
    const { relaxed } = compareLintSeverities({
      before: { linter: { rules: { complexity: { noForEach: { level: 'error' } } } } },
      after: { linter: { rules: { complexity: { noForEach: { level: 'off' } } } } },
    });
    expect(relaxed).toHaveLength(1);
  });

  test('treats a newly configured rule as a tightening', () => {
    const { tightened } = compareLintSeverities({
      before: {},
      after: config('noNestedTernary', 'error'),
    });
    expect(tightened).toHaveLength(1);
  });

  test('flags removal of a rule that was stricter than warn', () => {
    const { relaxed } = compareLintSeverities({
      before: config('noNestedTernary', 'error'),
      after: {},
    });
    expect(relaxed).toEqual(['complexity/noNestedTernary: error → (unset)']);
  });

  test('does not flag removal of a warn-level rule (the preset may still cover it)', () => {
    const { relaxed } = compareLintSeverities({
      before: config('noNestedTernary', 'warn'),
      after: {},
    });
    expect(relaxed).toEqual([]);
  });

  test('an unchanged config produces no changes', () => {
    const { relaxed, tightened } = compareLintSeverities({
      before: config('noForEach', 'error'),
      after: config('noForEach', 'error'),
    });
    expect(relaxed).toEqual([]);
    expect(tightened).toEqual([]);
  });
});

describe('classifyPolicyChange', () => {
  test('no changed policy files is a no-op verdict', () => {
    expect(classifyPolicyChange({ changedPaths: [] }).verdict).toBe('no-policy-change');
  });

  test('an allowance reduction is debt-reduction', () => {
    const report = classifyPolicyChange({
      changedPaths: ['scripts/src/lib/ops/guard_type_safety_baseline.json'],
      beforeAllowances: { 'a.ts': 900 },
      afterAllowances: { 'a.ts': 850 },
    });
    expect(report.verdict).toBe('debt-reduction');
    expect(report.expansions).toEqual([]);
  });

  test('an allowance increase is policy-expansion', () => {
    const report = classifyPolicyChange({
      changedPaths: ['scripts/src/lib/ops/guard_source_file_size_waivers.json'],
      beforeAllowances: { 'a.ts': 900 },
      afterAllowances: { 'a.ts': 950 },
    });
    expect(report.verdict).toBe('policy-expansion');
    expect(report.expansions).toHaveLength(1);
  });

  test('a new allowance is policy-expansion', () => {
    const report = classifyPolicyChange({
      changedPaths: ['scripts/src/lib/ops/guard_source_file_size_waivers.json'],
      beforeAllowances: {},
      afterAllowances: { 'new.ts': 1200 },
    });
    expect(report.verdict).toBe('policy-expansion');
  });

  test('a representation change with the same allowance is a refactor, not an expansion', () => {
    const report = classifyPolicyChange({
      changedPaths: [
        'scripts/src/lib/ops/guard_source_file_size_baseline.json',
        'scripts/src/lib/ops/guard_source_file_size_waivers.json',
      ],
      beforeAllowances: { 'a.ts': 1160 },
      afterAllowances: { 'a.ts': 1160 },
    });
    expect(report.verdict).toBe('policy-refactor');
    expect(report.expansions).toEqual([]);
  });

  test('a relaxed lint severity is policy-expansion', () => {
    const report = classifyPolicyChange({
      changedPaths: ['biome.json'],
      biomeBefore: { linter: { rules: { complexity: { noForEach: 'error' } } } },
      biomeAfter: { linter: { rules: { complexity: { noForEach: 'off' } } } },
    });
    expect(report.verdict).toBe('policy-expansion');
    expect(report.relaxedLintRules).toHaveLength(1);
  });

  test('a guard implementation edit with no allowance change is a refactor', () => {
    const report = classifyPolicyChange({
      changedPaths: ['scripts/src/lib/ops/guard_source_file_size.ts'],
    });
    expect(report.verdict).toBe('policy-refactor');
  });

  test('a refactor that also reduces an allowance is still debt-reduction', () => {
    const report = classifyPolicyChange({
      changedPaths: [
        'scripts/src/lib/ops/guard_source_file_size.ts',
        'scripts/src/lib/ops/guard_source_file_size_baseline.json',
      ],
      beforeAllowances: { 'a.ts': 900 },
      afterAllowances: {},
    });
    expect(report.verdict).toBe('debt-reduction');
  });

  test('a refactor that also raises an allowance is policy-expansion', () => {
    const report = classifyPolicyChange({
      changedPaths: [
        'scripts/src/lib/ops/guard_source_file_size.ts',
        'scripts/src/lib/ops/guard_source_file_size_baseline.json',
      ],
      beforeAllowances: { 'a.ts': 900 },
      afterAllowances: { 'a.ts': 1000 },
    });
    expect(report.verdict).toBe('policy-expansion');
  });
});

describe('renderPolicyReport', () => {
  const expansionReport = classifyPolicyChange({
    changedPaths: ['scripts/src/lib/ops/guard_source_file_size_waivers.json'],
    beforeAllowances: { 'a.ts': 900 },
    afterAllowances: { 'a.ts': 950 },
  });

  test('labels an unauthorized expansion and names the human channel', () => {
    const text = renderPolicyReport({ report: expansionReport, authorized: false }).join('\n');
    expect(text).toContain('GUARD POLICY CHANGE');
    expect(text).toContain('POLICY EXPANSION');
    expect(text).toContain('guard-policy-approved');
    expect(text).toContain('must NOT land this change');
  });

  test('records an authorized expansion as reviewed', () => {
    const text = renderPolicyReport({ report: expansionReport, authorized: true }).join('\n');
    expect(text).toContain('Authorization present');
    expect(text).not.toContain('must NOT land this change');
  });

  test('a clean diff renders a single line', () => {
    const lines = renderPolicyReport({
      report: classifyPolicyChange({ changedPaths: [] }),
      authorized: false,
    });
    expect(lines).toEqual(['✅ no guard-policy change in this diff']);
  });
});
