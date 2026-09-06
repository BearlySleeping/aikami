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
// This is a RATCHET, not a hard-zero gate: 317 pre-existing violations
// outside tests (642 including tests) make "green today" infeasible without
// weeks of rewrite work. Instead, per-file counts are captured in
// guard_type_safety_baseline.json and may only go DOWN from here — any file
// exceeding its baseline count fails, and any file whose count improved
// must run --update-baseline to lock the improvement in (a silent drop
// would let the count creep back up unnoticed later).
//
// C-476 AC-4: The baseline now also stores violation identities (rule +
// snippet hash) so same-count replacement is detected. If a file has the
// same number of violations but different violation content, the guard
// flags it as a change requiring --update-baseline.
//
// Scans apps/**, packages/**, scripts/**, .pi/** — .ts and .svelte files.
// Skips node_modules, .svelte-kit, build, dist, .git, generated-skills,
// and .pi/git/ (vendored third-party code).
//
// T1/T2 are exempt in test files (*.test.ts, *.spec.ts, **/tests/**,
// **/__tests__/**, apps/e2e/**) — T3 applies everywhere. Matches inside
// line/block comments never count for T1/T2 (a `// ... as any ...` note
// must not trip the guard); T3 is the opposite — it only ever matches
// inside a comment, since the ts-ignore directive IS a comment.
//
// A T1/T2 violation on a line carrying a
// `// guard-ignore lint/type-safety/casting: <reason>` comment (trailing on
// the same line, or alone on the line directly above — mirrors Biome's own
// `// biome-ignore lint/<group>/<rule>: <reason>` convention) is excluded
// entirely — it never counts toward the baseline and never prints. The
// reason after the colon is mandatory: a bare
// `guard-ignore lint/type-safety/casting:` with nothing after it does NOT
// suppress. This is an escape hatch for casts that are genuinely
// unavoidable at a typed/untyped boundary — it is not a replacement for
// fixing the type or writing a real guard, so use it sparingly and say why
// in the reason.
//
// Usage:
//   bun run scripts/src/lib/ops/guard_type_safety.ts
//   bun run scripts/src/lib/ops/guard_type_safety.ts --update-baseline
//   bun run scripts/src/lib/ops/guard_type_safety.ts --show-all
//
// Exits non-zero on any violation (exceeds baseline) or any unlocked
// improvement (below baseline). --show-all ignores the baseline entirely
// (as if it were empty) so every current violation in the repo prints,
// including ones already accepted into the baseline — useful for seeing
// the true state of the repo, not just what changed since the last commit.
// It never writes the baseline file.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { annotate } from './gha_annotate.ts';
import { identitiesMatch, isExcludedDir, simpleHash } from './guard_type_safety_helpers.ts';

const ROOT = resolve(import.meta.dir, '../../../..');
const SCAN_ROOTS = ['apps', 'packages', 'scripts', '.pi'].map((dir) => resolve(ROOT, dir));
const BASELINE_PATH = resolve(import.meta.dir, 'guard_type_safety_baseline.json');

// .pi/git/ is vendored third-party code; .pi/generated-skills/ is auto-generated.
// Both are excluded by the biome.json `!` rule and should not be in the guard either.

type Rule = 't1' | 't2' | 't3';
type RuleCounts = { t1: number; t2: number; t3: number };

/** A single violation identity for same-count replacement detection (C-476 AC-4). */
type ViolationIdentity = {
  rule: Rule;
  /** Short content hash of the violation snippet. */
  hash: string;
};

/**
 * Baseline entry. Stores both per-rule counts and an array of violation
 * identities for identity-aware comparison. The `identities` field is
 * optional for backward compatibility with pre-C-476 baselines.
 */
type BaselineEntry = RuleCounts & {
  identities?: ViolationIdentity[];
};

type Baseline = Record<string, BaselineEntry>;

type Violation = { rule: Rule; line: number; snippet: string };

const RULE_LABEL: Record<Rule, string> = {
  t1: 'T1 `as unknown as X`',
  t2: 'T2 `as any`',
  t3: 'T3 `@ts-ignore`',
};

// ── File discovery ───────────────────────────────────────────────────────

