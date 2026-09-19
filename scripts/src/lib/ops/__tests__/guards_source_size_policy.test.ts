// scripts/src/lib/ops/__tests__/guards_source_size_policy.test.ts
//
// Tests for the source-file-size policy module
// (scripts/src/lib/ops/guards/source_size_policy.ts): permanent exemptions vs
// temporary waivers, expiry, classification verification, and the
// effective-allowance comparison that closes the baseline→waiver laundering
// hole.
//
// The laundering case is the reason this module exists. Four files could not
// raise their grandfathered baseline entries (the guard rejected it), so they
// were converted to exceptions with HIGHER ceilings and the guard accepted it —
// see PR #339 and the header of source_size_policy.ts. `effectiveAllowances`
// is what makes that a detectable increase instead of a representation change.

import { describe, expect, test } from 'bun:test';
import { budgetFor } from '../guard_source_file_size_helpers.ts';
import {
  assessFile,
  classificationMatches,
  effectiveAllowance,
  effectiveAllowances,
  expiredWaiverMessage,
  isRealIsoDate,
  isWaiverCurrent,
  oversizedMutableModuleMessage,
  type PermanentExemption,
  type TemporaryWaiver,
  todayIso,
  validateExemptions,
  validateWaivers,
} from '../guards/source_size_policy.ts';

const production = budgetFor('production');

// ── Dates ────────────────────────────────────────────────────────────────

describe('isRealIsoDate', () => {
  test('accepts a real calendar date', () => {
    expect(isRealIsoDate('2026-12-31')).toBe(true);
    expect(isRealIsoDate('2028-02-29')).toBe(true); // leap year
  });

  test('rejects a syntactically ISO but impossible date', () => {
    expect(isRealIsoDate('2026-02-30')).toBe(false);
    expect(isRealIsoDate('2026-13-01')).toBe(false);
    expect(isRealIsoDate('2027-02-29')).toBe(false); // not a leap year
  });

  test('rejects a malformed date', () => {
    expect(isRealIsoDate('soon')).toBe(false);
    expect(isRealIsoDate('2026-1-1')).toBe(false);
    expect(isRealIsoDate('')).toBe(false);
  });
});

describe('waiver currency', () => {
  test('a reviewBy on or after today is current', () => {
    expect(isWaiverCurrent({ reviewBy: '2026-09-18', today: '2026-09-18' })).toBe(true);
    expect(isWaiverCurrent({ reviewBy: '2026-12-31', today: '2026-09-18' })).toBe(true);
  });

  test('a reviewBy before today is expired', () => {
    expect(isWaiverCurrent({ reviewBy: '2026-09-17', today: '2026-09-18' })).toBe(false);
  });
});

describe('todayIso', () => {
  test('formats a UTC date', () => {
    expect(todayIso(new Date('2026-09-18T23:00:00Z'))).toBe('2026-09-18');
  });
});

// ── Permanent exemptions ─────────────────────────────────────────────────

const exemption = (overrides: Partial<PermanentExemption> = {}): PermanentExemption => ({
  maxLines: 1200,
  rationale: 'cohesive declarative table consumed as one lookup dataset',
  owner: '@aikami/platform',
  kind: 'declarative',
  ...overrides,
});

