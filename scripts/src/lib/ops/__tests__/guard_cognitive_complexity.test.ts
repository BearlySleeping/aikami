// scripts/src/lib/ops/__tests__/guard_cognitive_complexity.test.ts
//
// Tests for the cognitive-complexity ratchet's pure layer: parsing Biome's JSON
// report and folding it into the two-rule per-file baseline.
//
// The measurement itself is Biome's, so what needs pinning here is that a
// malformed or unexpected report cannot be read as "everything is fine" — the
// failure mode that would silently turn this guard into a no-op.

import { describe, expect, test } from 'bun:test';
import {
  baselineFromFindings,
  parseBiomeComplexityReport,
  RULE_CATEGORY,
} from '../guard_cognitive_complexity.ts';

const diagnostic = (file: string, line: number, score: number) => ({
  severity: 'info',
  message: `Excessive complexity of ${score} detected (max: 15).`,
  category: RULE_CATEGORY,
  location: { path: file, start: { line, column: 1 }, end: { line, column: 2 } },
});

const report = (diagnostics: unknown[]): string =>
  JSON.stringify({ summary: {}, diagnostics, command: 'lint' });

describe('parseBiomeComplexityReport', () => {
  test('extracts file, line and score', () => {
    const findings = parseBiomeComplexityReport(report([diagnostic('a.ts', 12, 22)]));
    expect(findings).toEqual([{ file: 'a.ts', line: 12, score: 22 }]);
  });

  test('ignores diagnostics from other rules', () => {
    const findings = parseBiomeComplexityReport(
      report([
        diagnostic('a.ts', 1, 20),
        { category: 'lint/suspicious/noExplicitAny', message: 'x', location: { path: 'b.ts' } },
      ]),
    );
    expect(findings).toHaveLength(1);
  });

  test('skips a malformed entry rather than aborting the scan', () => {
    const findings = parseBiomeComplexityReport(
      report([diagnostic('a.ts', 1, 20), { category: RULE_CATEGORY, message: 'no score here' }]),
    );
    expect(findings).toHaveLength(1);
  });

  test('normalizes Windows separators', () => {
    const findings = parseBiomeComplexityReport(report([diagnostic('a\\b\\c.ts', 1, 20)]));
    expect(findings[0]?.file).toBe('a/b/c.ts');
  });

  test('returns nothing for unparseable output', () => {
    expect(parseBiomeComplexityReport('not json')).toEqual([]);
  });

  test('returns nothing when the report has no diagnostics array', () => {
    expect(parseBiomeComplexityReport('{"summary":{}}')).toEqual([]);
  });
});

describe('baselineFromFindings', () => {
  test('folds findings into a per-file count and worst score', () => {
    const baseline = baselineFromFindings([
      { file: 'a.ts', line: 1, score: 20 },
      { file: 'a.ts', line: 50, score: 33 },
      { file: 'b.ts', line: 1, score: 16 },
    ]);
    expect(baseline['a.ts']?.counts).toEqual({ excessive: 2, worst: 33 });
    expect(baseline['b.ts']?.counts).toEqual({ excessive: 1, worst: 16 });
  });

  test('is sorted by path for deterministic serialization', () => {
    const baseline = baselineFromFindings([
      { file: 'z.ts', line: 1, score: 20 },
      { file: 'a.ts', line: 1, score: 20 },
    ]);
    expect(Object.keys(baseline)).toEqual(['a.ts', 'z.ts']);
  });

  test('an empty finding list produces an empty baseline', () => {
    expect(baselineFromFindings([])).toEqual({});
  });
});
