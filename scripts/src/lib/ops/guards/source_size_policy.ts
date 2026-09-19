// scripts/src/lib/ops/guards/source_size_policy.ts
//
// The source-file-size policy: what a file is allowed to be, and who decided.
//
// The guard used to have ONE escape hatch — `guard_source_file_size_exceptions
// .json` — and it conflated two genuinely different things:
//
//   • a cohesive ISO-3166 country table that will never be split, and
//   • a 2500-line mutable ViewModel that is actively being decomposed.
//
// Because they shared a record type, they shared semantics: neither expired,
// neither was validated for whether its stated classification was true, and —
// most importantly — an entry could be raised freely, because the trusted-base
// check only ever looked at the *baseline* file. That is the laundering path
// the repository actually walked: four files could not raise their baseline
// entries (the guard rejected it), so PR #339 converted them to exceptions
// with HIGHER ceilings (1189 → 1193, 2263 → 2335, 2268 → 2279, 1316 → 1323)
// and the guard accepted it. Same debt, different representation, no review.
//
// So this module defines two record types with different rules:
//
//   PERMANENT EXEMPTION — declarative data, a generated-but-tracked artifact,
//     or a cohesive fixture. No expiry. Still ceilinged, still verified: the
//     declared classification must be true, the owner must exist, and an
//     obsolete exemption (file back under the hard limit) fails.
//
//   TEMPORARY WAIVER — a mutable module above the hard limit. Requires an
//     `issue` AND a `reviewBy` date. Expires. And the ceiling is a RATCHET:
//     it may be lowered, never raised, never invented for a new file, and
//     never reached by converting a baseline entry into a waiver.
//
// The last rule is enforced by comparing the EFFECTIVE ALLOWANCE — the single
// ceiling a path actually has, whichever representation expresses it —
// between the trusted base revision and the branch. Representation is an
// implementation detail; the allowance is the policy.
//
// 🔴 Pure module: no filesystem, no clock. The caller passes `today`.

import type { SizeBudget, SourceKind } from '../guard_source_file_size_helpers.ts';

// ── Types ────────────────────────────────────────────────────────────────

/**
 * Classification of a permanent exemption. Each value is *verified* against
 * the file, not trusted: `declarative` must contain no logic, `generated`
 * must be recognisable as generated or name its source, and `fixture` must
 * live in a test/fixture location.
 */
export type ExemptionKind = 'declarative' | 'generated' | 'fixture';

export type PermanentExemption = {
  /** Exact ceiling. Must relax the hard limit, or the exemption is obsolete. */
  maxLines: number;
  rationale: string;
  owner: string;
  kind: ExemptionKind;
  /**
   * Required evidence for `kind: 'generated'`: a repo-relative path the
   * artifact is derived from (its generator or its source fixture). Ignored
   * for the other kinds.
   */
  source?: string;
};

export type TemporaryWaiver = {
  maxLines: number;
  rationale: string;
  owner: string;
  /** Tracking issue or PR that owns the debt. Required. */
  issue: string;
  /** ISO date (YYYY-MM-DD) by which the debt must be re-reviewed. Required. */
  reviewBy: string;
};

export type ExemptionSet = Record<string, PermanentExemption>;
export type WaiverSet = Record<string, TemporaryWaiver>;

/** Legacy pre-split record shape, read only from a trusted base revision. */
export type LegacyExceptionSet = Record<string, { maxLines: number }>;

export type AllowanceSource = 'waiver' | 'exemption' | 'baseline' | 'hard-limit';

export type EffectiveAllowance = {
  /** The ceiling that actually applies. */
  lines: number;
  /** Which representation produced it. */
  source: AllowanceSource;
};

// ── Date handling ────────────────────────────────────────────────────────

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True for a syntactically ISO date that is also a real calendar date.
 * `2026-02-30` is rejected, not silently rolled forward.
 */
