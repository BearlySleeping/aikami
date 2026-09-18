// scripts/src/lib/ops/guard_type_safety.ts
//
// Ratchet guard on the type-safety escape hatches documented as forbidden in
// .pi/skills/aikami-conventions/SKILL.md's TypeScript Strictness table:
//
//   T1  `as unknown as X`  — use a parse/convert function or a type guard.
//   T2  `as any`           — use `unknown` + narrowing.
//   T3  the ts-ignore suppression directive — use `@ts-expect-error` WITH an
//       explanatory comment, or fix it.
//
// This is a RATCHET, not a hard-zero gate: hundreds of pre-existing violations
// make "green today" infeasible without weeks of rewrite work. Per-file counts
// live in guard_type_safety_baseline.json and may only go DOWN.
//
// 🔴 `--update-baseline` is REDUCTION-ONLY. It synchronizes improvements and
// removals; it does NOT regenerate the baseline from the current tree. Before
// the shared ratchet framework existed, this guard wrote the current state
// wholesale, which meant `add an `as any` → run --update-baseline` was a
// complete bypass of the guard. It now refuses to add or raise a single count.
//
// Violation identities (rule + snippet hash) are recorded alongside the counts
// so that replacing one violation with a different one — leaving the count
// unchanged — is still detected. That swap is refused by `--update-baseline`
// too: accepting it is a policy decision, not a fix.
//
// Scans apps/**, packages/**, scripts/**, .pi/** — .ts and .svelte files.
// Skips node_modules, .svelte-kit, build, dist, .git, generated-skills,
// .pi/git/, and .pi/workspaces/ (vendored third-party code and agent-local
// nested worktrees).
//
// T1/T2 are exempt in test files (*.test.ts, *.spec.ts, **/tests/**,
// **/__tests__/**, apps/e2e/**) — T3 applies everywhere. Matches inside
// line/block comments never count for T1/T2 (a `// ... as any ...` note must
// not trip the guard); T3 is the opposite — it only ever matches inside a
// comment, since the ts-ignore directive IS a comment.
//
// A T1/T2 violation on a line carrying a
// `// guard-ignore lint/type-safety/casting: <reason>` comment (trailing on
// the same line, or alone on the line directly above — mirrors Biome's own
// `// biome-ignore lint/<group>/<rule>: <reason>` convention) is excluded
// entirely. The reason after the colon is mandatory. This is a narrow escape
// hatch for casts that are genuinely unavoidable at a typed/untyped boundary —
// it is not a replacement for fixing the type, so use it sparingly and say why.
//
// Usage:
//   bun run src/lib/ops/guard_type_safety.ts
//   bun run src/lib/ops/guard_type_safety.ts --update-baseline   # reductions only
//   bun run src/lib/ops/guard_type_safety.ts --show-all
//   bun run src/lib/ops/guard_type_safety.ts --base-ref=origin/main
//
// Exits non-zero on any violation above its baseline, any improvement not yet
// locked in, any same-count identity swap, or any growth relative to an
// explicitly configured base revision. `--show-all` ignores the baseline
// entirely so every current violation prints. It never writes the baseline.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { isExcludedDir } from './guard_type_safety_helpers.ts';
import { type RatchetRuleSpec, type RatchetViolation, simpleHash } from './guards/ratchet.ts';
import { relativeToRoot } from './guards/ratchet_io.ts';
import { runRatchet } from './guards/ratchet_runner.ts';

// Root and baseline are overridable so tests can run the guard against an
// isolated fixture tree without touching the repository's real baseline.
const ROOT = resolve(process.env.AIKAMI_GUARD_ROOT ?? resolve(import.meta.dir, '../../../..'));
const SCAN_ROOTS = ['apps', 'packages', 'scripts', '.pi'].map((dir) => resolve(ROOT, dir));
const BASELINE_PATH = resolve(
  process.env.AIKAMI_GUARD_BASELINE ?? resolve(import.meta.dir, 'guard_type_safety_baseline.json'),
);
const BASELINE_REL_PATH =
  relativeToRoot(ROOT, BASELINE_PATH) ?? 'scripts/src/lib/ops/guard_type_safety_baseline.json';

