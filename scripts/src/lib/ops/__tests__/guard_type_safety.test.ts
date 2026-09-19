// scripts/src/lib/ops/__tests__/guard_type_safety.test.ts
//
// Tests for the type-safety guard: file selection, the identity-aware
// comparison that catches same-count replacement, and — most importantly — that
// the guard's own CLI refuses to bless new debt.

import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { findViolations } from '../guard_type_safety.ts';
import { identitiesMatch, isExcludedDir, simpleHash } from '../guard_type_safety_helpers.ts';

describe('isExcludedDir', () => {
  test('excludes the vendored .pi/git directory', () => {
    expect(isExcludedDir({ name: 'git', relPath: '.pi/git' })).toBe(true);
  });

  test('includes unrelated directories named git', () => {
    expect(isExcludedDir({ name: 'git', relPath: 'packages/example/git' })).toBe(false);
  });

  test('excludes local agent worktrees under .pi/workspaces', () => {
    expect(isExcludedDir({ name: 'workspaces', relPath: '.pi/workspaces' })).toBe(true);
    expect(
      isExcludedDir({
        name: 'visual-asset-foundation-pr1',
        relPath: '.pi/workspaces/visual-asset-foundation-pr1',
      }),
    ).toBe(true);
  });

  test('includes an unrelated workspaces directory', () => {
    expect(isExcludedDir({ name: 'workspaces', relPath: 'packages/example/workspaces' })).toBe(
      false,
    );
  });
});