export const isRealIsoDate = (value: string): boolean => {
  if (!ISO_DATE.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (year === undefined || month === undefined || day === undefined) {
    return false;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
};

/** Today as an ISO date in UTC. Injectable so the policy stays testable. */
export const todayIso = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/** True when `reviewBy` is on or after `today`. String compare is safe for ISO dates. */
export const isWaiverCurrent = (options: { reviewBy: string; today: string }): boolean =>
  options.reviewBy >= options.today;

// ── Validation ───────────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const EXEMPTION_KINDS = new Set<ExemptionKind>(['declarative', 'generated', 'fixture']);

const readCommon = (
  path: string,
  value: Record<string, unknown>,
  errors: string[],
): { maxLines: number; rationale: string; owner: string } | undefined => {
  const { maxLines, rationale, owner } = value;
  if (typeof maxLines !== 'number' || !Number.isInteger(maxLines) || maxLines <= 0) {
    errors.push(`${path}: "maxLines" must be a positive integer`);
    return undefined;
  }
  if (typeof rationale !== 'string' || rationale.trim().length < 10) {
    errors.push(`${path}: "rationale" must be a non-empty explanation (≥10 chars)`);
    return undefined;
  }
  if (typeof owner !== 'string' || owner.trim().length === 0) {
    errors.push(`${path}: "owner" (review owner) is required`);
    return undefined;
  }
  return { maxLines, rationale, owner };
};

/**
 * Validates the permanent-exemption file.
 *
 * A malformed entry is an error rather than a silently-ignored line: a typo in
 * a path must never grant an unearned allowance.
 */
export const validateExemptions = (
  raw: unknown,
): { exemptions: ExemptionSet; errors: string[] } => {
  const errors: string[] = [];
  const exemptions: ExemptionSet = {};
  if (raw === undefined) {
    return { exemptions, errors };
  }
  if (!isRecord(raw)) {
    return { exemptions, errors: ['exemptions file must be a JSON object keyed by path'] };
  }

  for (const [path, value] of Object.entries(raw)) {
    if (path.startsWith('_')) {
      continue;
    }
    if (!isRecord(value)) {
      errors.push(`${path}: entry must be an object`);
      continue;
    }
    const common = readCommon(path, value, errors);
    if (!common) {
      continue;
    }
    const { kind, source } = value;
    if (typeof kind !== 'string' || !EXEMPTION_KINDS.has(kind as ExemptionKind)) {
      errors.push(`${path}: "kind" must be one of ${[...EXEMPTION_KINDS].join(', ')}`);
      continue;
    }
    if (source !== undefined && (typeof source !== 'string' || source.trim().length === 0)) {
      errors.push(`${path}: "source" must be a non-empty repo path when present`);
      continue;
    }
    if (kind === 'generated' && source === undefined) {
      errors.push(
        `${path}: kind "generated" needs a "source" naming the generator or fixture it is derived from`,
      );
      continue;
    }
    exemptions[path] = {
      ...common,
      kind: kind as ExemptionKind,
      ...(typeof source === 'string' ? { source } : {}),
    };
  }

  return { exemptions, errors };
};

/**
 * Validates the temporary-waiver file.
 *
 * `issue` and `reviewBy` are both required, and `reviewBy` must be a real
 * calendar date. Expired waivers are returned separately so the guard can fail
 * with the exact, actionable message rather than a generic parse error.
 */
export const validateWaivers = (
  raw: unknown,
  options: { today: string },
): { waivers: WaiverSet; errors: string[]; expired: { path: string; reviewBy: string }[] } => {
  const errors: string[] = [];
  const expired: { path: string; reviewBy: string }[] = [];
  const waivers: WaiverSet = {};
  if (raw === undefined) {
    return { waivers, errors, expired };
  }
  if (!isRecord(raw)) {
    return { waivers, errors: ['waivers file must be a JSON object keyed by path'], expired };
  }

  for (const [path, value] of Object.entries(raw)) {
    if (path.startsWith('_')) {
      continue;
    }
    if (!isRecord(value)) {
      errors.push(`${path}: entry must be an object`);
      continue;
    }
    const common = readCommon(path, value, errors);
    if (!common) {
      continue;
    }
    const { issue, reviewBy } = value;
    if (typeof issue !== 'string' || issue.trim().length === 0) {
      errors.push(
        `${path}: "issue" is required — a temporary waiver must name the work that removes it`,
      );
      continue;
    }
    if (typeof reviewBy !== 'string' || !isRealIsoDate(reviewBy)) {
      errors.push(`${path}: "reviewBy" must be a real ISO date (YYYY-MM-DD)`);
      continue;
    }
    if (!isWaiverCurrent({ reviewBy, today: options.today })) {
      expired.push({ path, reviewBy });
      continue;
    }
    waivers[path] = { ...common, issue, reviewBy };
  }

  return { waivers, errors, expired };
};

// ── Effective allowance ──────────────────────────────────────────────────

/**
 * The single ceiling that actually applies to a path.
 *
 * Precedence is waiver → exemption → baseline → hard limit. Only one may be
 * present at a time; the guard reports an overlap as a configuration error.
 */
export const effectiveAllowance = (options: {
  path: string;
  kind: SourceKind;
  budgetFor: (kind: SourceKind) => SizeBudget;
  baselineLines?: number;
  exemption?: PermanentExemption;
  waiver?: TemporaryWaiver;
  legacyMaxLines?: number;
}): EffectiveAllowance => {
  if (options.waiver) {
    return { lines: options.waiver.maxLines, source: 'waiver' };
  }
  if (options.exemption) {
    return { lines: options.exemption.maxLines, source: 'exemption' };
  }
  if (options.legacyMaxLines !== undefined) {
    return { lines: options.legacyMaxLines, source: 'exemption' };
  }
  if (options.baselineLines !== undefined) {
    return { lines: options.baselineLines, source: 'baseline' };
  }
  return { lines: options.budgetFor(options.kind).hard, source: 'hard-limit' };
};

/**
 * Builds the effective-allowance map for a set of paths.
 *
 * Used on BOTH sides of the trusted-base comparison, which is what makes a
 * representation change (baseline → waiver, exemption → waiver, single
 * exceptions file → split files) invisible to the comparison while a real
 * increase is not.
 */
export const effectiveAllowances = (options: {
  paths: readonly string[];
  isTestFile: (relPath: string) => boolean;
  budgetFor: (kind: SourceKind) => SizeBudget;
  baseline: Record<string, number>;
  exemptions: ExemptionSet;
  waivers: WaiverSet;
  legacyExceptions?: LegacyExceptionSet;
}): Record<string, number> => {
  const allowances: Record<string, number> = {};
  const paths = new Set([
    ...options.paths,
    ...Object.keys(options.baseline),
    ...Object.keys(options.exemptions),
    ...Object.keys(options.waivers),
    ...Object.keys(options.legacyExceptions ?? {}),
  ]);
  for (const path of paths) {
    const kind: SourceKind = options.isTestFile(path) ? 'test' : 'production';
    allowances[path] = effectiveAllowance({
      path,
      kind,
      budgetFor: options.budgetFor,
      baselineLines: options.baseline[path],
      exemption: options.exemptions[path],
      waiver: options.waivers[path],
      legacyMaxLines: options.legacyExceptions?.[path]?.maxLines,
    }).lines;
  }
  return allowances;
};

// ── Classification verification ──────────────────────────────────────────

/**
 * Minimal structural facts a classification check needs. Supplied by the
 * guard from a TypeScript parse so this module stays dependency-free and
 * testable.
 */
export type FileStructure = {
  /** Top-level `function`/`class` declarations and arrow-function consts. */
  logicDeclarations: number;
  /** Top-level declarations with an exported binding. */
  exportedDeclarations: number;
};

/**
 * Whether a file's declared exemption classification is defensible.
 *
 * `declarative` requires the file to contain no logic at all — a data table,
 * a schema, a lookup map. That is what stops "it is declarative" from being a
 * label an agent can attach to a mutable service kernel.
 */
export const classificationMatches = (options: {
  kind: ExemptionKind;
  relPath: string;
  structure: FileStructure;
  isGeneratedFile: (relPath: string) => boolean;
  isTestFile: (relPath: string) => boolean;
  /** True when `source` resolves to an existing repo path. */
  sourceExists: boolean;
}): { ok: true } | { ok: false; reason: string } => {
  const { kind, relPath, structure } = options;
  if (kind === 'declarative') {
    if (structure.logicDeclarations > 0) {
      return {
        ok: false,
        reason: `declared "declarative" but declares ${structure.logicDeclarations} function/class binding(s) — declarative exemptions are for data, not for logic`,
      };
    }
    return { ok: true };
  }
  if (kind === 'generated') {
    if (options.isGeneratedFile(relPath) || options.sourceExists) {
      return { ok: true };
    }
    return {
      ok: false,
      reason:
        'declared "generated" but the path matches no generated-file convention and its "source" does not exist — mutable logic may not be classified as generated',
    };
  }
  if (options.isTestFile(relPath) || /(^|\/)fixtures?\//.test(relPath)) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: 'declared "fixture" but the path is neither a test file nor under a fixtures directory',
  };
};

// ── Per-file assessment ──────────────────────────────────────────────────

/**
 * The outcome for one file.
 *
 * `warning` is advisory and never fails; `reduction` means the recorded debt
 * shrank and the reduction is not yet locked in; `over-limit` is the only
 * status that represents a real defect.
 */
export type FileStatus =
  | 'ok'
  | 'warning'
  | 'waiver'
  | 'exemption'
  | 'baselined'
  | 'reduction'
  | 'over-limit';

export type Assessment = {
  status: FileStatus;
  /** The ceiling that applies, when one does. */
  allowance?: number;
  /** Which representation produced the ceiling. */
  source?: AllowanceSource;
  /** Lines over the applicable ceiling, or saved by a reduction. */
  excess?: number;
  /** Ready-to-print explanation. */
  detail: string;
};

/**
 * Resolves a single file against its waiver, exemption, baseline entry and
 * budget.
 *
 * Precedence is waiver → exemption → baseline → hard limit. A baseline entry
 * that shrank is a `reduction`: a failure until locked in via
 * `--update-baseline`, because unlocked headroom can otherwise be silently
 * re-consumed by the next unrelated edit.
 */
export const assessFile = (options: {
  kind: SourceKind;
  lines: number;
  baselineLines?: number;
  exemption?: PermanentExemption;
  waiver?: TemporaryWaiver;
  budgetFor: (kind: SourceKind) => SizeBudget;
}): Assessment => {
  const { kind, lines, baselineLines, exemption, waiver } = options;
  const budget = options.budgetFor(kind);

  if (waiver) {
    if (lines > waiver.maxLines) {
      return {
        status: 'over-limit',
        allowance: waiver.maxLines,
        source: 'waiver',
        excess: lines - waiver.maxLines,
        detail: `exceeds its temporary waiver ceiling by ${lines - waiver.maxLines} lines (waiver issue ${waiver.issue}, review by ${waiver.reviewBy})`,
      };
    }
    return {
      status: 'waiver',
      allowance: waiver.maxLines,
      source: 'waiver',
      detail: `within its temporary waiver ceiling (issue ${waiver.issue}, review by ${waiver.reviewBy})`,
    };
  }

  if (exemption) {
    if (lines > exemption.maxLines) {
      return {
        status: 'over-limit',
        allowance: exemption.maxLines,
        source: 'exemption',
        excess: lines - exemption.maxLines,
        detail: `exceeds its permanent ${exemption.kind} exemption ceiling by ${lines - exemption.maxLines} lines`,
      };
    }
    return {
      status: 'exemption',
      allowance: exemption.maxLines,
      source: 'exemption',
      detail: `within its permanent ${exemption.kind} exemption ceiling`,
    };
  }

  if (baselineLines !== undefined) {
    if (lines > baselineLines) {
      return {
        status: 'over-limit',
        allowance: baselineLines,
        source: 'baseline',
        excess: lines - baselineLines,
        detail: `grew past its grandfathered baseline (+${lines - baselineLines})`,
      };
    }
    if (lines < baselineLines) {
      return {
        status: 'reduction',
        allowance: baselineLines,
        source: 'baseline',
        excess: baselineLines - lines,
        detail: `shrank from its baseline — run --update-baseline (or the sanctioned validation flow) to lock the reduction in (saved ${baselineLines - lines})`,
      };
    }
    return {
      status: 'baselined',
      allowance: baselineLines,
      source: 'baseline',
      detail: 'matches its grandfathered baseline',
    };
  }

  if (lines > budget.hard) {
    return {
      status: 'over-limit',
      allowance: budget.hard,
      source: 'hard-limit',
      excess: lines - budget.hard,
      detail: `new oversized module over the ${budget.hard}-line hard limit (+${lines - budget.hard})`,
    };
  }
  if (lines > budget.warn) {
    return {
      status: 'warning',
      allowance: budget.warn,
      source: 'hard-limit',
      excess: lines - budget.warn,
      detail: `over the ${budget.warn}-line warning threshold (+${lines - budget.warn})`,
    };
  }
  return { status: 'ok', detail: 'within budget' };
};

/** Stable, human-readable status label used in report output. */
export const statusLabel = (status: FileStatus): string => {
  switch (status) {
    case 'ok':
      return 'ok';
    case 'warning':
      return 'warn';
    case 'waiver':
      return 'waiver';
    case 'exemption':
      return 'exempt';
    case 'baselined':
      return 'baseline';
    case 'reduction':
      return 'reduction';
    case 'over-limit':
      return 'OVER';
  }
};

/** Sort helper: largest first, then path for deterministic output. */
export const bySizeDescending = (
  a: { lines: number; path: string },
  b: { lines: number; path: string },
): number => b.lines - a.lines || a.path.localeCompare(b.path);

// ── Diagnostics ──────────────────────────────────────────────────────────

/** The exact, non-bypass message an agent sees for an expired waiver. */
export const expiredWaiverMessage = (options: { path: string; reviewBy: string }): string =>
  [
    `Temporary source-size waiver for ${options.path} expired on ${options.reviewBy}.`,
    'Either reduce the file below its reviewed ceiling / hard limit,',
    'or obtain explicit human review for a renewed waiver.',
    'Do NOT extend reviewBy automatically — moving the deadline is a policy change, not a fix.',
  ].join('\n      ');

/**
 * The exact, non-bypass remediation an agent sees for an oversized mutable
 * module. Deliberately does not mention exceptions or baselines.
 */
export const oversizedMutableModuleMessage = (options: {
  path: string;
  lines: number;
  ceiling: number;
  source: AllowanceSource;
}): string =>
  [
    `This mutable module exceeds its allowed ceiling by ${options.lines - options.ceiling} lines`,
    `(${options.lines} lines against a ${options.ceiling}-line ${options.source}).`,
    '',
    '      Do not raise the ceiling automatically.',
    '',
    '      Preferred remediation:',
    '      1. identify a cohesive responsibility to extract;',
    '      2. preserve ownership and public API boundaries;',
    '      3. rerun full validation.',
    '',
    '      Changing the accepted ceiling is a guard-policy expansion and requires',
    '      explicit human review.',
  ].join('\n      ');