describe('validateExemptions', () => {
  test('accepts a well-formed declarative exemption and ignores comments', () => {
    const { exemptions, errors } = validateExemptions({
      _comment: 'docs',
      'packages/x/src/country_codes.ts': exemption(),
    });
    expect(errors).toEqual([]);
    expect(exemptions['packages/x/src/country_codes.ts']?.maxLines).toBe(1200);
  });

  test('rejects a missing or unknown kind', () => {
    expect(
      validateExemptions({ 'a.ts': { ...exemption(), kind: 'kernel' } }).errors.length,
    ).toBeGreaterThan(0);
  });

  test('rejects a short rationale and an empty owner', () => {
    expect(validateExemptions({ 'a.ts': { ...exemption(), rationale: 'big' } }).errors.length).toBe(
      1,
    );
    expect(validateExemptions({ 'a.ts': { ...exemption(), owner: '' } }).errors.length).toBe(1);
  });

  test('requires a source for a generated exemption', () => {
    const { errors } = validateExemptions({ 'a.ts': exemption({ kind: 'generated' }) });
    expect(errors[0]).toContain('needs a "source"');
  });

  test('accepts a generated exemption that names its source', () => {
    const { errors } = validateExemptions({
      'a.ts': exemption({ kind: 'generated', source: 'tests/__fixtures__/order.json' }),
    });
    expect(errors).toEqual([]);
  });

  test('rejects a non-positive maxLines', () => {
    expect(validateExemptions({ 'a.ts': exemption({ maxLines: 0 }) }).errors.length).toBe(1);
  });
});