describe('simpleHash', () => {
  test('produces consistent output for the same input', () => {
    expect(simpleHash('as any) as T;')).toBe(simpleHash('as any) as T;'));
  });

  test('produces different output for different input', () => {
    expect(simpleHash('as any) as T;')).not.toBe(simpleHash('as any) as unknown;'));
  });

  test('produces an 8-character hex string', () => {
    expect(simpleHash('as unknown as string')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('identitiesMatch', () => {
  test('matches identical identity sets', () => {
    expect(identitiesMatch(['t2:aaaa'], ['t2:aaaa'])).toBe(true);
  });

  test('rejects a same-count replacement', () => {
    expect(identitiesMatch(['t2:bbbb'], ['t2:aaaa'])).toBe(false);
  });

  test('rejects a different rule at the same count', () => {
    expect(identitiesMatch(['t1:aaaa'], ['t2:aaaa'])).toBe(false);
  });

  test('rejects different lengths', () => {
    expect(identitiesMatch(['t2:aaaa'], ['t2:aaaa', 't2:bbbb'])).toBe(false);
  });

  test('matches empty sets', () => {
    expect(identitiesMatch([], [])).toBe(true);
  });

  test('is permissive when one side has no identity tracking', () => {
    expect(identitiesMatch(undefined, ['t2:aaaa'])).toBe(true);
    expect(identitiesMatch(['t2:aaaa'], undefined)).toBe(true);
  });
});

// The directive is assembled from parts on purpose: this file is inside the
// guard's own scan tree, and T3 applies in test files too, so a literal
// occurrence here would register as a real violation.
const TS_IGNORE_DIRECTIVE = `// @ts-${'ignore'}`;

describe('findViolations', () => {
  test('counts T1, T2 and T3 with stable identities', () => {
    const violations = findViolations({
      relPath: 'apps/x/src/foo.ts',
      rawContent: `const a = b as unknown as Foo;\nconst c = d as any;\n${TS_IGNORE_DIRECTIVE}\n`,
    });
    expect(violations.map((violation) => violation.rule).sort()).toEqual(['t1', 't2', 't3']);
    expect(violations.every((violation) => typeof violation.identity === 'string')).toBe(true);
  });

  test('never fires inside a comment or a string', () => {
    const violations = findViolations({
      relPath: 'apps/x/src/foo.ts',
      rawContent: '// const a = b as any;\nconst s = "as any";\n/* as unknown as Foo */\n',
    });
    expect(violations).toEqual([]);
  });

  test('exempts T1/T2 in test files but still counts T3', () => {
    const violations = findViolations({
      relPath: 'apps/x/src/foo.test.ts',
      rawContent: `const a = b as any;\n${TS_IGNORE_DIRECTIVE}\n`,
    });
    expect(violations.map((violation) => violation.rule)).toEqual(['t3']);
  });

  test('a reasoned guard-ignore comment suppresses the cast on its line', () => {
    const trailing = findViolations({
      relPath: 'apps/x/src/foo.ts',
      rawContent: 'const a = b as any; // guard-ignore lint/type-safety/casting: boundary\n',
    });
    expect(trailing).toEqual([]);

    const above = findViolations({
      relPath: 'apps/x/src/foo.ts',
      rawContent: '// guard-ignore lint/type-safety/casting: boundary\nconst a = b as any;\n',
    });
    expect(above).toEqual([]);
  });

  test('a bare guard-ignore comment without a reason does not suppress', () => {
    const violations = findViolations({
      relPath: 'apps/x/src/foo.ts',
      rawContent: 'const a = b as any; // guard-ignore lint/type-safety/casting:\n',
    });
    expect(violations.map((violation) => violation.rule)).toEqual(['t2']);
  });

  test('identities differ when the cast changes at the same count', () => {
    const before = findViolations({
      relPath: 'apps/x/src/foo.ts',
      rawContent: 'const a = b as any;\n',
    });
    const after = findViolations({
      relPath: 'apps/x/src/foo.ts',
      rawContent: 'const a = other as any;\n',
    });
    expect(before[0]?.identity).not.toBe(after[0]?.identity);
  });
});

// ── CLI: reduction-only baseline ─────────────────────────────────────────

const GUARD_PATH = resolve(import.meta.dir, '../guard_type_safety.ts');
const tempRoots: string[] = [];

const createRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'aikami-type-safety-'));
  tempRoots.push(root);
  return root;
};

const writeFile = (root: string, relPath: string, content: string): void => {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
};

type GuardRun = { status: number | null; stdout: string; stderr: string };

const runGuard = (options: {
  root: string;
  args?: string[];
  baseline?: unknown;
  baseRef?: string;
}): GuardRun => {
  const baselinePath = join(options.root, 'baseline.json');
  if (options.baseline !== undefined) {
    writeFileSync(baselinePath, `${JSON.stringify(options.baseline, null, 2)}\n`);
  }
  const result = spawnSync('bun', ['run', GUARD_PATH, ...(options.args ?? [])], {
    env: {
      ...process.env,
      AIKAMI_GUARD_ROOT: options.root,
      AIKAMI_GUARD_BASELINE: baselinePath,
      AIKAMI_GUARD_BASE_REF: options.baseRef ?? '',
      AIKAMI_GUARD_POLICY_AUTHORIZATION: '',
      BASE_REF: '',
    },
    encoding: 'utf8',
  });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

const readBaseline = (root: string): Record<string, { counts: Record<string, number> }> =>
  JSON.parse(readFileSync(join(root, 'baseline.json'), 'utf8'));

describe('guard CLI — reduction-only baseline', () => {
  // The baseline is produced by the guard's own one-time bootstrap rather than
  // by hard-coding hashes here: that exercises the real path an operator takes
  // and keeps the identity scheme out of the test.

  const bootstrap = (root: string): GuardRun =>
    runGuard({ root, args: ['--bootstrap-baseline'], baseline: undefined });

  test('bootstrap refuses to run twice', () => {
    const root = createRoot();
    writeFile(root, 'apps/x/src/foo.ts', 'const a = b as any;\n');
    expect(bootstrap(root).status).toBe(0);
    expect(bootstrap(root).status).toBe(1);
  });

  test('an unchanged tree passes against the bootstrapped baseline', () => {
    const root = createRoot();
    writeFile(root, 'apps/x/src/foo.ts', 'const a = b as any;\n');
    expect(bootstrap(root).status).toBe(0);
    expect(runGuard({ root }).status).toBe(0);
  });

  test('--update-baseline REFUSES to bless a new `as any`', () => {
    const root = createRoot();
    writeFile(root, 'apps/x/src/foo.ts', 'const clean = 1;\n');
    expect(bootstrap(root).status).toBe(0);

    writeFile(root, 'apps/x/src/foo.ts', 'const clean = 1;\nconst a = b as any;\n');
    const run = runGuard({ root, args: ['--update-baseline'] });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('refusing --update-baseline');
    // The baseline on disk is untouched.
    expect(Object.keys(readBaseline(root))).toEqual([]);
  });

  test('--update-baseline REFUSES to raise an existing count', () => {
    const root = createRoot();
    writeFile(root, 'apps/x/src/foo.ts', 'const a = b as any;\n');
    expect(bootstrap(root).status).toBe(0);

    writeFile(root, 'apps/x/src/foo.ts', 'const a = b as any;\nconst c = d as any;\n');
    const run = runGuard({ root, args: ['--update-baseline'] });
    expect(run.status).toBe(1);
    expect(readBaseline(root)['apps/x/src/foo.ts']?.counts.t2).toBe(1);
  });

  test('--update-baseline REFUSES a same-count identity swap', () => {
    const root = createRoot();
    writeFile(root, 'apps/x/src/foo.ts', 'const a = firstTarget as any;\n');
    expect(bootstrap(root).status).toBe(0);

    // Same rule, same count, different cast.
    writeFile(root, 'apps/x/src/foo.ts', 'const a = secondTarget as any;\n');
    const run = runGuard({ root, args: ['--update-baseline'] });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('different violations');
  });

  test('a same-count identity swap is reported by the check', () => {
    const root = createRoot();
    writeFile(root, 'apps/x/src/foo.ts', 'const a = firstTarget as any;\n');
    expect(bootstrap(root).status).toBe(0);
    writeFile(root, 'apps/x/src/foo.ts', 'const a = secondTarget as any;\n');
    const run = runGuard({ root });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('different violations');
  });

  test('--update-baseline locks in a reduction', () => {
    const root = createRoot();
    writeFile(root, 'apps/x/src/foo.ts', 'const a = b as any;\nconst c = d as any;\n');
    expect(bootstrap(root).status).toBe(0);

    writeFile(root, 'apps/x/src/foo.ts', 'const a = b as any;\n');
    const run = runGuard({ root, args: ['--update-baseline'] });
    expect(run.status).toBe(0);
    expect(readBaseline(root)['apps/x/src/foo.ts']?.counts.t2).toBe(1);
  });

  test('an unlocked reduction fails until it is locked in', () => {
    const root = createRoot();
    writeFile(root, 'apps/x/src/foo.ts', 'const a = b as any;\nconst c = d as any;\n');
    expect(bootstrap(root).status).toBe(0);
    writeFile(root, 'apps/x/src/foo.ts', 'const a = b as any;\n');
    const run = runGuard({ root });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('sanctioned validation flow');
  });

  test('--show-all ignores the baseline and never writes it', () => {
    const root = createRoot();
    writeFile(root, 'apps/x/src/foo.ts', 'const a = b as any;\n');
    expect(bootstrap(root).status).toBe(0);
    const before = readBaseline(root);
    const run = runGuard({ root, args: ['--show-all'] });
    expect(run.stdout).toContain('baseline ignored');
    expect(readBaseline(root)).toEqual(before);
  });

  test('fails closed when an explicit base revision cannot be read', () => {
    const root = createRoot();
    writeFile(root, 'apps/x/src/foo.ts', 'const fine = 1;\n');
    const run = runGuard({ root, baseline: {}, baseRef: 'missing-ref' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('fails closed');
  });
});
