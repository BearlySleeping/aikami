// scripts/src/lib/ops/guards/policy_diff.ts
//
// Guard-policy change detection.
//
// Debt reduction and debt acceptance look identical in a diff at a glance —
// both edit a JSON file of numbers. This module makes the difference
// machine-detectable so an autonomous PR that changes what counts as
// acceptable debt is labelled as such, loudly, instead of sliding through as
// "housekeeping".
//
// Three verdicts:
//
//   debt-reduction    — every changed allowance went down or away.
//   policy-expansion  — at least one allowance grew, appeared, or a lint
//                       severity was relaxed.
//   policy-refactor   — policy files changed without relaxing anything
//                       (a guard implementation, a comment, a rename).
//
// 🔴 Detection is not the same as authorization. A policy expansion is
// permitted only through the explicit, human-controlled authorization channel
// (a maintainer-applied `guard-policy-approved` label, surfaced to CI as
// `AIKAMI_GUARD_POLICY_AUTHORIZATION`). An agent cannot apply a label.
//
// Pure module: callers pass the two revisions' already-parsed contents.

import { diffAllowances, type RatchetChange, type RatchetDiff } from './ratchet.ts';

export type PolicyVerdict =
  | 'no-policy-change'
  | 'debt-reduction'
  | 'policy-expansion'
  | 'policy-refactor';

/** What kind of policy artifact a changed path is. */
export type PolicyFileKind =
  | 'allowance'
  | 'lint-config'
  | 'guard-implementation'
  | 'ci-wiring'
  | 'unknown';

export type PolicyFileChange = {
  path: string;
  kind: PolicyFileKind;
};

export type PolicyReport = {
  verdict: PolicyVerdict;
  files: PolicyFileChange[];
  /** Allowance increases, when the changed files carry allowances. */
  expansions: RatchetChange[];
  reductions: RatchetChange[];
  /** Lint rules whose severity was relaxed / tightened. */
  relaxedLintRules: string[];
  tightenedLintRules: string[];
};

const BIOME_LINT_LEVELS = ['off', 'info', 'warn', 'error'] as const;
type LintLevel = (typeof BIOME_LINT_LEVELS)[number];

const levelOf = (value: unknown): LintLevel | undefined => {
  if (typeof value === 'string') {
    return (BIOME_LINT_LEVELS as readonly string[]).includes(value)
      ? (value as LintLevel)
      : undefined;
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const level = (value as { level?: unknown }).level;
    return typeof level === 'string' && (BIOME_LINT_LEVELS as readonly string[]).includes(level)
      ? (level as LintLevel)
      : undefined;
  }
  return undefined;
};

/** Flattens `linter.rules.<group>.<rule>` into `group/rule → level`. */
export const lintRuleLevels = (config: unknown): Map<string, LintLevel> => {
  const levels = new Map<string, LintLevel>();
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return levels;
  }
  const rules = (config as { linter?: { rules?: unknown } }).linter?.rules;
  if (typeof rules !== 'object' || rules === null || Array.isArray(rules)) {
    return levels;
  }
  for (const [group, groupRules] of Object.entries(rules as Record<string, unknown>)) {
    if (group === 'preset' || typeof groupRules !== 'object' || groupRules === null) {
      continue;
    }
    for (const [rule, value] of Object.entries(groupRules as Record<string, unknown>)) {
      const level = levelOf(value);
      if (level !== undefined) {
        levels.set(`${group}/${rule}`, level);
      }
    }
  }
  return levels;
};

const LEVEL_RANK: Record<LintLevel, number> = { off: 0, info: 1, warn: 2, error: 3 };

/**
 * Compares two Biome configs and returns the rules whose severity changed.
 *
 * A rule moving from `error` to `off` is a relaxation; the reverse is a
 * tightening. A rule that disappears entirely falls back to the preset — which
 * this cannot resolve — so removal is only flagged when the previous level was
 * stricter than `warn`, and a newly configured level below `warn` is likewise
 * reported as a relaxation rather than as a tightening.
 */
export const compareLintSeverities = (options: {
  before: unknown;
  after: unknown;
}): { relaxed: string[]; tightened: string[] } => {
  const before = lintRuleLevels(options.before);
  const after = lintRuleLevels(options.after);
  const relaxed: string[] = [];
  const tightened: string[] = [];
  for (const rule of new Set([...before.keys(), ...after.keys()])) {
    const from = before.get(rule);
    const to = after.get(rule);
    if (to === undefined) {
      if (from !== undefined && LEVEL_RANK[from] > LEVEL_RANK.warn) {
        relaxed.push(`${rule}: ${from} → (unset)`);
      }
      continue;
    }
    if (from === undefined) {
      // 🔴 `unset` means "whatever the preset says", and the preset cannot be
      // resolved from a config diff alone. So a NEWLY configured rule is
      // classified by rank, in the conservative direction:
      //
      //   • a level below `warn` — notably an explicit `off` — can only weaken
      //     enforcement or leave it unchanged, and is reported as a relaxation
      //     so a human sees it. Calling it a tightening would let "explicitly
      //     disable a rule that the preset was enforcing" sail through as a
      //     no-relaxation refactor.
      //   • `warn` and above is an explicit enforcement statement.
      if (LEVEL_RANK[to] < LEVEL_RANK.warn) {
        relaxed.push(`${rule}: (unset) → ${to}`);
      } else {
        tightened.push(`${rule}: (unset) → ${to}`);
      }
      continue;
    }
    if (LEVEL_RANK[to] < LEVEL_RANK[from]) {
      relaxed.push(`${rule}: ${from} → ${to}`);
    } else if (LEVEL_RANK[to] > LEVEL_RANK[from]) {
      tightened.push(`${rule}: ${from} → ${to}`);
    }
  }
  return { relaxed, tightened };
};

