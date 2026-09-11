// scripts/src/lib/ops/guard_source_file_size.ts
//
// Pragmatic source-file size guard.
//
// It exists to stop NEW oversized, multi-responsibility modules, not to force
// every file under a number or to rewrite existing debt. Three tiers:
//
//   • Warning (non-failing): production > 500 physical lines, tests > 800.
//   • Hard limit: production > 800, tests > 1500. A new file above the hard
//     limit fails unless it carries a reviewed exception.
//   • Baseline: files already over the hard limit at bootstrap are recorded
//     with their exact size in guard_source_file_size_baseline.json. They may
//     not grow past it; a reduction must be locked in with --update-baseline
//     so the freed headroom cannot be silently consumed later.
//
// Exceptions live in guard_source_file_size_exceptions.json and require a path,
// an exact maximum, a rationale, and an owner — plus an issue or review date
// for temporary debt. "Too hard to refactor" is not a rationale.
//
// Ratings are a RATCHET on existing debt plus a stop on new debt; they are not
// an architecture proof. See the review checklist in
// .pi/skills/aikami-conventions/SKILL.md.
//
// Usage:
//   bun run scripts/src/lib/ops/guard_source_file_size.ts [--show-all]
//     [--update-baseline | --bootstrap-baseline]
//
// Exits non-zero on any new oversized file, baseline growth, unlocked
// reduction, malformed/obsolete exception, or unauthorized baseline expansion
// against the trusted base revision (BASE_REF / AIKAMI_GUARD_BASE_REF).

import { execFileSync } from 'node:child_process';
import { type Dirent, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import {
  assessFile,
  type Baseline,
  budgetFor,
  countPhysicalLines,
  type ExceptionSet,
  findBaselineExpansion,
  isExcludedDir,
  isGeneratedFile,
  isSourceFile,
  isTestFile,
  type ScannedFile,
  validateBaselineReduction,
  validateExceptions,
} from './guard_source_file_size_helpers.ts';
import {
  type FileAssessment,
  printFailures,
  printReport,
  printWarnings,
} from './guard_source_file_size_output.ts';

// Root and file locations are overridable so tests can run the guard against
// an isolated fixture tree without touching the repository's real baseline.
const ROOT = resolve(process.env.AIKAMI_GUARD_ROOT ?? resolve(import.meta.dir, '../../../..'));
const SCAN_ROOTS = ['apps', 'packages', 'scripts', '.pi'].map((dir) => resolve(ROOT, dir));
const BASELINE_PATH = resolve(
  process.env.AIKAMI_GUARD_BASELINE ??
    resolve(import.meta.dir, 'guard_source_file_size_baseline.json'),
);
const EXCEPTIONS_PATH = resolve(
  process.env.AIKAMI_GUARD_EXCEPTIONS ??
    resolve(import.meta.dir, 'guard_source_file_size_exceptions.json'),
);
const BASELINE_REL_PATH = relative(ROOT, BASELINE_PATH).split(sep).join('/');

// ── File discovery ───────────────────────────────────────────────────────

const scanSources = (): { files: ScannedFile[]; generatedExcluded: number } => {
  const files: ScannedFile[] = [];
  let generatedExcluded = 0;

  const walk = (dir: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = resolve(dir, entry.name);
      const rel = relative(ROOT, full).split(sep).join('/');
      if (entry.isDirectory()) {
        if (isExcludedDir({ name: entry.name, relPath: rel })) {
          continue;
        }
        walk(full);
        continue;
      }
      if (!entry.isFile() || !isSourceFile(entry.name)) {
        continue;
      }
      if (isGeneratedFile(rel)) {
        generatedExcluded++;
        continue;
      }
      let content: string;
      try {
        content = readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      files.push({
        path: rel,
        lines: countPhysicalLines(content),
        kind: isTestFile(rel) ? 'test' : 'production',
      });
    }
  };

  for (const root of SCAN_ROOTS) {
    walk(root);
  }
  return { files, generatedExcluded };
};

// ── JSON I/O ─────────────────────────────────────────────────────────────

const readJson = (path: string): unknown => {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`could not parse ${relative(ROOT, path)}: ${message}`);
  }
};

const loadExceptions = (): { exceptions: ExceptionSet; errors: string[] } =>
  validateExceptions(readJson(EXCEPTIONS_PATH));

type BaselineParse = { ok: true; baseline: Baseline } | { ok: false; error: string };

