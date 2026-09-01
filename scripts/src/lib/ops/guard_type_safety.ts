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
// Scans apps/**, packages/**, scripts/** — .ts and .svelte files. Skips
// node_modules, .svelte-kit, build, dist, and any directory whose name
// contains ".cache" (a stale apps/frontend/client/node_modules/.cache/
// svelte-check-rs/ tree — itself under node_modules and already excluded —
// is the specific offender that motivated this rule; the extra check is
// defense in depth for any future .cache tree outside node_modules).
//
// T1/T2 are exempt in test files (*.test.ts, *.spec.ts, **/tests/**,
// **/__tests__/**, apps/e2e/**) — T3 applies everywhere. Matches inside
// line/block comments never count for T1/T2 (a `// ... as any ...` note
// must not trip the guard); T3 is the opposite — it only ever matches
// inside a comment, since the ts-ignore directive IS a comment.
//
// Usage:
//   bun run scripts/src/lib/ops/guard_type_safety.ts
//   bun run scripts/src/lib/ops/guard_type_safety.ts --update-baseline
//
// Exits non-zero on any violation (exceeds baseline) or any unlocked
// improvement (below baseline).

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const ROOT = resolve(import.meta.dir, '../../../..');
const SCAN_ROOTS = ['apps', 'packages', 'scripts'].map((dir) => resolve(ROOT, dir));
const BASELINE_PATH = resolve(import.meta.dir, 'guard_type_safety_baseline.json');

const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.svelte-kit', 'build', 'dist', '.git']);

type Rule = 't1' | 't2' | 't3';
type RuleCounts = { t1: number; t2: number; t3: number };
type Baseline = Record<string, RuleCounts>;

type Violation = { rule: Rule; line: number; snippet: string };

const RULE_LABEL: Record<Rule, string> = {
  t1: 'T1 `as unknown as X`',
  t2: 'T2 `as any`',
  t3: 'T3 `@ts-ignore`',
};

// ── File discovery ───────────────────────────────────────────────────────

const isExcludedDir = (name: string): boolean =>
  EXCLUDED_DIR_NAMES.has(name) || name.includes('.cache');

const walk = (dir: string): string[] => {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (isExcludedDir(entry)) {
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

const findViolations = (options: { rawContent: string; relPath: string }): Violation[] => {
  const { rawContent, relPath } = options;
  const violations: Violation[] = [];

  if (!isTestExempt(relPath)) {
    const stripped = stripCommentsAndStrings(rawContent);
    for (const match of stripped.matchAll(T1_PATTERN)) {
      violations.push({
        rule: 't1',
        line: lineOf(rawContent, match.index),
        snippet: rawContent
          .slice(match.index, match.index + 40)
          .split('\n')[0]
          .trim(),
      });
    }
    for (const match of stripped.matchAll(T2_PATTERN)) {
      violations.push({
        rule: 't2',
        line: lineOf(rawContent, match.index),
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

// ── Main ─────────────────────────────────────────────────────────────────

const updateBaseline = Bun.argv.includes('--update-baseline');

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
    baseline[relPath] = countsOf(violations);
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

const baseline = loadBaseline();
const allPaths = new Set([...fileViolations.keys(), ...Object.keys(baseline)]);

let failed = false;
for (const relPath of [...allPaths].sort()) {
  const current = countsOf(fileViolations.get(relPath) ?? []);
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

  if (lines.length > 0) {
    console.error(`❌ ${relPath}`);
    for (const line of lines) {
      console.error(`      ${line}`);
    }
    for (const v of fileViolations.get(relPath) ?? []) {
      console.error(`        line ${v.line}: ${v.snippet}`);
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
