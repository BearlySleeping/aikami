// scripts/src/lib/ops/guard_cognitive_complexity.ts
//
// Cognitive-complexity ratchet — the second maintainability signal, and a
// deliberately DIFFERENT one from file size.
//
//   LOC                  => this module may own too much
//   cognitive complexity => this control flow may be too hard to follow
//
// They are not substitutes. A 700-line file of flat, table-driven code is
// easy to read; a 200-line function with seven nested conditionals is not.
// Without this guard the second case is invisible to the repository.
//
// ── Why Biome does the measuring ─────────────────────────────────────────
//
// `complexity/noExcessiveCognitiveComplexity` is Biome's own implementation of
// the metric. Re-implementing the scoring in a custom parser would create a
// second, subtly different definition of complexity, and the repository would
// then have two numbers nobody could reconcile. So the guard shells out to the
// rule the linter already ships:
//
//   biome lint --only=complexity/noExcessiveCognitiveComplexity --reporter=json
//
// and ratchets its output. The measurement is Biome's; only the policy is ours.
//
// ── Why the rule stays off in biome.json ─────────────────────────────────
//
// The rule is NOT enabled in biome.json, and that is deliberate. 388 files in
// this repository currently contain a function above the default threshold of
// 15. Enabling it as `warn` would make `biome check --error-on-warnings` —
// which several packages' `:fix` scripts run — fail on all of them at once,
// turning a maintainability signal into a repository-wide red build. `--only`
// reports the rule regardless of its configured level, so the guard gets the
// full measurement while `bun run lint` and `bun run fix` stay quiet.
//
// The signal is therefore: ratcheted, per file, on BOTH the number of
// excessive functions and the worst score in the file. Adding a complex
// function to a file that already had one still fails, and making an existing
// one worse fails too.
//
// ── Ratchet semantics ───────────────────────────────────────────────────
//
// Two rules per file:
//   `excessive` — how many functions exceed the threshold (count, may only fall)
//   `worst`     — the highest complexity score in the file (may only fall)
//
// `--update-baseline` is REDUCTION-ONLY (shared framework,
// scripts/src/lib/ops/guards/ratchet.ts). Suppressing a finding with an
// unreviewed `biome-ignore` comment is not a fix either: it removes the
// measurement rather than the complexity, and the ignore comment is itself
// visible in review.
//
// Usage:
//   bun run src/lib/ops/guard_cognitive_complexity.ts
//   bun run src/lib/ops/guard_cognitive_complexity.ts --update-baseline  # reductions only
//   bun run src/lib/ops/guard_cognitive_complexity.ts --show-all
//   bun run src/lib/ops/guard_cognitive_complexity.ts --base-ref=origin/main
//
// Exits non-zero on any new excessive function, any worse score, any
// improvement not yet locked in, or any growth relative to an explicitly
// configured base revision.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RatchetBaseline, RatchetRuleSpec, RatchetViolation } from './guards/ratchet.ts';
import { runRatchet } from './guards/ratchet_runner.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const BASELINE_PATH = resolve(import.meta.dir, 'guard_cognitive_complexity_baseline.json');
const BASELINE_REL_PATH = 'scripts/src/lib/ops/guard_cognitive_complexity_baseline.json';

/** Biome's rule id, used with `--only` and to filter the JSON report. */
export const RULE_CATEGORY = 'lint/complexity/noExcessiveCognitiveComplexity';

/** The two ratcheted quantities. Both may only fall. */
export const RULES: readonly RatchetRuleSpec[] = [
  {
    id: 'excessive',
    label: 'excessive cognitive complexity',
    remediation:
      'Flatten the control flow: early returns instead of nesting, extract a named helper for a branch body, or replace a branch ladder with a lookup table. Do not add a biome-ignore comment — that hides the measurement, not the complexity, and the baseline cannot be raised.',
  },
  {
    id: 'worst',
    label: 'worst complexity score in the file',
    remediation:
      'The hardest function in this file got harder. Split its branches into named steps so each reads on its own. The score may only fall.',
  },
];

// ── Biome report parsing (pure) ──────────────────────────────────────────