type Rule = 't1' | 't2' | 't3';

export const RULES: readonly RatchetRuleSpec[] = [
  {
    id: 't1',
    label: 'T1 `as unknown as X`',
    remediation:
      'Parse the unknown value against its TypeBox schema, or write a type guard — do not assert through `unknown`.',
  },
  {
    id: 't2',
    label: 'T2 `as any`',
    remediation:
      'Replace with `unknown` + narrowing. The baseline cannot be expanded; a new `as any` is a new defect, not a new allowance.',
  },
  {
    id: 't3',
    label: 'T3 `@ts-ignore`',
    remediation:
      'Use `@ts-expect-error` with a one-line reason so the suppression fails loudly once the underlying type is fixed.',
  },
];

// ── File discovery ───────────────────────────────────────────────────────

const walk = (dir: string): string[] => {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    // 🔴 TOCTOU: entries that exist at readdirSync-time can vanish before
    // statSync runs — e.g. a running Chromium instance's
    // `.pi/.chromium-profile` lock/socket files, or any concurrent writer.
    // Skip rather than crash the whole guard on an ENOENT that has nothing to
    // do with the code being checked.
    let stats: ReturnType<typeof statSync>;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) {
      const relPath = relative(ROOT, full).split(sep).join('/');
      if (isExcludedDir({ name: entry, relPath })) {
        continue;
      }
      out.push(...walk(full));
    } else if (entry.endsWith('.ts') || entry.endsWith('.svelte')) {
      out.push(full);
    }
  }
  return out;
};

const isTestExempt = (relPath: string): boolean =>
  /\.(test|spec)\.ts$/.test(relPath) ||
  /(^|\/)(tests|__tests__)\//.test(relPath) ||
  relPath.startsWith('apps/e2e/');

// ── Comment/string stripping (for T1/T2 matching) ────────────────────────
//
// Blanks out comments and string/template literal contents, preserving
// newlines and overall length, so regex matches map back to the right line and
// never fire inside a comment or a string. Template-literal `${...}`
// interpolations are treated as part of the string (not re-entered as code) —
// a rare miss, acceptable for a ratchet guard.

const stripCommentsAndStrings = (source: string): string => {
  let result = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const c2 = source[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && source[i] !== '\n') {
        result += ' ';
        i++;
      }
      continue;
    }
    if (c === '/' && c2 === '*') {
      result += '  ';
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        result += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        result += '  ';
        i += 2;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      result += ' ';
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') {
          result += '  ';
          i += 2;
          continue;
        }
        result += source[i] === '\n' ? '\n' : ' ';
        i++;
      }
      if (i < n) {
        result += ' ';
        i++;
      }
      continue;
    }
    result += c;
    i++;
  }
  return result;
};

const lineOf = (source: string, index: number): number => {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (source[i] === '\n') {
      line++;
    }
  }
  return line;
};

const T1_PATTERN = /\bas\s+unknown\s+as\s+\S/g;
const T2_PATTERN = /\bas\s+any\b/g;
const T3_PATTERN = /(?:\/\/|\/\*)\s*@ts-ignore\b/g;
const GUARD_IGNORE_CASTING_PATTERN = /\/\/\s*guard-ignore\s+lint\/type-safety\/casting:\s*\S.*$/;

/**
 * Line numbers (1-indexed) carrying a valid
 * `guard-ignore lint/type-safety/casting: <reason>` comment, either trailing on
 * the line itself or alone on the line above.
 */
const findIgnoredCastingLines = (rawContent: string): Set<number> => {
  const ignored = new Set<number>();
  const lines = rawContent.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!GUARD_IGNORE_CASTING_PATTERN.test(line)) {
      continue;
    }
    const lineNo = i + 1;
    const beforeComment = line.slice(0, line.indexOf('//')).trim();
    if (beforeComment.length === 0) {
      // Standalone comment line — covers the cast on the line below it.
      ignored.add(lineNo + 1);
    } else {
      // Trailing comment on a code line — covers only that line.
      ignored.add(lineNo);
    }
  }
  return ignored;
};

