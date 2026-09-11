// scripts/src/lib/ops/__tests__/guard_source_file_size.test.ts
//
// Tests for the source-file-size guard: threshold boundaries, line counting,
// classification, and the baseline/exception ratchet. The pure logic is tested
// directly; the CLI modes are exercised against isolated fixture trees via the
// AIKAMI_GUARD_ROOT / AIKAMI_GUARD_BASELINE / AIKAMI_GUARD_EXCEPTIONS env
// overrides so the repository's real baseline is never touched.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  assessFile,
  budgetFor,
  countPhysicalLines,
  findBaselineExpansion,
  isExcludedDir,
  isGeneratedFile,
  isSourceFile,
  isTestFile,
  validateBaselineReduction,
  validateExceptions,
} from '../guard_source_file_size_helpers.ts';

const GUARD_PATH = resolve(import.meta.dir, '../guard_source_file_size.ts');
const tempRoots: string[] = [];

const createRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'aikami-size-guard-'));
  tempRoots.push(root);
  return root;
};

afterAll(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const writeSource = (root: string, relPath: string, lines: number, ending = '\n'): string => {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  if (lines === 0) {
    writeFileSync(full, '');
    return full;
  }
  const body = Array.from({ length: lines }, (_, index) => `line ${index + 1}`).join('\n');
  writeFileSync(full, `${body}${ending}`);
  return full;
};

const writeBaselineFile = (root: string, baseline: Record<string, number>): string => {
  const path = join(root, 'baseline.json');
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
  return path;
};

type GuardRun = { status: number | null; stdout: string; stderr: string };

const runGuard = (options: {
  root: string;
  args?: string[];
  baselinePath?: string;
  exceptions?: unknown;
  baseRef?: string;
}): GuardRun => {
  const baselinePath = options.baselinePath ?? join(options.root, 'baseline.json');
  const exceptionsPath = join(options.root, 'exceptions.json');
  if (options.exceptions !== undefined) {
    writeFileSync(exceptionsPath, `${JSON.stringify(options.exceptions, null, 2)}\n`);
  }
  const env = {
    ...process.env,
    AIKAMI_GUARD_ROOT: options.root,
    AIKAMI_GUARD_BASELINE: baselinePath,
    AIKAMI_GUARD_EXCEPTIONS: exceptionsPath,
    AIKAMI_GUARD_BASE_REF: options.baseRef ?? '',
    BASE_REF: '',
  };
  const result = spawnSync('bun', ['run', GUARD_PATH, ...(options.args ?? [])], {
    env,
    encoding: 'utf8',
  });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
};

const git = (root: string, args: string[]): void => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} exited with status ${result.status}`);
  }
};

const readBaseline = (root: string): Record<string, number> =>
  JSON.parse(readFileSync(join(root, 'baseline.json'), 'utf8')) as Record<string, number>;

// ── Pure logic ───────────────────────────────────────────────────────────

describe('countPhysicalLines', () => {
  test('counts an empty file as zero lines', () => {
    expect(countPhysicalLines('')).toBe(0);
  });

  test('does not add a phantom line for a trailing newline', () => {
    expect(countPhysicalLines('a')).toBe(1);
    expect(countPhysicalLines('a\n')).toBe(1);
    expect(countPhysicalLines('a\nb\n')).toBe(2);
  });

  test('normalizes CRLF and lone CR', () => {
    expect(countPhysicalLines('a\r\nb\r\n')).toBe(2);
    expect(countPhysicalLines('a\rb')).toBe(2);
  });

  test('counts a lone newline as one blank line', () => {
    expect(countPhysicalLines('\n')).toBe(1);
  });
});

describe('budgets and thresholds', () => {
  test('uses the documented production and test budgets', () => {
    expect(budgetFor('production')).toEqual({ warn: 500, hard: 800 });
    expect(budgetFor('test')).toEqual({ warn: 800, hard: 1500 });
  });

  test('production boundary is exact', () => {
    expect(assessFile({ kind: 'production', lines: 500 }).status).toBe('ok');
    expect(assessFile({ kind: 'production', lines: 501 }).status).toBe('warning');
    expect(assessFile({ kind: 'production', lines: 800 }).status).toBe('warning');
    expect(assessFile({ kind: 'production', lines: 801 }).status).toBe('over-limit');
  });

  test('test boundary is exact', () => {
    expect(assessFile({ kind: 'test', lines: 800 }).status).toBe('ok');
    expect(assessFile({ kind: 'test', lines: 801 }).status).toBe('warning');
    expect(assessFile({ kind: 'test', lines: 1500 }).status).toBe('warning');
    expect(assessFile({ kind: 'test', lines: 1501 }).status).toBe('over-limit');
  });

  test('baseline allows equality, fails growth, and requires reductions to be locked', () => {
    expect(assessFile({ kind: 'production', lines: 900, baselineLines: 900 }).status).toBe(
      'baselined',
    );
    expect(assessFile({ kind: 'production', lines: 901, baselineLines: 900 }).status).toBe(
      'over-limit',
    );
    expect(assessFile({ kind: 'production', lines: 850, baselineLines: 900 }).status).toBe(
      'reduction',
    );
  });

  test('exception ceiling takes precedence over the baseline', () => {
    const exception = {
      maxLines: 1000,
      rationale: 'cohesive declarative table',
      owner: '@aikami/platform',
      kind: 'declarative' as const,
    };
    expect(assessFile({ kind: 'production', lines: 1000, exception }).status).toBe('exception');
    expect(assessFile({ kind: 'production', lines: 1001, exception }).status).toBe('over-limit');
  });
});

describe('classification and exclusions', () => {
  test('recognizes source formats', () => {
    for (const name of ['a.ts', 'a.tsx', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs', 'a.svelte']) {
      expect(isSourceFile(name)).toBe(true);
    }
    expect(isSourceFile('a.json')).toBe(false);
    expect(isSourceFile('a.md')).toBe(false);
  });

  test('recognizes generated conventions', () => {
    expect(isGeneratedFile('apps/x/src/env.d.ts')).toBe(true);
    expect(isGeneratedFile('.pi/generated-skills/foo/bar.ts')).toBe(true);
    expect(isGeneratedFile('packages/x/src/generated/catalog.ts')).toBe(true);
    expect(isGeneratedFile('packages/x/src/paraglide/messages.js')).toBe(true);
    expect(isGeneratedFile('apps/x/src/lpc_asset_catalog_generated.ts')).toBe(true);
    expect(isGeneratedFile('apps/x/src/catalog.generated.ts')).toBe(true);
    expect(isGeneratedFile('apps/frontend/client/static/content.js')).toBe(true);
    expect(isGeneratedFile('apps/x/src/foo.ts')).toBe(false);
  });

  test('recognizes tests', () => {
    expect(isTestFile('apps/x/src/foo.test.ts')).toBe(true);
    expect(isTestFile('apps/x/src/foo.spec.ts')).toBe(true);
    expect(isTestFile('packages/x/src/__tests__/foo.ts')).toBe(true);
    expect(isTestFile('packages/x/tests/foo.ts')).toBe(true);
    expect(isTestFile('apps/e2e/specs/foo.ts')).toBe(true);
    expect(isTestFile('apps/frontend/client/src/lib/test_preload.ts')).toBe(true);
    expect(isTestFile('apps/x/src/foo.ts')).toBe(false);
  });

  test('excludes dependencies and only known generated-output roots', () => {
    expect(isExcludedDir({ name: 'node_modules', relPath: 'apps/x/node_modules' })).toBe(true);
    for (const name of ['build', 'dist', 'target', 'temp', 'tmp', 'vendor']) {
      expect(isExcludedDir({ name, relPath: `apps/frontend/x/${name}` })).toBe(true);
      expect(isExcludedDir({ name, relPath: `apps/frontend/x/src/${name}` })).toBe(false);
    }
    expect(isExcludedDir({ name: 'dist', relPath: 'scripts/dist' })).toBe(true);
    expect(
      isExcludedDir({ name: 'target', relPath: 'apps/frontend/client/src-tauri/target' }),
    ).toBe(true);
    expect(isExcludedDir({ name: '.svelte-kit', relPath: 'apps/x/.svelte-kit' })).toBe(true);
    expect(isExcludedDir({ name: 'git', relPath: '.pi/git' })).toBe(true);
    expect(isExcludedDir({ name: 'workspaces', relPath: '.pi/workspaces' })).toBe(true);
    expect(isExcludedDir({ name: 'dist', relPath: 'scripts/src/lib/dist' })).toBe(false);
    expect(isExcludedDir({ name: 'vendor', relPath: 'apps/x/src/views/vendor' })).toBe(false);
    expect(isExcludedDir({ name: 'src', relPath: 'apps/x/src' })).toBe(false);
  });
});

describe('baseline rules', () => {
  test('allows reductions and removals', () => {
    expect(
      validateBaselineReduction({ previous: { 'a.ts': 900, 'b.ts': 900 }, next: { 'a.ts': 850 } })
        .ok,
    ).toBe(true);
  });

  test('rejects new debt', () => {
    const result = validateBaselineReduction({ previous: {}, next: { 'a.ts': 900 } });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('add a reviewed exception');
  });

  test('rejects increased allowances', () => {
    const result = validateBaselineReduction({ previous: { 'a.ts': 900 }, next: { 'a.ts': 950 } });
    expect(result.ok).toBe(false);
  });

  test('detects unauthorized expansion against a trusted revision', () => {
    const expansions = findBaselineExpansion({
      trusted: { 'a.ts': 900, 'b.ts': 900 },
      current: { 'a.ts': 950, 'c.ts': 900 },
    });
    expect(expansions).toHaveLength(2);
    expect(expansions.join('\n')).toContain('a.ts');
    expect(expansions.join('\n')).toContain('c.ts');
  });

  test('permits reductions and removals against a trusted revision', () => {
    expect(
      findBaselineExpansion({ trusted: { 'a.ts': 900, 'b.ts': 900 }, current: { 'a.ts': 800 } }),
    ).toEqual([]);
  });
});

describe('exception validation', () => {
  test('accepts a well-formed exception and ignores comments', () => {
    const { exceptions, errors } = validateExceptions({
      _comment: 'docs',
      'apps/x/src/foo.ts': {
        maxLines: 1200,
        rationale: 'cohesive declarative table used as one lookup',
        owner: '@aikami/platform',
        kind: 'declarative',
      },
    });
    expect(errors).toEqual([]);
    expect(exceptions['apps/x/src/foo.ts']?.maxLines).toBe(1200);
  });

  test('accepts temporary debt with a tracking issue', () => {
    const { errors } = validateExceptions({
      'apps/x/src/foo.ts': {
        maxLines: 1200,
        rationale: 'temporary split pending a follow-up contract',
        owner: '@aikami/platform',
        kind: 'other',
        issue: 'C-999',
      },
    });
    expect(errors).toEqual([]);
  });

  test('rejects malformed entries', () => {
    const cases: unknown[] = [
      {
        'a.ts': {
          maxLines: 'lots',
          rationale: 'long enough rationale',
          owner: '@x',
          kind: 'declarative',
        },
      },
      { 'a.ts': { maxLines: 900, rationale: 'short', owner: '@x', kind: 'declarative' } },
      {
        'a.ts': {
          maxLines: 900,
          rationale: 'long enough rationale',
          owner: '',
          kind: 'declarative',
        },
      },
      { 'a.ts': { maxLines: 900, rationale: 'long enough rationale', owner: '@x', kind: 'nope' } },
      { 'a.ts': { maxLines: 900, rationale: 'long enough rationale', owner: '@x', kind: 'other' } },
      {
        'a.ts': {
          maxLines: 900,
          rationale: 'long enough rationale',
          owner: '@x',
          kind: 'other',
          reviewBy: 'soon',
        },
      },
    ];
    for (const raw of cases) {
      const { errors } = validateExceptions(raw);
      expect(errors.length).toBeGreaterThan(0);
    }
  });
});

// ── CLI modes against isolated fixtures ──────────────────────────────────

describe('guard CLI — thresholds', () => {
  test('a new file over the hard limit fails with a path diagnostic', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/foo.ts', 801);
    const run = runGuard({ root });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('apps/src/foo.ts:1 [size]');
  });

  test('a warning is non-failing and actionable', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/warn.ts', 501);
    const run = runGuard({ root });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('⚠️');
    expect(run.stdout).toContain('apps/src/warn.ts');
  });

  test('a test file is allowed a higher budget', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/big.test.ts', 1500);
    expect(runGuard({ root }).status).toBe(0);
    writeSource(root, 'apps/src/big.test.ts', 1501);
    expect(runGuard({ root }).status).toBe(1);
  });

  test('svelte and tsx components are covered', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/component.svelte', 801);
    writeSource(root, 'apps/src/component.tsx', 801);
    const run = runGuard({ root });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('component.svelte');
    expect(run.stderr).toContain('component.tsx');
  });
});

describe('guard CLI — ratchet', () => {
  test('an unchanged grandfathered file passes', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/foo.ts', 900);
    const baselinePath = writeBaselineFile(root, { 'apps/src/foo.ts': 900 });
    expect(runGuard({ root, baselinePath }).status).toBe(0);
  });

  test('baseline growth fails', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/foo.ts', 901);
    const baselinePath = writeBaselineFile(root, { 'apps/src/foo.ts': 900 });
    const run = runGuard({ root, baselinePath });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('grew past its grandfathered baseline');
  });

  test('a reduction must be locked in', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/foo.ts', 850);
    const baselinePath = writeBaselineFile(root, { 'apps/src/foo.ts': 900 });
    const run = runGuard({ root, baselinePath });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('--update-baseline');

    const update = runGuard({ root, args: ['--update-baseline'], baselinePath });
    expect(update.status).toBe(0);
    expect(readBaseline(root)['apps/src/foo.ts']).toBe(850);
    expect(runGuard({ root, baselinePath }).status).toBe(0);
  });

  test('ordinary update refuses to add new debt', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/foo.ts', 900);
    writeBaselineFile(root, {});
    const run = runGuard({ root, args: ['--update-baseline'] });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('add a reviewed exception');
  });
});

describe('guard CLI — bootstrap', () => {
  test('bootstrap records over-limit files once', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/foo.ts', 900);
    writeSource(root, 'apps/src/small.ts', 10);
    const run = runGuard({ root, args: ['--bootstrap-baseline'] });
    expect(run.status).toBe(0);
    expect(readBaseline(root)).toEqual({ 'apps/src/foo.ts': 900 });
  });

  test('bootstrap refuses to overwrite an existing baseline', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/foo.ts', 900);
    writeBaselineFile(root, { 'apps/src/foo.ts': 900 });
    const run = runGuard({ root, args: ['--bootstrap-baseline'] });
    expect(run.status).toBe(1);
  });
});

describe('guard CLI — rename and deletion', () => {
  test('a rename cannot bypass the baseline', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/new_name.ts', 900);
    writeBaselineFile(root, { 'apps/src/old_name.ts': 900 });
    const run = runGuard({ root });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('new_name.ts:1 [size]');
    expect(run.stderr).toContain('no longer resolves');
    expect(runGuard({ root, args: ['--update-baseline'] }).status).toBe(1);
  });

  test('a deleted baselined file must be removed from the baseline', () => {
    const root = createRoot();
    writeBaselineFile(root, { 'apps/src/gone.ts': 900 });
    expect(runGuard({ root }).status).toBe(1);
    const update = runGuard({ root, args: ['--update-baseline'] });
    expect(update.status).toBe(0);
    expect(readBaseline(root)).toEqual({});
  });
});

describe('guard CLI — trusted base revision', () => {
  test('rejects unauthorized baseline expansion against the trusted base revision', () => {
    const root = createRoot();
    const baselinePath = join(root, 'scripts', 'src', 'lib', 'ops', 'baseline.json');
    mkdirSync(dirname(baselinePath), { recursive: true });
    writeSource(root, 'apps/src/big.ts', 950);
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@test.invalid']);
    git(root, ['config', 'user.name', 'Test']);
    writeFileSync(baselinePath, `${JSON.stringify({ 'apps/src/big.ts': 900 }, null, 2)}\n`);
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'trusted baseline']);
    writeFileSync(baselinePath, `${JSON.stringify({ 'apps/src/big.ts': 950 }, null, 2)}\n`);

    const run = runGuard({ root, baselinePath, baseRef: 'HEAD' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('unauthorized baseline expansion');
  });

  test('fails closed when an explicit base revision cannot be read', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/fine.ts', 10);

    const run = runGuard({ root, baseRef: 'missing-ref' });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('base-revision baseline check skipped (missing-ref)');
    expect(run.stderr).toContain('could not verify the baseline against explicit base revision');
  });
});

describe('guard CLI — exceptions', () => {
  test('a valid exception lifts the hard limit up to its ceiling', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/table.ts', 1000);
    const exceptions = {
      'apps/src/table.ts': {
        maxLines: 1200,
        rationale: 'cohesive declarative table used as a single lookup',
        owner: '@aikami/platform',
        kind: 'declarative',
      },
    };
    expect(runGuard({ root, exceptions }).status).toBe(0);
    writeSource(root, 'apps/src/table.ts', 1300);
    const over = runGuard({ root, exceptions });
    expect(over.status).toBe(1);
    expect(over.stderr).toContain('reviewed exception ceiling');
  });

  test('malformed exceptions fail the guard', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/foo.ts', 900);
    const run = runGuard({
      root,
      exceptions: { 'apps/src/foo.ts': { maxLines: 900, kind: 'declarative' } },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('malformed');
  });

  test('obsolete exceptions are flagged', () => {
    const root = createRoot();
    const exceptions = {
      'apps/src/missing.ts': {
        maxLines: 900,
        rationale: 'cohesive declarative table used as a single lookup',
        owner: '@aikami/platform',
        kind: 'declarative',
      },
    };
    const run = runGuard({ root, exceptions });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('obsolete exception');
  });
});

describe('guard CLI — exclusions and determinism', () => {
  test('generated, build, and dependency files are not scanned', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/foo/node_modules/dep.ts', 3000);
    writeSource(root, 'apps/frontend/example/build/out.ts', 3000);
    writeSource(root, 'apps/src/.cache/tmp.ts', 3000);
    writeSource(root, 'apps/src/bundle_generated.ts', 3000);
    writeSource(root, 'apps/src/paraglide/messages.ts', 3000);
    writeSource(root, 'apps/src/fine.ts', 10);
    expect(runGuard({ root }).status).toBe(0);
  });

  test('source directories with output-like names are scanned and shown', () => {
    const root = createRoot();
    writeSource(root, 'scripts/src/lib/dist/source.ts', 501);
    writeSource(root, 'apps/example/src/views/vendor/source.ts', 501);

    const run = runGuard({ root, args: ['--show-all'] });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('scripts/src/lib/dist/source.ts');
    expect(run.stdout).toContain('apps/example/src/views/vendor/source.ts');
  });

  test('show-all output is deterministic', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/a.ts', 600);
    writeSource(root, 'apps/src/b.ts', 900);
    const baselinePath = writeBaselineFile(root, { 'apps/src/b.ts': 900 });
    const first = runGuard({ root, baselinePath, args: ['--show-all'] });
    const second = runGuard({ root, baselinePath, args: ['--show-all'] });
    expect(first.stdout).toBe(second.stdout);
    expect(first.stdout).toContain('Source file size report');
  });
});