export type ComplexityFinding = { file: string; line: number; score: number };

type BiomeDiagnostic = {
  category?: unknown;
  message?: unknown;
  location?: { path?: unknown; start?: { line?: unknown } };
};

/**
 * Summary counters a `biome lint --reporter=json` report must carry.
 *
 * 🔴 These are what distinguishes "Biome measured the repository and found
 * nothing" from "Biome did not run". A guard that treats an empty `diagnostics`
 * array as a perfect score would silently report zero debt forever after a
 * config change, a renamed rule, or a broken invocation.
 */
const REQUIRED_SUMMARY_COUNTERS = [
  'changed',
  'unchanged',
  'errors',
  'warnings',
  'infos',
  'skipped',
] as const;

export type BiomeReportCheck =
  | { ok: true; diagnostics: readonly BiomeDiagnostic[]; filesExamined: number }
  | { ok: false; reason: string };

/**
 * Validates that a string really is a Biome LINT report that examined files.
 *
 * Fail-closed by construction: every unexpected shape is an error rather than
 * an empty result, because the caller cannot tell an empty result apart from a
 * measurement that never happened.
 */
export const checkBiomeReport = (raw: string): BiomeReportCheck => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `the report is not valid JSON: ${message}` };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'the report is not a JSON object' };
  }

  const { command, summary, diagnostics } = parsed as {
    command?: unknown;
    summary?: unknown;
    diagnostics?: unknown;
  };
  if (command !== 'lint') {
    return {
      ok: false,
      reason: `expected a \`lint\` report, got \`${String(command)}\` — the invocation or the Biome version changed`,
    };
  }
  if (!Array.isArray(diagnostics)) {
    return { ok: false, reason: 'the report has no `diagnostics` array' };
  }
  if (typeof summary !== 'object' || summary === null || Array.isArray(summary)) {
    return { ok: false, reason: 'the report has no `summary` object' };
  }

  const counters = summary as Record<string, unknown>;
  for (const key of REQUIRED_SUMMARY_COUNTERS) {
    const value = counters[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return {
        ok: false,
        reason: `the report's summary.${key} is not a non-negative integer (got ${JSON.stringify(value)})`,
      };
    }
  }

  const filesExamined = Number(counters.changed) + Number(counters.unchanged);
  if (filesExamined === 0) {
    return {
      ok: false,
      reason:
        'the report examined 0 files — Biome scanned nothing, so this is not a measurement of the repository',
    };
  }

  // `--only` scopes the run to one rule, so any OTHER lint diagnostic means the
  // invocation changed. Parse and format diagnostics are fine and are ignored.
  const foreignLintCategories = [
    ...new Set(
      (diagnostics as BiomeDiagnostic[])
        .map((entry) => entry?.category)
        .filter(
          (category): category is string =>
            typeof category === 'string' &&
            category.startsWith('lint/') &&
            category !== RULE_CATEGORY,
        ),
    ),
  ];
  if (foreignLintCategories.length > 0) {
    return {
      ok: false,
      reason: `the report contains lint diagnostics from other rules (${foreignLintCategories.join(', ')}) — the \`--only\` scope was lost`,
    };
  }

  return { ok: true, diagnostics: diagnostics as BiomeDiagnostic[], filesExamined };
};

/**
 * Extracts complexity findings from an already-validated report.
 *
 * An individual entry that cannot be read is skipped rather than aborting the
 * scan: `checkBiomeReport` has already established that this IS a measurement,
 * and one unreadable entry must not discard the rest of it.
 */
export const parseComplexityFindings = (
  diagnostics: readonly BiomeDiagnostic[],
): ComplexityFinding[] => {
  const findings: ComplexityFinding[] = [];
  for (const entry of diagnostics) {
    if (entry?.category !== RULE_CATEGORY) {
      continue;
    }
    const message = typeof entry.message === 'string' ? entry.message : '';
    const scoreMatch = message.match(/complexity of (\d+)/i);
    const path = typeof entry.location?.path === 'string' ? entry.location.path : undefined;
    if (!scoreMatch || path === undefined) {
      continue;
    }
    const line = typeof entry.location?.start?.line === 'number' ? entry.location.start.line : 1;
    findings.push({ file: path.split('\\').join('/'), line, score: Number(scoreMatch[1]) });
  }
  return findings;
};