/** The snippet used for the diagnostic — short, and never the identity. */
const snippetAt = (content: string, index: number): string =>
  content
    .slice(index, index + 40)
    .split('\n')[0]
    ?.trim() ?? '';

/**
 * The whole trimmed line carrying the violation.
 *
 * 🔴 This is the identity, not the 40-character snippet. A snippet starting at
 * the `as` token is nearly identical across casts, so keying identity off it
 * would make two different casts in the same shape look like the same
 * violation — the exact same-count replacement the identity exists to catch.
 * The line is the smallest unit that actually distinguishes them.
 */
const lineTextAt = (content: string, index: number): string => {
  const start = content.lastIndexOf('\n', index - 1) + 1;
  const end = content.indexOf('\n', index);
  return content.slice(start, end === -1 ? undefined : end).trim();
};

export const violationIdentity = (options: { rule: string; lineText: string }): string =>
  simpleHash(`${options.rule}:${options.lineText}`);

export const findViolations = (options: {
  rawContent: string;
  relPath: string;
}): RatchetViolation[] => {
  const { rawContent, relPath } = options;
  const violations: RatchetViolation[] = [];

  if (!isTestExempt(relPath)) {
    const ignoredLines = findIgnoredCastingLines(rawContent);
    const stripped = stripCommentsAndStrings(rawContent);
    for (const match of stripped.matchAll(T1_PATTERN)) {
      const line = lineOf(rawContent, match.index);
      if (ignoredLines.has(line)) {
        continue;
      }
      violations.push({
        file: relPath,
        rule: 't1',
        line,
        message: `T1 \`as unknown as X\`: ${snippetAt(rawContent, match.index)}`,
        identity: violationIdentity({ rule: 't1', lineText: lineTextAt(rawContent, match.index) }),
      });
    }
    for (const match of stripped.matchAll(T2_PATTERN)) {
      const line = lineOf(rawContent, match.index);
      if (ignoredLines.has(line)) {
        continue;
      }
      violations.push({
        file: relPath,
        rule: 't2',
        line,
        message: `T2 \`as any\`: ${snippetAt(rawContent, match.index)}`,
        identity: violationIdentity({ rule: 't2', lineText: lineTextAt(rawContent, match.index) }),
      });
    }
  }

  for (const match of rawContent.matchAll(T3_PATTERN)) {
    violations.push({
      file: relPath,
      rule: 't3',
      line: lineOf(rawContent, match.index),
      message: `T3 \`@ts-ignore\`: ${snippetAt(rawContent, match.index)}`,
      identity: violationIdentity({ rule: 't3', lineText: lineTextAt(rawContent, match.index) }),
    });
  }

  return violations;
};

// ── Entry point ──────────────────────────────────────────────────────────

const main = (): void => {
  const args = process.argv.slice(2);
  const violations: RatchetViolation[] = [];

  for (const root of SCAN_ROOTS) {
    for (const file of walk(root)) {
      const relPath = relative(ROOT, file).split(sep).join('/');
      violations.push(...findViolations({ rawContent: readFileSync(file, 'utf8'), relPath }));
    }
  }

  const totals = { t1: 0, t2: 0, t3: 0 };
  for (const violation of violations) {
    totals[violation.rule as Rule]++;
  }

  // A quick, non-failing hint when the only change is a swap. The runner
  // reports it as a failure with the standard vocabulary; this keeps the
  // remediation visible even in `--show-all`.
  if (args.includes('--show-all')) {
    console.log(
      `ℹ️  ${violations.length} current violation(s) — T1=${totals.t1} T2=${totals.t2} T3=${totals.t3} (baseline ignored)`,
    );
  }

  runRatchet({
    name: 'type-safety',
    root: ROOT,
    baselinePath: BASELINE_PATH,
    baselineRelPath: BASELINE_REL_PATH,
    rules: RULES,
    violations,
    hardFailures: 0,
    identityAware: true,
    args,
    summary: `T1=${totals.t1} T2=${totals.t2} T3=${totals.t3}`,
  });
};

if (import.meta.main) {
  main();
}
