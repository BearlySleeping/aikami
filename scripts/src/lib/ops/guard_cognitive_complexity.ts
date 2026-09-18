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
 * Parses `biome lint --reporter=json` output into complexity findings.
 *
 * Tolerates any other diagnostics in the report (the caller passes `--only`,
 * but a config change must not make the guard crash) and any unexpected shape —
 * a malformed entry is skipped rather than aborting the whole ratchet.
 */
export const parseBiomeComplexityReport = (raw: string): ComplexityFinding[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const diagnostics = (parsed as { diagnostics?: unknown }).diagnostics;
  if (!Array.isArray(diagnostics)) {
    return [];
  }

  const findings: ComplexityFinding[] = [];
  for (const entry of diagnostics as BiomeDiagnostic[]) {
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
  const report = runBiome();
  const findings = parseBiomeComplexityReport(report);

  if (findings.length === 0) {
    // A silent empty report means Biome did not scan anything — a config or
    // invocation change, not a repository that suddenly became simple. Treat it
    // as a failure rather than as a perfect score.
    console.error(
      '❌ cognitive-complexity guard produced an empty Biome report — Biome scanned no files, or the rule id changed. Refusing to report a perfect score from a measurement that did not happen.',
    );
    process.exit(1);
  }

  const violations: RatchetViolation[] = findings.map((finding) => ({
    file: finding.file,
    rule: 'excessive',
    line: finding.line,
    message: `function has cognitive complexity ${finding.score} (threshold 15)`,
  }));

  if (args.includes('--show-all')) {
    console.log(
      `ℹ️  ${findings.length} excessive-complexity finding(s) across ${new Set(findings.map((finding) => finding.file)).size} file(s) (baseline ignored)`,
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