describe('classificationMatches', () => {
  const base = {
    relPath: 'packages/shared/constants/src/lib/country_codes.ts',
    isGeneratedFile: () => false,
    isTestFile: () => false,
    sourceExists: false,
  };

  test('declarative passes only when the file contains no logic', () => {
    expect(
      classificationMatches({
        ...base,
        kind: 'declarative',
        structure: { logicDeclarations: 0, exportedDeclarations: 0 },
      }).ok,
    ).toBe(true);

    const verdict = classificationMatches({
      ...base,
      kind: 'declarative',
      structure: { logicDeclarations: 3, exportedDeclarations: 3 },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain('declarative');
  });

  test('generated passes on a generated path or an existing source', () => {
    expect(
      classificationMatches({
        ...base,
        kind: 'generated',
        structure: { logicDeclarations: 0, exportedDeclarations: 0 },
        isGeneratedFile: () => true,
      }).ok,
    ).toBe(true);
    expect(
      classificationMatches({
        ...base,
        kind: 'generated',
        structure: { logicDeclarations: 0, exportedDeclarations: 0 },
        sourceExists: true,
      }).ok,
    ).toBe(true);
    expect(
      classificationMatches({
        ...base,
        kind: 'generated',
        structure: { logicDeclarations: 0, exportedDeclarations: 0 },
      }).ok,
    ).toBe(false);
  });

  test('fixture requires a test path or a fixtures directory', () => {
    expect(
      classificationMatches({
        ...base,
        relPath: 'packages/x/tests/fixtures/table.ts',
        kind: 'fixture',
        structure: { logicDeclarations: 9, exportedDeclarations: 9 },
      }).ok,
    ).toBe(true);
    expect(
      classificationMatches({
        ...base,
        relPath: 'packages/x/src/service.ts',
        kind: 'fixture',
        structure: { logicDeclarations: 0, exportedDeclarations: 0 },
      }).ok,
    ).toBe(false);
  });
});

// ── Temporary waivers ────────────────────────────────────────────────────

const waiver = (overrides: Partial<TemporaryWaiver> = {}): TemporaryWaiver => ({
  maxLines: 2500,
  rationale: 'large ViewModel pending a named decomposition',
  owner: '@aikami/client',
  issue: '#342',
  reviewBy: '2026-12-31',
  ...overrides,
});

describe('validateWaivers', () => {
  const today = '2026-09-18';

  test('accepts a well-formed waiver', () => {
    const { waivers, errors, expired } = validateWaivers({ 'a.ts': waiver() }, { today });
    expect(errors).toEqual([]);
    expect(expired).toEqual([]);
    expect(waivers['a.ts']?.issue).toBe('#342');
  });

  test('requires an issue', () => {
    const { errors } = validateWaivers(
      { 'a.ts': { ...waiver(), issue: undefined } as unknown as TemporaryWaiver },
      { today },
    );
    expect(errors[0]).toContain('"issue" is required');
  });

  test('requires reviewBy', () => {
    const { errors } = validateWaivers(
      { 'a.ts': { ...waiver(), reviewBy: undefined } as unknown as TemporaryWaiver },
      { today },
    );
    expect(errors[0]).toContain('"reviewBy"');
  });

  test('rejects a malformed date', () => {
    const { errors } = validateWaivers({ 'a.ts': waiver({ reviewBy: 'soon' }) }, { today });
    expect(errors[0]).toContain('real ISO date');
  });

  test('rejects an impossible date', () => {
    const { errors } = validateWaivers({ 'a.ts': waiver({ reviewBy: '2026-02-30' }) }, { today });
    expect(errors.length).toBe(1);
  });

  test('reports an expired waiver separately, not as a parse error', () => {
    const { errors, expired, waivers } = validateWaivers(
      { 'a.ts': waiver({ reviewBy: '2026-01-01' }) },
      { today },
    );
    expect(errors).toEqual([]);
    expect(expired).toEqual([{ path: 'a.ts', reviewBy: '2026-01-01' }]);
    expect(waivers['a.ts']).toBeUndefined();
  });

  test('a reviewBy equal to today still passes', () => {
    const { expired } = validateWaivers({ 'a.ts': waiver({ reviewBy: today }) }, { today });
    expect(expired).toEqual([]);
  });
});

// ── Effective allowance ──────────────────────────────────────────────────

describe('effectiveAllowance', () => {
  test('precedence is waiver → exemption → baseline → hard limit', () => {
    const options = {
      path: 'a.ts',
      kind: 'production' as const,
      budgetFor,
      baselineLines: 900,
      exemption: exemption(),
      waiver: waiver(),
    };
    expect(effectiveAllowance(options).source).toBe('waiver');
    expect(effectiveAllowance({ ...options, waiver: undefined }).source).toBe('exemption');
    expect(effectiveAllowance({ ...options, waiver: undefined, exemption: undefined }).source).toBe(
      'baseline',
    );
    expect(
      effectiveAllowance({
        ...options,
        waiver: undefined,
        exemption: undefined,
        baselineLines: undefined,
      }),
    ).toEqual({ lines: production.hard, source: 'hard-limit' });
  });

  test('a legacy single-file exception is treated as an exemption ceiling', () => {
    expect(
      effectiveAllowance({
        path: 'a.ts',
        kind: 'production',
        budgetFor,
        legacyMaxLines: 1160,
      }),
    ).toEqual({ lines: 1160, source: 'exemption' });
  });
});

describe('effectiveAllowances — the laundering guard', () => {
  const options = { isTestFile: () => false, budgetFor };

  test('a baseline entry and an equal waiver are the same effective allowance', () => {
    const fromBaseline = effectiveAllowances({
      ...options,
      paths: [],
      baseline: { 'a.ts': 1156 },
      exemptions: {},
      waivers: {},
    });
    const fromWaiver = effectiveAllowances({
      ...options,
      paths: [],
      baseline: {},
      exemptions: {},
      waivers: { 'a.ts': waiver({ maxLines: 1156 }) },
    });
    expect(fromBaseline['a.ts']).toBe(fromWaiver['a.ts']);
  });

  test('converting a baseline into a LARGER waiver raises the effective allowance', () => {
    const fromBaseline = effectiveAllowances({
      ...options,
      paths: [],
      baseline: { 'a.ts': 1156 },
      exemptions: {},
      waivers: {},
    });
    const fromWaiver = effectiveAllowances({
      ...options,
      paths: [],
      baseline: {},
      exemptions: {},
      waivers: { 'a.ts': waiver({ maxLines: 1160 }) },
    });
    expect(fromWaiver['a.ts']).toBeGreaterThan(fromBaseline['a.ts'] ?? 0);
  });

  test('the legacy exceptions file and the split files produce the same allowance', () => {
    const legacy = effectiveAllowances({
      ...options,
      paths: [],
      baseline: {},
      exemptions: {},
      waivers: {},
      legacyExceptions: { 'a.ts': { maxLines: 1160 } },
    });
    const split = effectiveAllowances({
      ...options,
      paths: [],
      baseline: {},
      exemptions: {},
      waivers: { 'a.ts': waiver({ maxLines: 1160 }) },
    });
    expect(legacy['a.ts']).toBe(split['a.ts']);
  });

  test('a path with no entry on either side falls back to the hard limit', () => {
    const allowances = effectiveAllowances({
      ...options,
      paths: ['a.ts'],
      baseline: {},
      exemptions: {},
      waivers: {},
    });
    expect(allowances['a.ts']).toBe(production.hard);
  });

  test('a test file falls back to the test hard limit', () => {
    const allowances = effectiveAllowances({
      isTestFile: () => true,
      budgetFor,
      paths: ['a.test.ts'],
      baseline: {},
      exemptions: {},
      waivers: {},
    });
    expect(allowances['a.test.ts']).toBe(budgetFor('test').hard);
  });
});

// ── Assessment ───────────────────────────────────────────────────────────

describe('assessFile', () => {
  test('production boundaries are exact', () => {
    const assess = (lines: number) => assessFile({ kind: 'production', lines, budgetFor }).status;
    expect(assess(500)).toBe('ok');
    expect(assess(501)).toBe('warning');
    expect(assess(800)).toBe('warning');
    expect(assess(801)).toBe('over-limit');
  });

  test('test boundaries are exact', () => {
    const assess = (lines: number) => assessFile({ kind: 'test', lines, budgetFor }).status;
    expect(assess(800)).toBe('ok');
    expect(assess(801)).toBe('warning');
    expect(assess(1500)).toBe('warning');
    expect(assess(1501)).toBe('over-limit');
  });

  test('a baseline allows equality, fails growth, and requires reductions to be locked', () => {
    const assess = (lines: number) =>
      assessFile({ kind: 'production', lines, baselineLines: 900, budgetFor }).status;
    expect(assess(900)).toBe('baselined');
    expect(assess(901)).toBe('over-limit');
    expect(assess(850)).toBe('reduction');
  });

  test('a waiver ceiling takes precedence over the baseline and is the failure limit', () => {
    const options = {
      kind: 'production' as const,
      baselineLines: 900,
      waiver: waiver({ maxLines: 1000 }),
      budgetFor,
    };
    expect(assessFile({ ...options, lines: 1000 }).status).toBe('waiver');
    const over = assessFile({ ...options, lines: 1001 });
    expect(over.status).toBe('over-limit');
    expect(over.source).toBe('waiver');
  });

  test('an exemption ceiling is the failure limit', () => {
    const options = {
      kind: 'production' as const,
      exemption: exemption({ maxLines: 1200 }),
      budgetFor,
    };
    expect(assessFile({ ...options, lines: 1200 }).status).toBe('exemption');
    expect(assessFile({ ...options, lines: 1201 }).status).toBe('over-limit');
  });
});

// ── Diagnostics ──────────────────────────────────────────────────────────

describe('diagnostics', () => {
  test('an expired waiver message is actionable and forbids silent renewal', () => {
    const text = expiredWaiverMessage({ path: 'a.ts', reviewBy: '2026-12-31' });
    expect(text).toContain('expired on 2026-12-31');
    expect(text).toContain('explicit human review');
    expect(text).toContain('Do NOT extend reviewBy automatically');
  });

  test('an oversized-module message names the fix, not the escape hatch', () => {
    const text = oversizedMutableModuleMessage({
      path: 'a.ts',
      lines: 2572,
      ceiling: 2500,
      source: 'waiver',
    });
    expect(text).toContain('by 72 lines');
    expect(text).toContain('identify a cohesive responsibility to extract');
    expect(text).toContain('explicit human review');
    expect(text).not.toMatch(/raise the waiver/i);
    expect(text).not.toMatch(/add a reviewed exception/i);
  });
});
