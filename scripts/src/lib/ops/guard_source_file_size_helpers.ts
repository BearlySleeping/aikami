// scripts/src/lib/ops/guard_source_file_size_helpers.ts
//
// Pure, dependency-free logic for guard_source_file_size.ts. Kept separate so
// the thresholds, line counting, file classification, and baseline/exception
// rules can be unit-tested without touching the repository's real source tree
// or baseline files.
//
// This is a size guard, not an architecture proof: a small file can still be
// badly designed. File size is only a proxy for "one cohesive responsibility",
// and the guard is deliberately a ratchet on existing debt plus a hard stop on
// brand-new oversized modules — not a mandate to split files cosmetically.

export type SourceKind = 'production' | 'test';

export type SizeBudget = {
  /** Advisory threshold; exceeding it prints a non-failing warning. */
  warn: number;
  /** Hard limit; a new file above it fails unless explicitly excepted. */
  hard: number;
};

/**
 * Starting policy. Production modules warning at 500 physical lines keeps
 * single-responsibility pressure on long before a file becomes unmaintainable;
 * the hard limit at 800 is where a new module must be justified. Tests carry a
 * higher budget because table-driven cases and fixtures are legitimately long.
 */
export const PRODUCTION_BUDGET: SizeBudget = { warn: 500, hard: 800 };
export const TEST_BUDGET: SizeBudget = { warn: 800, hard: 1500 };

export const budgetFor = (kind: SourceKind): SizeBudget =>
  kind === 'test' ? TEST_BUDGET : PRODUCTION_BUDGET;

/** A classified source file with its measured physical line count. */
export type ScannedFile = { path: string; lines: number; kind: SourceKind };

/** Source formats this guard covers — handwritten TS/JS and Svelte components. */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.svelte'];

export const isSourceFile = (name: string): boolean =>
  SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension));

/**
 * Counts physical lines: comments and blank lines included. CRLF/CR are
 * normalized to LF, and a single trailing newline does not create a phantom
 * final line (so `"a\n"` is one line, not two), matching how editors and
 * `git diff` present a file.
 */
export const countPhysicalLines = (content: string): number => {
  const normalized = content.replace(/\r\n?/g, '\n');
  if (normalized.length === 0) {
    return 0;
  }
  const withoutTrailingNewline = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  return withoutTrailingNewline.split('\n').length;
};

/**
 * Documented generated-artifact conventions. These are the repository's actual
 * markers — a SvelteKit/Vite declaration file, the vendored agent skills tree,
 * the generated static asset tree, an explicit `generated/` or `paraglide/`
 * directory, or a `_generated` / `.generated` filename suffix. A handwritten
 * file cannot casually claim one of these without renaming itself to look
 * generated (and the suffix is itself the documented contract).
 */
export const isGeneratedFile = (relPath: string): boolean =>
  relPath.endsWith('.d.ts') ||
  relPath.startsWith('.pi/generated-skills/') ||
  relPath.startsWith('apps/frontend/client/static/') ||
  /(^|\/)(generated|paraglide)\//.test(relPath) ||
  /(^|\/)[^/]*_generated\.[cm]?[jt]sx?$/.test(relPath) ||
  /(^|\/)[^/]*\.generated\.[cm]?[jt]sx?$/.test(relPath);

/** Test classification: unit/spec files, test directories, and the e2e suite. */
export const isTestFile = (relPath: string): boolean =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(relPath) ||
  /(^|\/)(__tests__|tests)\//.test(relPath) ||
  relPath.startsWith('apps/e2e/') ||
  /(^|\/)test_preload\.[cm]?[jt]s$/.test(relPath);

const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  '.svelte-kit',
  '.git',
  'generated-skills',
  'coverage',
  '.turbo',
  '.moon',
  '.vercel',
  '.wrangler',
  '.netlify',
  '.chromium-profile',
]);

const GENERATED_OUTPUT_DIR_NAMES = new Set(['build', 'dist', 'target', 'temp', 'tmp', 'vendor']);

const isProjectRoot = (relPath: string): boolean => {
  if (relPath === 'scripts') {
    return true;
  }
  const segments = relPath.split('/');
  return (
    (segments[0] === 'apps' &&
      ((segments.length === 2 && segments[1] === 'e2e') ||
        (segments.length === 3 && (segments[1] === 'backend' || segments[1] === 'frontend')))) ||
    (segments[0] === 'packages' &&
      segments.length === 3 &&
      (segments[1] === 'backend' || segments[1] === 'frontend' || segments[1] === 'shared'))
  );
};

