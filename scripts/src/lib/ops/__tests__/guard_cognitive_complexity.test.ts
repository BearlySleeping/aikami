// scripts/src/lib/ops/__tests__/guard_cognitive_complexity.test.ts
//
// Tests for the cognitive-complexity ratchet's measurement layer.
//
// The measurement itself is Biome's, so what needs pinning here is that a
// malformed, misdirected or empty report can NEVER be read as "everything is
// fine". That is the failure mode that would silently turn this guard into a
// no-op: an empty `diagnostics` array looks exactly like a clean repository, so
// the guard has to establish that a measurement actually happened before it
// believes the number.

import { describe, expect, test } from 'bun:test';
import {
  baselineFromFindings,
  checkBiomeReport,
  parseComplexityFindings,
  RULE_CATEGORY,
  readBiomeComplexityReport,
} from '../guard_cognitive_complexity.ts';

/** A `biome lint --reporter=json` summary, as this repository's version emits it. */
const summary = (overrides: Record<string, number> = {}) => ({
  changed: 0,
  unchanged: 3530,
  matches: 0,
  duration: 80391378,
  errors: 0,
  warnings: 0,
  infos: 0,
  skipped: 0,
  suggestedFixesSkipped: 0,
  diagnosticsNotPrinted: 0,
  scannerDuration: 709176,
  ...overrides,
});

const diagnostic = (file: string, line: number, score: number) => ({
  severity: 'info',
  message: `Excessive complexity of ${score} detected (max: 15).`,
  category: RULE_CATEGORY,
  location: { path: file, start: { line, column: 1 }, end: { line, column: 2 } },
});

const report = (
  options: { diagnostics?: unknown[]; command?: unknown; summary?: unknown } = {},
): string =>
  JSON.stringify({
    summary: options.summary ?? summary(),
    diagnostics: options.diagnostics ?? [],
    command: options.command ?? 'lint',
  });

describe('checkBiomeReport — accepts a real measurement', () => {
  test('a valid report with findings', () => {
    const check = checkBiomeReport(report({ diagnostics: [diagnostic('a.ts', 12, 22)] }));
    expect(check.ok).toBe(true);
    expect(check.ok === true && check.filesExamined).toBe(3530);
  });

  test('a valid report with ZERO findings is still a measurement', () => {
    // 🔴 The case that matters: zero findings is a legitimate result, and must
    // not be confused with "Biome did not run".
    const check = checkBiomeReport(report());
    expect(check.ok).toBe(true);
    expect(check.ok === true && check.diagnostics).toEqual([]);
  });

  test('counts changed files as examined', () => {
    const check = checkBiomeReport(report({ summary: summary({ changed: 12, unchanged: 0 }) }));
    expect(check.ok === true && check.filesExamined).toBe(12);
  });

  test('ignores non-lint diagnostics (parse errors) and counts the rest', () => {
    const check = checkBiomeReport(
      report({
        diagnostics: [
          { category: 'parse', message: 'unexpected token', location: { path: 'a.ts' } },
          diagnostic('b.ts', 1, 20),
        ],
      }),
    );
    expect(check.ok).toBe(true);
  });
});

describe('checkBiomeReport — fails closed', () => {
  test('unparseable output', () => {
    const check = checkBiomeReport('not json at all');
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toContain('not valid JSON');
  });

  test('a JSON array instead of an object', () => {
    expect(checkBiomeReport('[]').ok).toBe(false);
  });

  test('the wrong command', () => {
    const check = checkBiomeReport(report({ command: 'format' }));
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toContain('expected a `lint` report');
  });

  test('a missing command', () => {
    expect(checkBiomeReport(JSON.stringify({ summary: summary(), diagnostics: [] })).ok).toBe(
      false,
    );
  });

  test('a missing diagnostics array', () => {
    const check = checkBiomeReport(JSON.stringify({ summary: summary(), command: 'lint' }));
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toContain('diagnostics');
  });

  test('a missing summary object', () => {
    const check = checkBiomeReport(JSON.stringify({ diagnostics: [], command: 'lint' }));
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toContain('summary');
  });

  test('a non-numeric counter', () => {
    const check = checkBiomeReport(report({ summary: summary({ unchanged: 'lots' as never }) }));
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toContain('unchanged');
  });

  test('a negative counter', () => {
    const check = checkBiomeReport(report({ summary: summary({ errors: -1 }) }));
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toContain('non-negative integer');
  });

  test('a non-integer counter', () => {
    const check = checkBiomeReport(report({ summary: summary({ infos: 1.5 }) }));
    expect(check.ok).toBe(false);
  });

  test('a report that examined zero files is not a measurement', () => {
    const check = checkBiomeReport(report({ summary: summary({ changed: 0, unchanged: 0 }) }));
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toContain('examined 0 files');
  });

  test('a foreign lint category means the --only scope was lost', () => {
    const check = checkBiomeReport(
      report({
        diagnostics: [
          { category: 'lint/suspicious/noExplicitAny', message: 'x', location: { path: 'a.ts' } },
        ],
      }),
    );
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.reason).toContain('--only');
  });
});

describe('parseComplexityFindings', () => {
  test('extracts file, line and score', () => {
    const findings = parseComplexityFindings([diagnostic('a.ts', 12, 22)]);
    expect(findings).toEqual([{ file: 'a.ts', line: 12, score: 22 }]);
  });

  test('ignores diagnostics from other categories', () => {
    const findings = parseComplexityFindings([
      diagnostic('a.ts', 1, 20),
      { category: 'parse', message: 'x', location: { path: 'b.ts' } },
    ]);
    expect(findings).toHaveLength(1);
  });

  test('skips a malformed entry rather than discarding the scan', () => {
    const findings = parseComplexityFindings([
      diagnostic('a.ts', 1, 20),
      { category: RULE_CATEGORY, message: 'no score here' },
    ]);
    expect(findings).toHaveLength(1);
  });

  test('normalizes Windows separators', () => {
    expect(parseComplexityFindings([diagnostic('a\\b\\c.ts', 1, 20)])[0]?.file).toBe('a/b/c.ts');
  });

  test('an empty diagnostic list yields no findings', () => {
    expect(parseComplexityFindings([])).toEqual([]);
  });
});

describe('readBiomeComplexityReport', () => {
  test('returns findings and the examined count together', () => {
    const result = readBiomeComplexityReport(report({ diagnostics: [diagnostic('a.ts', 1, 20)] }));
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.findings).toHaveLength(1);
    expect(result.ok === true && result.filesExamined).toBe(3530);
  });

  test('a valid report with no findings succeeds with empty debt', () => {
    const result = readBiomeComplexityReport(report());
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.findings).toEqual([]);
  });

  test('an invalid report returns a reason instead of empty findings', () => {
    const result = readBiomeComplexityReport('nonsense');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason.length).toBeGreaterThan(0);
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