const walk = (dir: string): string[] => {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const stats = statSync(full);
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
// newlines and overall length, so regex matches map back to the right line
// and never fire inside a comment or a string. Template-literal `${...}`
// interpolations are treated as part of the string (not re-entered as
// code) — a rare miss, acceptable for a ratchet guard.

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

// Line numbers (1-indexed) carrying a valid
// `guard-ignore lint/type-safety/casting: <reason>` comment, either
// trailing on the line itself or alone on the line above.
const findIgnoredCastingLines = (rawContent: string): Set<number> => {
  const ignored = new Set<number>();
  const lines = rawContent.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
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

const findViolations = (options: { rawContent: string; relPath: string }): Violation[] => {
  const { rawContent, relPath } = options;
  const violations: Violation[] = [];

  if (!isTestExempt(relPath)) {
    const ignoredLines = findIgnoredCastingLines(rawContent);
    const stripped = stripCommentsAndStrings(rawContent);
    for (const match of stripped.matchAll(T1_PATTERN)) {
      const line = lineOf(rawContent, match.index);
      if (ignoredLines.has(line)) {
        continue;
      }
      violations.push({
        rule: 't1',
        line,
        snippet: rawContent
          .slice(match.index, match.index + 40)
          .split('\n')[0]
          .trim(),
      });
    }
    for (const match of stripped.matchAll(T2_PATTERN)) {
      const line = lineOf(rawContent, match.index);
      if (ignoredLines.has(line)) {
        continue;
      }
      violations.push({
        rule: 't2',
        line,
        snippet: rawContent
          .slice(match.index, match.index + 40)
          .split('\n')[0]
          .trim(),
      });
    }
  }

  for (const match of rawContent.matchAll(T3_PATTERN)) {
    violations.push({
      rule: 't3',
      line: lineOf(rawContent, match.index),
      snippet: rawContent
        .slice(match.index, match.index + 40)
        .split('\n')[0]
        .trim(),
    });
  }

  return violations;
};

// ── Baseline I/O ──────────────────────────────────────────────────────────

const loadBaseline = (): Baseline => {
  if (!existsSync(BASELINE_PATH)) {
    return {};
  }
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
};

const countsOf = (violations: Violation[]): RuleCounts => {
  const counts: RuleCounts = { t1: 0, t2: 0, t3: 0 };
  for (const v of violations) {
    counts[v.rule]++;
  }
  return counts;
};

/** Build a set of violation identities from the current violations. */
const identitiesOf = (violations: Violation[]): ViolationIdentity[] => {
  const identities = violations.map((v) => ({
    rule: v.rule,
    hash: simpleHash(v.snippet),
  }));
  // Sort for deterministic comparison
  identities.sort((a, b) => {
    if (a.rule !== b.rule) {
      return a.rule.localeCompare(b.rule);
    }
    return a.hash.localeCompare(b.hash);
  });
  return identities;
};

// ── Main ─────────────────────────────────────────────────────────────────

const updateBaseline = Bun.argv.includes('--update-baseline');
const showAll = Bun.argv.includes('--show-all');

const fileViolations = new Map<string, Violation[]>();
for (const root of SCAN_ROOTS) {
  for (const file of walk(root)) {
    const relPath = relative(ROOT, file).split(sep).join('/');
    const rawContent = readFileSync(file, 'utf8');
    const violations = findViolations({ rawContent, relPath });
    if (violations.length > 0) {
      fileViolations.set(relPath, violations);
    }
  }
}

if (updateBaseline) {
  const baseline: Baseline = {};
  for (const [relPath, violations] of [...fileViolations].sort(([a], [b]) => a.localeCompare(b))) {
    baseline[relPath] = {
      ...countsOf(violations),
      identities: identitiesOf(violations),
    };
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  const totals = Object.values(baseline).reduce(
    (acc, c) => ({ t1: acc.t1 + c.t1, t2: acc.t2 + c.t2, t3: acc.t3 + c.t3 }),
    { t1: 0, t2: 0, t3: 0 },
  );
  console.log(
    `✅ Baseline updated: ${Object.keys(baseline).length} file(s) — ` +
      `T1=${totals.t1} T2=${totals.t2} T3=${totals.t3}`,
  );
  process.exit(0);
}

const baseline = showAll ? {} : loadBaseline();
const allPaths = new Set([...fileViolations.keys(), ...Object.keys(baseline)]);

let failed = false;
for (const relPath of [...allPaths].sort()) {
  const currentViolations = fileViolations.get(relPath) ?? [];
  const current = countsOf(currentViolations);
  const expected = baseline[relPath] ?? { t1: 0, t2: 0, t3: 0 };
  const lines: string[] = [];

  for (const rule of ['t1', 't2', 't3'] as const) {
    if (current[rule] > expected[rule]) {
      failed = true;
      lines.push(
        `[${rule.toUpperCase()}] ${RULE_LABEL[rule]} — ${current[rule]} found, baseline allows ${expected[rule]}`,
      );
    } else if (current[rule] < expected[rule]) {
      failed = true;
      lines.push(
        `[${rule.toUpperCase()}] ${RULE_LABEL[rule]} — improved to ${current[rule]} (baseline ${expected[rule]}) — run --update-baseline to lock this in`,
      );
    }
  }

  // C-476 AC-4: Identity-aware comparison — detect same-count replacement
  if (
    lines.length === 0 &&
    current.t1 === expected.t1 &&
    current.t2 === expected.t2 &&
    current.t3 === expected.t3 &&
    expected.identities &&
    currentViolations.length > 0
  ) {
    const currentIdentities = identitiesOf(currentViolations);
    if (!identitiesMatch(currentIdentities, expected.identities)) {
      failed = true;
      lines.push(
        `[IDENTITY] Violation identity mismatch — same count but different violations. Run --update-baseline to accept the new set.`,
      );
    }
  }

  if (lines.length > 0) {
    console.error(`❌ ${relPath}`);
    for (const line of lines) {
      console.error(`      ${line}`);
    }
    for (const v of currentViolations) {
      console.error(`        line ${v.line}: ${v.snippet}`);
      annotate({
        file: relPath,
        line: v.line,
        message: `${RULE_LABEL[v.rule]}: ${v.snippet}`,
        title: 'type-safety guard',
      });
    }
  }
}

if (failed) {
  console.error('\n🔴 type-safety guard failed — see violations above');
  process.exit(1);
}

const totals = Object.values(baseline).reduce(
  (acc, c) => ({ t1: acc.t1 + c.t1, t2: acc.t2 + c.t2, t3: acc.t3 + c.t3 }),
  { t1: 0, t2: 0, t3: 0 },
);
console.log(
  `✅ type-safety guard passed — baseline holds at T1=${totals.t1} T2=${totals.t2} T3=${totals.t3}`,
);