/** Classifies a repo-relative path into the kind of policy artifact it is. */
export const policyKindFor = (path: string): PolicyFileKind => {
  if (path.endsWith('biome.json')) {
    return 'lint-config';
  }
  if (path.includes('.github/workflows/') || path.includes('.moon/tasks/')) {
    return 'ci-wiring';
  }
  if (path.endsWith('validation_policy.ts') || path.endsWith('pre_push_gate.ts')) {
    return 'ci-wiring';
  }
  if (
    /_baseline\.json$/.test(path) ||
    /guard_source_file_size_(baseline|exemptions|waivers|exceptions)\.json$/.test(path)
  ) {
    return 'allowance';
  }
  if (path.includes('scripts/src/lib/ops/guard') || path.includes('scripts/src/lib/ops/guards/')) {
    return 'guard-implementation';
  }
  return 'unknown';
};

/**
 * Classifies a guard-policy change.
 *
 * Allowances are compared as EFFECTIVE allowances over the whole policy (the
 * single ceiling a path actually has, whichever file expresses it), so a
 * representation change — baseline → waiver, the old single exceptions file →
 * the split exemptions/waivers files — is not mistaken for an expansion.
 */
export const classifyPolicyChange = (options: {
  changedPaths: readonly string[];
  beforeAllowances?: Record<string, number>;
  afterAllowances?: Record<string, number>;
  biomeBefore?: unknown;
  biomeAfter?: unknown;
}): PolicyReport => {
  const files = [...options.changedPaths]
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({ path, kind: policyKindFor(path) }));

  if (files.length === 0) {
    return {
      verdict: 'no-policy-change',
      files: [],
      expansions: [],
      reductions: [],
      relaxedLintRules: [],
      tightenedLintRules: [],
    };
  }

  let sawExpansion = false;
  let sawReduction = false;

  const allowanceDiff: RatchetDiff = diffAllowances({
    trusted: options.beforeAllowances ?? {},
    current: options.afterAllowances ?? {},
  });
  if (allowanceDiff.expansions.length > 0) {
    sawExpansion = true;
  }
  if (allowanceDiff.reductions.length > 0) {
    sawReduction = true;
  }

  const lintChanged = files.some((file) => file.kind === 'lint-config');
  const { relaxed, tightened } = lintChanged
    ? compareLintSeverities({ before: options.biomeBefore, after: options.biomeAfter })
    : { relaxed: [], tightened: [] };
  if (relaxed.length > 0) {
    sawExpansion = true;
  }
  if (tightened.length > 0) {
    sawReduction = true;
  }

  const verdict = verdictOf({ sawExpansion, sawReduction });

  return {
    verdict,
    files,
    expansions: allowanceDiff.expansions,
    reductions: allowanceDiff.reductions,
    relaxedLintRules: relaxed,
    tightenedLintRules: tightened,
  };
};

/** The overall verdict, from what each individual file contributed. */
const verdictOf = (options: { sawExpansion: boolean; sawReduction: boolean }): PolicyVerdict => {
  if (options.sawExpansion) {
    return 'policy-expansion';
  }
  return options.sawReduction ? 'debt-reduction' : 'policy-refactor';
};

/** Renders the report for CI output. */
export const renderPolicyReport = (options: {
  report: PolicyReport;
  authorized: boolean;
}): string[] => {
  const { report, authorized } = options;
  if (report.verdict === 'no-policy-change') {
    return ['✅ no guard-policy change in this diff'];
  }

  const heading: Record<PolicyVerdict, string> = {
    'no-policy-change': 'No policy change',
    'debt-reduction': 'DEBT REDUCTION — allowed automatically',
    'policy-expansion': 'POLICY EXPANSION — requires explicit human review',
    'policy-refactor': 'POLICY REFACTOR / NO RELAXATION — review for a relaxed rule',
  };

  const lines: string[] = [
    '════════════════════════════════════════════════════════════════',
    '  GUARD POLICY CHANGE',
    '════════════════════════════════════════════════════════════════',
    '',
    '  This diff changes what counts as acceptable debt, not just the code.',
    '',
    `  Verdict: ${heading[report.verdict]}`,
    '',
    '  Changed policy files:',
  ];
  for (const file of report.files) {
    lines.push(`    • ${file.path} [${file.kind}]`);
  }

  if (report.expansions.length > 0) {
    lines.push('', '  Allowance increases:');
    for (const change of report.expansions) {
      lines.push(`      ${change.file}: ${change.detail}`);
    }
  }
  if (report.relaxedLintRules.length > 0) {
    lines.push('', '  Lint severities relaxed:');
    for (const rule of report.relaxedLintRules) {
      lines.push(`      ${rule}`);
    }
  }
  if (report.reductions.length > 0) {
    lines.push('', '  Allowance reductions (fine — reductions are always allowed):');
    for (const change of report.reductions) {
      lines.push(`      ${change.file}: ${change.detail}`);
    }
  }
  if (report.tightenedLintRules.length > 0) {
    lines.push('', '  Lint severities tightened:');
    for (const rule of report.tightenedLintRules) {
      lines.push(`      ${rule}`);
    }
  }

  if (report.verdict === 'policy-expansion') {
    lines.push('');
    if (authorized) {
      lines.push(
        '  🔑 Authorization present (guard-policy-approved). The expansion is recorded as reviewed.',
      );
    } else {
      lines.push(
        '  🔴 No authorization present. An autonomous agent must NOT land this change.',
        '     A maintainer must apply the `guard-policy-approved` label to the pull request —',
        '     that label is the only channel that sets AIKAMI_GUARD_POLICY_AUTHORIZATION, and it',
        '     requires write access to the repository.',
      );
    }
  }

  return lines;
};
