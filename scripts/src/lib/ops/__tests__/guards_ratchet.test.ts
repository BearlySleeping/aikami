// scripts/src/lib/ops/__tests__/guards_ratchet.test.ts
//
// Tests for the shared ratchet framework (scripts/src/lib/ops/guards/ratchet.ts).
//
// These pin the semantics that every ratcheted guard now inherits, and that two
// guards previously got wrong:
//
//   • unchanged debt passes;
//   • increased debt fails;
//   • new debt fails;
//   • a reduction passes but must be locked in;
//   • `--update-baseline` synchronizes reductions and refuses every expansion;
//   • same-count identity replacement is an expansion, not a no-op.

import { describe, expect, test } from 'bun:test';
import {
  baselineFromViolations,
  contractAllowances,
  contractCounts,
  diffAllowances,
  diffCounts,
  parseCountsBaseline,
  type RatchetBaseline,
  type RuleCounts,
  renderExpansions,
  serializeAllowances,
  serializeCounts,
  simpleHash,
} from '../guards/ratchet.ts';

const counts = (value: Record<string, number>): RuleCounts => value;

describe('diffCounts — expansions', () => {
  test('unchanged debt produces no changes', () => {
    const baseline: RatchetBaseline = { 'a.ts': { counts: counts({ t2: 2 }) } };
    const current: RatchetBaseline = { 'a.ts': { counts: counts({ t2: 2 }) } };
    const diff = diffCounts({ baseline, current });
    expect(diff.expansions).toEqual([]);
    expect(diff.reductions).toEqual([]);
  });

  test('increased debt is an increase expansion', () => {
    const diff = diffCounts({
      baseline: { 'a.ts': { counts: counts({ t2: 1 }) } },
      current: { 'a.ts': { counts: counts({ t2: 3 }) } },
    });
    expect(diff.expansions).toHaveLength(1);
    expect(diff.expansions[0]?.kind).toBe('increase');
    expect(diff.expansions[0]?.detail).toBe('1 → 3');
  });

  test('debt in a file with no baseline entry is a new-file expansion', () => {
    const diff = diffCounts({
      baseline: {},
      current: { 'new.ts': { counts: counts({ t2: 1 }) } },
    });
    expect(diff.expansions).toHaveLength(1);
    expect(diff.expansions[0]?.kind).toBe('new-file');
  });

  test('a new rule in an already-baselined file is a new-rule expansion', () => {
    const diff = diffCounts({
      baseline: { 'a.ts': { counts: counts({ t2: 1 }) } },
      current: { 'a.ts': { counts: counts({ t2: 1, t1: 1 }) } },
    });
    expect(diff.expansions.map((change) => change.kind)).toEqual(['new-rule']);
  });

  test('reduced debt is a reduction', () => {
    const diff = diffCounts({
      baseline: { 'a.ts': { counts: counts({ t2: 4 }) } },
      current: { 'a.ts': { counts: counts({ t2: 2 }) } },
    });
    expect(diff.expansions).toEqual([]);
    expect(diff.reductions).toHaveLength(1);
    expect(diff.reductions[0]?.kind).toBe('decrease');
  });

  test('fully resolved debt is a reduction', () => {
    const diff = diffCounts({
      baseline: { 'a.ts': { counts: counts({ t2: 2 }) } },
      current: { 'a.ts': { counts: counts({}) } },
    });
    expect(diff.reductions).toHaveLength(1);
    expect(diff.reductions[0]?.after).toBe(0);
  });

  test('a file that drops out of the scan entirely is reported as stale', () => {
    const diff = diffCounts({
      baseline: { 'gone.ts': { counts: counts({ orphans: 2 }) } },
      current: {},
    });
    expect(diff.stale).toHaveLength(1);
    expect(diff.stale[0]?.detail).toContain('rename');
  });
});

