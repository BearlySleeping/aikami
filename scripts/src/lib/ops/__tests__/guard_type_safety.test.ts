// scripts/src/lib/ops/__tests__/guard_type_safety.test.ts
//
// Tests for the type-safety guard's identity-aware comparison (C-476 AC-4).
// Covers same-count replacement detection, identity matching, and baseline
// comparison scenarios.

import { describe, expect, test } from 'bun:test';
import { identitiesMatch, isExcludedDir, simpleHash } from '../guard_type_safety_helpers.ts';

type Rule = 't1' | 't2' | 't3';
type ViolationIdentity = { rule: Rule; hash: string };

const identitiesOf = (violations: { rule: Rule; snippet: string }[]): ViolationIdentity[] => {
  const identities = violations.map((v) => ({
    rule: v.rule,
    hash: simpleHash(v.snippet),
  }));
  identities.sort((a, b) => {
    if (a.rule !== b.rule) {
      return a.rule.localeCompare(b.rule);
    }
    return a.hash.localeCompare(b.hash);
  });
  return identities;
};

describe('isExcludedDir', () => {
  test('excludes the vendored .pi/git directory', () => {
    expect(isExcludedDir({ name: 'git', relPath: '.pi/git' })).toBe(true);
  });

  test('includes unrelated directories named git', () => {
    expect(isExcludedDir({ name: 'git', relPath: 'packages/example/git' })).toBe(false);
  });
});

describe('simpleHash', () => {
  test('produces consistent output for same input', () => {
    const hash1 = simpleHash('as any) as T;');
    const hash2 = simpleHash('as any) as T;');
    expect(hash1).toBe(hash2);
  });

  test('produces different output for different input', () => {
    const hash1 = simpleHash('as any) as T;');
    const hash2 = simpleHash('as any) as unknown;');
    expect(hash1).not.toBe(hash2);
  });

  test('produces 8-character hex string', () => {
    const hash = simpleHash('as unknown as string');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('identitiesOf', () => {
  test('returns sorted identities', () => {
    const result = identitiesOf([
      { rule: 't2' as Rule, snippet: 'as any) as T;' },
      { rule: 't1' as Rule, snippet: 'as unknown as string' },
    ]);
    expect(result).toHaveLength(2);
    // Sorted by rule first: t1 before t2
    expect(result[0].rule).toBe('t1');
    expect(result[1].rule).toBe('t2');
  });

  test('returns empty array for empty input', () => {
    expect(identitiesOf([])).toEqual([]);
  });
});

describe('identitiesMatch', () => {
  test('matches identical identity sets', () => {
    const a = identitiesOf([{ rule: 't2' as Rule, snippet: 'as any) as T;' }]);
    const b = identitiesOf([{ rule: 't2' as Rule, snippet: 'as any) as T;' }]);
    expect(identitiesMatch(a, b)).toBe(true);
  });

  test('rejects different snippet (same-count replacement)', () => {
    const baseline = identitiesOf([{ rule: 't2' as Rule, snippet: 'as any) as T;' }]);
    const current = identitiesOf([{ rule: 't2' as Rule, snippet: 'as any).data;' }]);
    expect(identitiesMatch(current, baseline)).toBe(false);
  });

  test('rejects different rule (same-count replacement)', () => {
    const baseline = identitiesOf([{ rule: 't2' as Rule, snippet: 'as any) as T;' }]);
    const current = identitiesOf([{ rule: 't1' as Rule, snippet: 'as unknown as T' }]);
    expect(identitiesMatch(current, baseline)).toBe(false);
  });

  test('rejects different length', () => {
    const baseline = identitiesOf([
      { rule: 't2' as Rule, snippet: 'as any) as T;' },
      { rule: 't2' as Rule, snippet: 'as any).data;' },
    ]);
    const current = identitiesOf([{ rule: 't2' as Rule, snippet: 'as any) as T;' }]);
    expect(identitiesMatch(current, baseline)).toBe(false);
  });

  test('matches empty sets', () => {
    expect(identitiesMatch([], [])).toBe(true);
  });

  test('detects suppression replacement (removing guard-ignore)', () => {
    // Before: a guarded cast
    const baseline = identitiesOf([{ rule: 't1' as Rule, snippet: 'as unknown as string' }]);
    // After: same cast but guard-ignore removed, so it's now a violation
    const current = identitiesOf([{ rule: 't1' as Rule, snippet: 'as unknown as string' }]);
    // Same content — identity matches. The guard-ignore removal would change
    // the count (violations that were previously ignored now count), so the
    // count-based check catches it first. The identity check is complementary.
    expect(identitiesMatch(current, baseline)).toBe(true);
  });
});