const isGeneratedOutputRoot = (options: { name: string; relPath: string }): boolean => {
  if (!GENERATED_OUTPUT_DIR_NAMES.has(options.name)) {
    return false;
  }
  const parentPath = options.relPath.slice(0, -(options.name.length + 1));
  return (
    isProjectRoot(parentPath) ||
    (options.name === 'target' && parentPath === 'apps/frontend/client/src-tauri')
  );
};

/**
 * Dependency, build, cache, and vendored directories that are never project
 * source. `.pi/git` and `.pi/workspaces` are vendored/agent-local copies.
 */
export const isExcludedDir = (options: { name: string; relPath: string }): boolean => {
  const { name, relPath } = options;
  return (
    EXCLUDED_DIR_NAMES.has(name) ||
    isGeneratedOutputRoot(options) ||
    name.includes('.cache') ||
    relPath === '.pi/git' ||
    relPath === '.pi/workspaces' ||
    relPath.startsWith('.pi/workspaces/')
  );
};

// ── Exception records ────────────────────────────────────────────────────

export type ExceptionKind = 'declarative' | 'generated' | 'kernel' | 'fixture' | 'other';

export type SizeException = {
  maxLines: number;
  rationale: string;
  owner: string;
  kind: ExceptionKind;
  /** Tracking issue for temporary debt (e.g. `C-123`). */
  issue?: string;
  /** ISO date (YYYY-MM-DD) by which temporary debt must be re-reviewed. */
  reviewBy?: string;
};

export type ExceptionSet = Record<string, SizeException>;