describe('diffCounts — identity awareness', () => {
  const withIdentities = (identities: string[]): RatchetBaseline => ({
    'a.ts': { counts: counts({ t2: identities.length }), identities },
  });

  test('same count, same identities is not a change', () => {
    const diff = diffCounts({
      baseline: withIdentities(['t2:aaaa']),
      current: withIdentities(['t2:aaaa']),
    });
    expect(diff.expansions).toEqual([]);
  });

  test('same count, different identities is an identity-swap expansion', () => {
    const diff = diffCounts({
      baseline: withIdentities(['t2:aaaa']),
      current: withIdentities(['t2:bbbb']),
    });
    expect(diff.expansions).toHaveLength(1);
    expect(diff.expansions[0]?.kind).toBe('identity-swap');
  });

  test('count-only baselines never report an identity swap', () => {
    const diff = diffCounts({
      baseline: { 'a.ts': { counts: counts({ t2: 1 }) } },
      current: { 'a.ts': { counts: counts({ t2: 1 }), identities: ['t2:zzzz'] } },
    });
    expect(diff.expansions).toEqual([]);
  });

  test('an identity swap on a reduced count is a reduction, not an expansion', () => {
    const diff = diffCounts({
      baseline: withIdentities(['t2:aaaa', 't2:bbbb']),
      current: withIdentities(['t2:cccc']),
    });
    expect(diff.expansions).toEqual([]);
    expect(diff.reductions).toHaveLength(1);
  });
});

describe('contractCounts — reduction-only contraction', () => {
  test('locks in a reduction and drops resolved entries', () => {
    const next = contractCounts({
      baseline: { 'a.ts': { counts: counts({ t2: 4 }) }, 'b.ts': { counts: counts({ t2: 1 }) } },
      current: { 'a.ts': { counts: counts({ t2: 2 }) } },
    });
    expect(next).toEqual({ 'a.ts': { counts: { t2: 2 } } });
  });

  test('never invents an entry for new debt', () => {
    const next = contractCounts({
      baseline: {},
      current: { 'new.ts': { counts: counts({ t2: 5 }) } },
    });
    expect(next).toEqual({});
  });

  test('keeps identities sorted and drops a zero-count file', () => {
    const next = contractCounts({
      baseline: { 'a.ts': { counts: counts({ t2: 1 }), identities: ['t2:bbbb'] } },
      current: {
        'a.ts': { counts: counts({ t2: 2 }), identities: ['t2:cccc', 't2:aaaa'] },
        'b.ts': { counts: counts({}) },
      },
    });
    expect(next['a.ts']?.identities).toEqual(['t2:aaaa', 't2:cccc']);
    expect(next['b.ts']).toBeUndefined();
  });
});

describe('diffAllowances — numeric allowance ratchet', () => {
  test('allows reductions and removals', () => {
    const diff = diffAllowances({
      trusted: { 'a.ts': 900, 'b.ts': 900 },
      current: { 'a.ts': 800 },
    });
    expect(diff.expansions).toEqual([]);
    expect(diff.reductions).toHaveLength(2);
  });

  test('rejects a raised allowance', () => {
    const diff = diffAllowances({ trusted: { 'a.ts': 900 }, current: { 'a.ts': 950 } });
    expect(diff.expansions).toHaveLength(1);
    expect(diff.expansions[0]?.detail).toContain('+50');
  });

  test('rejects a new allowance', () => {
    const diff = diffAllowances({ trusted: {}, current: { 'a.ts': 900 } });
    expect(diff.expansions).toHaveLength(1);
    expect(diff.expansions[0]?.kind).toBe('new-file');
  });

  test('equality is not a change', () => {
    expect(
      diffAllowances({ trusted: { 'a.ts': 900 }, current: { 'a.ts': 900 } }).expansions,
    ).toEqual([]);
  });

  test('contractAllowances never writes an entry that was not already accepted', () => {
    const next = contractAllowances({
      baseline: { 'a.ts': 900 },
      current: { 'a.ts': 850, 'b.ts': 1200 },
    });
    expect(next).toEqual({ 'a.ts': 850 });
  });

  test('contractAllowances never raises an existing ceiling', () => {
    const next = contractAllowances({ baseline: { 'a.ts': 900 }, current: { 'a.ts': 1200 } });
    expect(next['a.ts']).toBe(900);
  });
});

describe('baselineFromViolations', () => {
  test('folds violations into sorted per-file counts', () => {
    const baseline = baselineFromViolations({
      violations: [
        { file: 'b.ts', rule: 't2', line: 1, message: 'x' },
        { file: 'a.ts', rule: 't2', line: 1, message: 'x' },
        { file: 'a.ts', rule: 't1', line: 2, message: 'y' },
      ],
      identityAware: false,
    });
    expect(Object.keys(baseline)).toEqual(['a.ts', 'b.ts']);
    expect(baseline['a.ts']?.counts).toEqual({ t1: 1, t2: 1 });
  });

  test('records rule-namespaced identities when asked', () => {
    const baseline = baselineFromViolations({
      violations: [
        { file: 'a.ts', rule: 't2', line: 1, message: 'x', identity: 'abcd1234' },
        { file: 'a.ts', rule: 't1', line: 2, message: 'y', identity: 'eeee1111' },
      ],
      identityAware: true,
    });
    expect(baseline['a.ts']?.identities).toEqual(['t1:eeee1111', 't2:abcd1234']);
  });
});