const parseBaseline = (raw: unknown, label: string): BaselineParse => {
  if (raw === undefined) {
    return { ok: true, baseline: {} };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: `${label} must be a JSON object of path → line count` };
  }
  const baseline: Baseline = {};
  for (const [path, value] of Object.entries(raw)) {
    if (path.startsWith('_')) {
      continue;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      return { ok: false, error: `${label}: ${path} must map to a positive integer` };
    }
    baseline[path] = value;
  }
  return { ok: true, baseline };
};

const loadBaseline = (): BaselineParse => {
  let raw: unknown;
  try {
    raw = readJson(BASELINE_PATH);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return parseBaseline(raw, relative(ROOT, BASELINE_PATH));
};

const serializeBaseline = (baseline: Baseline): string => {
  const sorted: Baseline = {};
  for (const path of Object.keys(baseline).sort()) {
    sorted[path] = baseline[path] ?? 0;
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
};

const currentOverHard = (options: { files: ScannedFile[]; exceptions: ExceptionSet }): Baseline => {
  const baseline: Baseline = {};
  for (const file of options.files) {
    if (options.exceptions[file.path]) {
      continue;
    }
    if (file.lines > budgetFor(file.kind).hard) {
      baseline[file.path] = file.lines;
    }
  }
  return baseline;
};

// ── Trusted-base baseline comparison ─────────────────────────────────────

type TrustedResult =
  | { status: 'ok'; baseline: Baseline }
  | { status: 'missing' }
  | { status: 'unavailable'; message: string };

const readBaselineAtRef = (ref: string): TrustedResult => {
  try {
    const output = execFileSync('git', ['show', `${ref}:${BASELINE_REL_PATH}`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = parseBaseline(JSON.parse(output), `${ref}:${BASELINE_REL_PATH}`);
    if (!parsed.ok) {
      return { status: 'unavailable', message: parsed.error };
    }
    return { status: 'ok', baseline: parsed.baseline };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A baseline that does not exist at the base revision is the initial
    // bootstrap: nothing to compare against yet.
    if (message.includes('exists on disk, but not in') || message.includes('does not exist in')) {
      return { status: 'missing' };
    }
    return { status: 'unavailable', message };
  }
};

// ── Modes ────────────────────────────────────────────────────────────────

const writeBaseline = (baseline: Baseline): void => {
  writeFileSync(BASELINE_PATH, serializeBaseline(baseline));
};

const runBootstrap = (options: { files: ScannedFile[]; exceptions: ExceptionSet }): void => {
  if (existsSync(BASELINE_PATH)) {
    console.error(
      `🔴 ${BASELINE_REL_PATH} already exists. Bootstrap is a one-time, reviewed act; use --update-baseline to shrink it.`,
    );
    process.exit(1);
  }
  const baseline = currentOverHard(options);
  writeBaseline(baseline);
  console.log(
    `✅ Bootstrapped ${BASELINE_REL_PATH}: ${Object.keys(baseline).length} over-limit file(s) grandfathered`,
  );
};

const runUpdate = (options: {
  files: ScannedFile[];
  exceptions: ExceptionSet;
  baseline: Baseline;
}): void => {
  const next = currentOverHard(options);
  const check = validateBaselineReduction({ previous: options.baseline, next });
  if (!check.ok) {
    console.error('🔴 refusing to update the baseline — it may only shrink or remove allowances:');
    for (const error of check.errors) {
      console.error(`      ${error}`);
    }
    console.error(
      '   Add a reviewed entry to guard_source_file_size_exceptions.json instead of granting new headroom.',
    );
    process.exit(1);
  }
  writeBaseline(next);
  const removed = Object.keys(options.baseline).filter((path) => next[path] === undefined).length;
  console.log(
    `✅ Baseline updated: ${Object.keys(options.baseline).length} → ${Object.keys(next).length} file(s) (${removed} removed/graduated)`,
  );
};

const runCheck = (options: {
  files: ScannedFile[];
  exceptions: ExceptionSet;
  baseline: Baseline;
  generatedExcluded: number;
  showAll: boolean;
  baseRef?: string;
}): void => {
  const { files, exceptions, baseline, generatedExcluded, showAll, baseRef } = options;
  const failures: FileAssessment[] = [];
  const warnings: FileAssessment[] = [];

  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    const assessment = assessFile({
      kind: file.kind,
      lines: file.lines,
      baselineLines: baseline[file.path],
      exception: exceptions[file.path],
    });
    if (assessment.status === 'warning') {
      warnings.push({ file, assessment });
    } else if (
      assessment.status !== 'ok' &&
      assessment.status !== 'baselined' &&
      assessment.status !== 'exception'
    ) {
      failures.push({ file, assessment });
    }
  }

  // Deleted or renamed-away baseline entries and stale exceptions are failures.
  const scannedPaths = new Set(files.map((file) => file.path));
  const scannedByPath = new Map(files.map((file) => [file.path, file]));
  const configErrors: string[] = [];
  for (const path of Object.keys(baseline)) {
    if (!scannedPaths.has(path)) {
      configErrors.push(
        `baseline entry for ${path} no longer resolves to a scanned source file — if this was a rename, add a reviewed exception for the new path, then run --update-baseline`,
      );
    } else if (exceptions[path]) {
      configErrors.push(
        `baseline entry for ${path} is superseded by an exception — remove one of them`,
      );
    }
  }
  for (const [path, exception] of Object.entries(exceptions)) {
    const file = scannedByPath.get(path);
    if (!file) {
      configErrors.push(
        `obsolete exception for ${path} — the file is missing or generated; remove the exception`,
      );
      continue;
    }
    const budget = budgetFor(file.kind);
    if (file.lines <= budget.hard) {
      configErrors.push(
        `obsolete exception for ${path} — the file is now within the ${budget.hard}-line hard limit; remove the exception`,
      );
      continue;
    }
    if (exception.maxLines <= budget.hard) {
      configErrors.push(
        `obsolete exception for ${path} — maxLines ${exception.maxLines} does not relax the ${budget.hard}-line hard limit; raise or remove it`,
      );
    }
  }

  if (baseRef) {
    const trusted = readBaselineAtRef(baseRef);
    if (trusted.status === 'ok') {
      const expansions = findBaselineExpansion({ trusted: trusted.baseline, current: baseline });
      for (const expansion of expansions) {
        configErrors.push(
          `unauthorized baseline expansion vs ${baseRef}: ${expansion} — revert it or add a reviewed exception`,
        );
      }
    } else if (trusted.status === 'unavailable') {
      console.log(
        `⚠️  base-revision baseline check skipped (${baseRef}): ${trusted.message.split('\n')[0]}`,
      );
    }
  }

  if (warnings.length > 0) {
    printWarnings(warnings);
  }
  if (failures.length > 0) {
    printFailures(failures);
  }
  if (configErrors.length > 0) {
    console.error(`❌ exception/baseline configuration`);
    for (const error of configErrors) {
      console.error(`      ${error}`);
    }
  }
  if (showAll) {
    printReport({ files, exceptions, baseline, generatedExcluded });
  }

  if (failures.length > 0 || configErrors.length > 0) {
    console.error(
      `\n🔴 source-file-size guard failed — ${failures.length} oversized, ${configErrors.length} config issue(s)`,
    );
    process.exit(1);
  }

  console.log(
    `✅ source-file-size guard passed — ${files.length} file(s) checked, ${Object.keys(baseline).length} baselined, ${warnings.length} warning(s) (non-failing)`,
  );
};

// ── Entry point ──────────────────────────────────────────────────────────

const getBaseRef = (args: string[]): string | undefined => {
  const inline = args.find((arg) => arg.startsWith('--base-ref='));
  if (inline) {
    return inline.slice('--base-ref='.length);
  }
  const index = args.indexOf('--base-ref');
  if (index >= 0 && args[index + 1]) {
    return args[index + 1];
  }
  if (process.env.AIKAMI_GUARD_BASE_REF) {
    return process.env.AIKAMI_GUARD_BASE_REF;
  }
  // CI exports a bare branch name (BASE_REF=main); moon diffs against
  // `origin/main`, so compare the baseline against the same ref.
  const base = process.env.BASE_REF;
  if (base && !base.startsWith('origin/')) {
    return `origin/${base}`;
  }
  return base;
};

const main = (): void => {
  const args = process.argv.slice(2);
  const bootstrap = args.includes('--bootstrap-baseline');
  const update = args.includes('--update-baseline');
  const showAll = args.includes('--show-all');

  const { exceptions, errors: exceptionErrors } = loadExceptions();
  if (exceptionErrors.length > 0) {
    console.error(`❌ malformed ${relative(ROOT, EXCEPTIONS_PATH)}`);
    for (const error of exceptionErrors) {
      console.error(`      ${error}`);
    }
    process.exit(1);
  }

  const baselineResult = loadBaseline();
  if (!baselineResult.ok) {
    console.error(`❌ ${baselineResult.error}`);
    process.exit(1);
  }

  const { files, generatedExcluded } = scanSources();

  if (bootstrap) {
    runBootstrap({ files, exceptions });
    return;
  }
  if (update) {
    runUpdate({ files, exceptions, baseline: baselineResult.baseline });
    return;
  }
  runCheck({
    files,
    exceptions,
    baseline: baselineResult.baseline,
    generatedExcluded,
    showAll,
    baseRef: getBaseRef(args),
  });
};

if (import.meta.main) {
  main();
}