/**
 * Validates and parses in one step. Returns the failure reason instead of an
 * empty finding list, so a caller cannot mistake the two.
 */
export const readBiomeComplexityReport = (
  raw: string,
):
  | { ok: true; findings: ComplexityFinding[]; filesExamined: number }
  | { ok: false; reason: string } => {
  const check = checkBiomeReport(raw);
  if (!check.ok) {
    return { ok: false, reason: check.reason };
  }
  return {
    ok: true,
    findings: parseComplexityFindings(check.diagnostics),
    filesExamined: check.filesExamined,
  };
};

/** Folds findings into the two-rule per-file baseline. */
export const baselineFromFindings = (findings: readonly ComplexityFinding[]): RatchetBaseline => {
  const byFile = new Map<string, { count: number; worst: number }>();
  for (const finding of findings) {
    const entry = byFile.get(finding.file) ?? { count: 0, worst: 0 };
    entry.count++;
    entry.worst = Math.max(entry.worst, finding.score);
    byFile.set(finding.file, entry);
  }
  const baseline: RatchetBaseline = {};
  for (const [file, entry] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
    baseline[file] = { counts: { excessive: entry.count, worst: entry.worst } };
  }
  return baseline;
};

// ── Biome invocation ─────────────────────────────────────────────────────

const biomeCommand = (): { command: string; args: string[] } => {
  const local = resolve(ROOT, 'node_modules/.bin/biome');
  if (existsSync(local)) {
    return { command: local, args: [] };
  }
  return { command: 'bunx', args: ['biome'] };
};

const runBiome = (): string => {
  const { command, args } = biomeCommand();
  try {
    return execFileSync(
      command,
      [
        ...args,
        'lint',
        `--only=complexity/noExcessiveCognitiveComplexity`,
        '--reporter=json',
        '--max-diagnostics=none',
      ],
      {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } catch (error) {
    // Biome exits non-zero when it reports diagnostics, so a non-zero status is
    // normal. Only a genuinely unreadable report is an error.
    const stdout = (error as { stdout?: string }).stdout;
    if (typeof stdout === 'string' && stdout.trim().length > 0) {
      return stdout;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `❌ cognitive-complexity guard could not run Biome — the measurement is unavailable, so this fails closed: ${message.split('\n')[0]}`,
    );
    process.exit(1);
  }
};

// ── Main ─────────────────────────────────────────────────────────────────

const main = (): void => {
  const args = process.argv.slice(2);
  const report = readBiomeComplexityReport(runBiome());

  // 🔴 A report that cannot be validated is NOT "zero complexity". Biome failing
  // to run, a renamed rule, a lost `--only` scope or a malformed report must all
  // fail closed rather than being baselined as a clean repository.
  if (!report.ok) {
    console.error(
      `❌ cognitive-complexity guard could not trust the Biome report — ${report.reason}. Refusing to report a score from a measurement that did not happen.`,
    );
    process.exit(1);
  }

  const { findings, filesExamined } = report;
  const violations: RatchetViolation[] = findings.map((finding) => ({
    file: finding.file,
    rule: 'excessive',
    line: finding.line,
    message: `function has cognitive complexity ${finding.score} (threshold 15)`,
  }));

  if (args.includes('--show-all')) {
    console.log(
      `ℹ️  ${findings.length} excessive-complexity finding(s) across ${new Set(findings.map((finding) => finding.file)).size} file(s) of ${filesExamined} examined (baseline ignored)`,
    );
  }

  runRatchet({
    name: 'cognitive-complexity',
    root: ROOT,
    baselinePath: BASELINE_PATH,
    baselineRelPath: BASELINE_REL_PATH,
    rules: RULES,
    violations,
    current: baselineFromFindings(findings),
    hardFailures: 0,
    identityAware: false,
    args,
    summary: `${findings.length} finding(s) in ${new Set(findings.map((finding) => finding.file)).size} file(s)`,
  });
};

if (import.meta.main) {
  main();
}