describe('parseCountsBaseline', () => {
  test('ignores underscore-prefixed documentation keys', () => {
    const { baseline, errors } = parseCountsBaseline(
      { _comment: 'docs', 'a.ts': { counts: { t2: 1 } } },
      'baseline',
    );
    expect(errors).toEqual([]);
    expect(baseline['a.ts']?.counts).toEqual({ t2: 1 });
  });

  test('accepts a legacy flat rule map so a stale file is reported, not crashed on', () => {
    // `{ "a.ts": { "t2": 1 } }` is the pre-framework shape. It must produce a
    // parse error (the guard then fails loudly) rather than being silently read
    // as an empty baseline, which would look like a huge expansion.
    const { errors } = parseCountsBaseline({ 'a.ts': { t2: 1 } }, 'baseline');
    expect(errors.length).toBeGreaterThan(0);
  });

  test('rejects a non-integer count', () => {
    const { errors } = parseCountsBaseline({ 'a.ts': { counts: { t2: 'many' } } }, 'baseline');
    expect(errors[0]).toContain('non-negative integer');
  });

  test('rejects a non-string identity', () => {
    const { errors } = parseCountsBaseline(
      { 'a.ts': { counts: { t2: 1 }, identities: [7] } },
      'baseline',
    );
    expect(errors[0]).toContain('identities');
  });
});

describe('deterministic serialization', () => {
  test('sorts files, rules and identities', () => {
    const text = serializeCounts({
      'z.ts': { counts: { t2: 1, t1: 2 }, identities: ['t2:b', 't1:a'] },
      'a.ts': { counts: { t2: 1 } },
    });
    expect(Object.keys(JSON.parse(text))).toEqual(['a.ts', 'z.ts']);
    expect(Object.keys(JSON.parse(text)['z.ts'].counts)).toEqual(['t1', 't2']);
    expect(JSON.parse(text)['z.ts'].identities).toEqual(['t1:a', 't2:b']);
    expect(text.endsWith('\n')).toBe(true);
  });

  test('allowance serialization is sorted and stable', () => {
    const text = serializeAllowances({ 'z.ts': 10, 'a.ts': 20 });
    expect(Object.keys(JSON.parse(text))).toEqual(['a.ts', 'z.ts']);
  });

  test('serializing the same baseline twice is byte-identical', () => {
    const baseline: RatchetBaseline = {
      'b.ts': { counts: { m9: 1, v6: 2 } },
      'a.ts': { counts: { m8: 3 } },
    };
    expect(serializeCounts(baseline)).toBe(serializeCounts(baseline));
  });
});

describe('renderExpansions — agent-facing diagnostics', () => {
  const rules = [
    { id: 't2', label: 'T2 `as any`', remediation: 'Replace with unknown + narrowing.' },
  ];

  test('names the file, the rule and the remediation', () => {
    const lines = renderExpansions({
      changes: [
        { file: 'a.ts', rule: 't2', kind: 'increase', before: 0, after: 1, detail: '0 → 1' },
      ],
      rules,
      label: 'type-safety guard failed',
    });
    const text = lines.join('\n');
    expect(text).toContain('a.ts');
    expect(text).toContain('T2 `as any`');
    expect(text).toContain('Replace with unknown + narrowing.');
  });

  test('never tells an agent to raise the baseline', () => {
    const text = renderExpansions({
      changes: [{ file: 'a.ts', rule: 't2', kind: 'new-file', before: 0, after: 1, detail: 'new' }],
      rules,
      label: 'x',
    }).join('\n');
    expect(text).not.toMatch(/add a reviewed exception/i);
    expect(text).not.toMatch(/raise the baseline/i);
    expect(text).toContain('may only shrink');
    expect(text).toContain('human review');
  });
});

describe('simpleHash', () => {
  test('is stable and 8 hex characters', () => {
    expect(simpleHash('as any) as T;')).toBe(simpleHash('as any) as T;'));
    expect(simpleHash('as any) as T;')).toMatch(/^[0-9a-f]{8}$/);
  });

  test('differs for different snippets', () => {
    expect(simpleHash('as any) as T;')).not.toBe(simpleHash('as any).data;'));
  });
});