const EXCEPTION_KINDS = new Set<ExceptionKind>([
  'declarative',
  'generated',
  'kernel',
  'fixture',
  'other',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * Validates the exceptions file. Malformed entries are reported as errors (and
 * fail the guard) rather than silently ignored — a typo in a path must not
 * grant an unearned allowance.
 */
export const validateExceptions = (
  raw: unknown,
): { exceptions: ExceptionSet; errors: string[] } => {
  const errors: string[] = [];
  const exceptions: ExceptionSet = {};
  if (raw === undefined) {
    return { exceptions, errors };
  }
  if (!isRecord(raw)) {
    return {
      exceptions,
      errors: ['exceptions file must be a JSON object keyed by repo-relative path'],
    };
  }

  for (const [path, value] of Object.entries(raw)) {
    if (path === '_comment' || path.startsWith('_')) {
      continue;
    }
    if (!isRecord(value)) {
      errors.push(`${path}: entry must be an object`);
      continue;
    }
    const { maxLines, rationale, owner, kind, issue, reviewBy } = value;
    if (typeof maxLines !== 'number' || !Number.isInteger(maxLines) || maxLines <= 0) {
      errors.push(`${path}: "maxLines" must be a positive integer`);
      continue;
    }
    if (typeof rationale !== 'string' || rationale.trim().length < 10) {
      errors.push(`${path}: "rationale" must be a non-empty explanation (≥10 chars)`);
      continue;
    }
    if (typeof owner !== 'string' || owner.trim().length === 0) {
      errors.push(`${path}: "owner" (review owner) is required`);
      continue;
    }
    if (typeof kind !== 'string' || !EXCEPTION_KINDS.has(kind as ExceptionKind)) {
      errors.push(`${path}: "kind" must be one of ${[...EXCEPTION_KINDS].join(', ')}`);
      continue;
    }
    if (issue !== undefined && (typeof issue !== 'string' || issue.trim().length === 0)) {
      errors.push(`${path}: "issue" must be a non-empty string when present`);
      continue;
    }
    if (reviewBy !== undefined && (typeof reviewBy !== 'string' || !isIsoDate(reviewBy))) {
      errors.push(`${path}: "reviewBy" must be an ISO date (YYYY-MM-DD) when present`);
      continue;
    }
    if (kind === 'other' && issue === undefined && reviewBy === undefined) {
      errors.push(`${path}: kind "other" is temporary debt and needs an "issue" or "reviewBy"`);
      continue;
    }
    exceptions[path] = {
      maxLines,
      rationale,
      owner,
      kind: kind as ExceptionKind,
      ...(typeof issue === 'string' ? { issue } : {}),
      ...(typeof reviewBy === 'string' ? { reviewBy } : {}),
    };
  }

  return { exceptions, errors };
};

// ── Baseline rules ───────────────────────────────────────────────────────

export type Baseline = Record<string, number>;

export type BaselineUpdateCheck = {
  ok: boolean;
  errors: string[];
};

/**
 * Ordinary `--update-baseline` may only shrink or remove existing allowances.
 * Adding a path (new debt) or raising a path's allowance is rejected; those
 * require a reviewed exception or a manual, reviewed baseline edit.
 */
export const validateBaselineReduction = (options: {
  previous: Baseline;
  next: Baseline;
}): BaselineUpdateCheck => {
  const errors: string[] = [];
  for (const [path, value] of Object.entries(options.next)) {
    const before = options.previous[path];
    if (before === undefined) {
      errors.push(
        `new baseline entry ${path} (${value} lines) — add a reviewed exception instead of growing the baseline`,
      );
    } else if (value > before) {
      errors.push(`${path} would grow from ${before} to ${value} lines`);
    }
  }
  return { ok: errors.length === 0, errors };
};

/**
 * Detects unauthorized baseline expansion against a trusted base revision.
 * Reductions and removals are allowed; any new path or larger value is not.
 */
export const findBaselineExpansion = (options: {
  trusted: Baseline;
  current: Baseline;
}): string[] => {
  const expansions: string[] = [];
  for (const [path, value] of Object.entries(options.current)) {
    const trustedValue = options.trusted[path];
    if (trustedValue === undefined) {
      expansions.push(`${path} (${value} lines) was added`);
    } else if (value > trustedValue) {
      expansions.push(`${path} grew from ${trustedValue} to ${value} lines`);
    }
  }
  return expansions;
};

// ── Per-file assessment ──────────────────────────────────────────────────

export type FileStatus = 'ok' | 'warning' | 'exception' | 'baselined' | 'reduction' | 'over-limit';

export type Assessment = {
  status: FileStatus;
  /** Baseline or exception ceiling, when one applies. */
  allowance?: number;
  /** Lines over the applicable limit, or saved by a reduction. */
  excess?: number;
  detail: string;
};

/**
 * Resolves a single file against its exception, baseline entry, and budget.
 * Exception > baseline > budget, and a baseline entry that shrank is a
 * `reduction` (a failure until locked in via `--update-baseline`).
 */
export const assessFile = (options: {
  kind: SourceKind;
  lines: number;
  baselineLines?: number;
  exception?: SizeException;
}): Assessment => {
  const { kind, lines, baselineLines, exception } = options;
  const budget = budgetFor(kind);

  if (exception) {
    if (lines > exception.maxLines) {
      return {
        status: 'over-limit',
        allowance: exception.maxLines,
        excess: lines - exception.maxLines,
        detail: `exceeds its reviewed exception ceiling (+${lines - exception.maxLines})`,
      };
    }
    return {
      status: 'exception',
      allowance: exception.maxLines,
      detail: 'within its reviewed exception ceiling',
    };
  }

  if (baselineLines !== undefined) {
    if (lines > baselineLines) {
      return {
        status: 'over-limit',
        allowance: baselineLines,
        excess: lines - baselineLines,
        detail: `grew past its grandfathered baseline (+${lines - baselineLines})`,
      };
    }
    if (lines < baselineLines) {
      return {
        status: 'reduction',
        allowance: baselineLines,
        excess: baselineLines - lines,
        detail: `shrank from its baseline — run --update-baseline to lock the reduction in (saved ${baselineLines - lines})`,
      };
    }
    return {
      status: 'baselined',
      allowance: baselineLines,
      detail: 'matches its grandfathered baseline',
    };
  }

  if (lines > budget.hard) {
    return {
      status: 'over-limit',
      allowance: budget.hard,
      excess: lines - budget.hard,
      detail: `new oversized module over the hard limit (+${lines - budget.hard})`,
    };
  }
  if (lines > budget.warn) {
    return {
      status: 'warning',
      allowance: budget.warn,
      excess: lines - budget.warn,
      detail: `over the warning threshold (+${lines - budget.warn})`,
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
    case 'exception':
      return 'exception';
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
