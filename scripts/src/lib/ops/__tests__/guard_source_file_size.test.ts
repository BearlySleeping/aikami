// scripts/src/lib/ops/__tests__/guard_source_file_size.test.ts
//
// CLI tests for the source-file-size guard: thresholds, the reduction-only
// baseline ratchet, the permanent-exemption / temporary-waiver split, waiver
// expiry, ceiling growth, and the trusted-base effective-allowance check that
// closes the baseline→waiver laundering hole.
//
// Everything runs against isolated fixture trees via the AIKAMI_GUARD_ROOT /
// AIKAMI_GUARD_BASELINE / AIKAMI_GUARD_EXEMPTIONS / AIKAMI_GUARD_WAIVERS env
// overrides, so the repository's real policy files are never touched.
//
// The pure logic (thresholds, classification, dates, effective allowance) is
// covered by guards_source_size_policy.test.ts and
// guard_source_file_size_helpers.test.ts.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

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

/**
 * Writes a file with exactly `lines` physical lines.
 *
 * The body is comment lines on purpose: a fixture must be *valid* TypeScript,
 * because the exemption-classification check parses the file to prove a
 * `declarative` claim (no logic declarations). Arbitrary filler text would be a
 * syntax error, and an unparseable file cannot be proven declarative.
 */
const writeSource = (root: string, relPath: string, lines: number, ending = '\n'): string => {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  if (lines === 0) {
    writeFileSync(full, '');
    return full;
  }
  const body = Array.from({ length: lines }, (_, index) => `// line ${index + 1}`).join('\n');
  writeFileSync(full, `${body}${ending}`);
  return full;
};

/**
 * Policy files live under the fixture root at the SAME repo-relative path the
 * real files use. The trusted-base check reads them with `git show <ref>:<path>`
 * against the fixture's own git repo, so the path has to match on both sides.
 */
const POLICY_DIR = 'scripts/src/lib/ops';

const writeJson = (root: string, relPath: string, value: unknown): string => {
  const path = join(root, relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
};

const waiver = (maxLines: number, overrides: Record<string, unknown> = {}) => ({
  maxLines,
  rationale: 'large mutable module pending a named decomposition',
  owner: '@aikami/client',
  issue: '#342',
  reviewBy: '2026-12-31',
  ...overrides,
});

const declarativeExemption = (maxLines: number) => ({
  maxLines,
  rationale: 'cohesive declarative table consumed as a single lookup dataset',
  owner: '@aikami/platform',
  kind: 'declarative',
});

type GuardRun = { status: number | null; stdout: string; stderr: string };

const runGuard = (options: {
  root: string;
  args?: string[];
  /** Pass `undefined` to leave the on-disk baseline untouched. */
  baseline?: unknown;
  exemptions?: unknown;
  waivers?: unknown;
  legacyExceptions?: unknown;
  baseRef?: string;
  today?: string;
}): GuardRun => {
  const paths = {
    baseline: join(options.root, POLICY_DIR, 'baseline.json'),
    exemptions: join(options.root, POLICY_DIR, 'exemptions.json'),
    waivers: join(options.root, POLICY_DIR, 'waivers.json'),
    legacy: join(options.root, POLICY_DIR, 'legacy_exceptions.json'),
  };
  if (options.baseline !== undefined) {
    writeJson(options.root, `${POLICY_DIR}/baseline.json`, options.baseline);
  }
  writeJson(options.root, `${POLICY_DIR}/exemptions.json`, options.exemptions ?? {});
  writeJson(options.root, `${POLICY_DIR}/waivers.json`, options.waivers ?? {});
  if (options.legacyExceptions !== undefined) {
    writeJson(options.root, `${POLICY_DIR}/legacy_exceptions.json`, options.legacyExceptions);
  } else {
    rmSync(paths.legacy, { force: true });
  }

  const env = {
    ...process.env,
    AIKAMI_GUARD_ROOT: options.root,
    AIKAMI_GUARD_BASELINE: paths.baseline,
    AIKAMI_GUARD_EXEMPTIONS: paths.exemptions,
    AIKAMI_GUARD_WAIVERS: paths.waivers,
    AIKAMI_GUARD_EXCEPTIONS: paths.legacy,
    AIKAMI_GUARD_BASE_REF: options.baseRef ?? '',
    AIKAMI_GUARD_TODAY: options.today ?? '2026-09-18',
    AIKAMI_GUARD_POLICY_AUTHORIZATION: '',
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
  JSON.parse(readFileSync(join(root, POLICY_DIR, 'baseline.json'), 'utf8')) as Record<
    string,
    number
  >;

// ── Thresholds ───────────────────────────────────────────────────────────

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

// ── Baseline ratchet ─────────────────────────────────────────────────────

describe('guard CLI — baseline ratchet', () => {
  test('an unchanged grandfathered file passes', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/foo.ts', 900);
    writeJson(root, `${POLICY_DIR}/baseline.json`, { 'apps/src/foo.ts': 900 });
    expect(runGuard({ root }).status).toBe(0);
  });

  test('baseline growth fails', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/foo.ts', 901);
    writeJson(root, `${POLICY_DIR}/baseline.json`, { 'apps/src/foo.ts': 900 });
    const run = runGuard({ root });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('grew past its grandfathered baseline');
  });

  test('a reduction must be locked in, then --update-baseline locks it', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/foo.ts', 850);
    writeJson(root, `${POLICY_DIR}/baseline.json`, { 'apps/src/foo.ts': 900 });
    const run = runGuard({ root });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('--update-baseline');

    const update = runGuard({ root, args: ['--update-baseline'] });
    expect(update.status).toBe(0);
    expect(readBaseline(root)['apps/src/foo.ts']).toBe(850);
    expect(runGuard({ root }).status).toBe(0);
  });

  test('ordinary update refuses to add new debt', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/foo.ts', 900);
    writeJson(root, `${POLICY_DIR}/baseline.json`, {});
    const run = runGuard({ root, args: ['--update-baseline'] });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('reduction');
  });
});

// ── Bootstrap ────────────────────────────────────────────────────────────

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
    writeJson(root, `${POLICY_DIR}/baseline.json`, { 'apps/src/foo.ts': 900 });
    expect(runGuard({ root, args: ['--bootstrap-baseline'] }).status).toBe(1);
  });
});

// ── Rename and deletion ──────────────────────────────────────────────────

describe('guard CLI — rename and deletion', () => {
  test('a rename cannot bypass the baseline', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/new_name.ts', 900);
    writeJson(root, `${POLICY_DIR}/baseline.json`, { 'apps/src/old_name.ts': 900 });
    const run = runGuard({ root });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('new_name.ts:1 [size]');
    expect(run.stderr).toContain('no longer resolves');
    expect(runGuard({ root, args: ['--update-baseline'] }).status).toBe(1);
  });

  test('a deleted baselined file must be removed from the baseline', () => {
    const root = createRoot();
    writeJson(root, `${POLICY_DIR}/baseline.json`, { 'apps/src/gone.ts': 900 });
    expect(runGuard({ root }).status).toBe(1);
    const update = runGuard({ root, args: ['--update-baseline'] });
    expect(update.status).toBe(0);
    expect(readBaseline(root)).toEqual({});
  });
});

// ── Permanent exemptions ─────────────────────────────────────────────────

describe('guard CLI — permanent exemptions', () => {
  test('a declarative exemption lifts the hard limit up to its ceiling', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/table.ts', 1000);
    const exemptions = { 'apps/src/table.ts': declarativeExemption(1200) };
    expect(runGuard({ root, exemptions }).status).toBe(0);
    writeSource(root, 'apps/src/table.ts', 1300);
    const over = runGuard({ root, exemptions });
    expect(over.status).toBe(1);
    expect(over.stderr).toContain('permanent declarative exemption ceiling');
  });

  test('a declarative exemption on a file containing logic is rejected', () => {
    const root = createRoot();
    const full = join(root, 'apps/src/logic.ts');
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(
      full,
      `${Array.from({ length: 900 }, () => '// padding').join('\n')}\nexport const doThing = () => 1;\nexport function other() {}\n`,
    );
    const run = runGuard({
      root,
      exemptions: { 'apps/src/logic.ts': declarativeExemption(1200) },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('declarative');
    expect(run.stderr).toContain('logic');
  });

  test('a generated exemption without a verifiable source is rejected', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/snapshot.ts', 900);
    const run = runGuard({
      root,
      exemptions: {
        'apps/src/snapshot.ts': {
          maxLines: 1200,
          rationale: 'generated catalog snapshot kept in parity by a test',
          owner: '@aikami/platform',
          kind: 'generated',
        },
      },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('needs a "source"');
  });

  test('a generated exemption whose source exists is accepted', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/snapshot.ts', 900);
    writeSource(root, 'apps/src/source_fixture.json', 3);
    expect(
      runGuard({
        root,
        exemptions: {
          'apps/src/snapshot.ts': {
            maxLines: 1200,
            rationale: 'generated catalog snapshot kept in parity by a test',
            owner: '@aikami/platform',
            kind: 'generated',
            source: 'apps/src/source_fixture.json',
          },
        },
      }).status,
    ).toBe(0);
  });

  test('an obsolete exemption is flagged', () => {
    const root = createRoot();
    const run = runGuard({
      root,
      exemptions: { 'apps/src/missing.ts': declarativeExemption(900) },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('obsolete exemption');
  });

  test('an exemption that no longer relaxes the hard limit is obsolete', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/table.ts', 900);
    const run = runGuard({
      root,
      exemptions: { 'apps/src/table.ts': declarativeExemption(700) },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('does not relax');
  });
});

// ── Temporary waivers ────────────────────────────────────────────────────

describe('guard CLI — temporary waivers', () => {
  test('a current waiver lifts the hard limit up to its ceiling', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/big.ts', 1000);
    const waivers = { 'apps/src/big.ts': waiver(1200) };
    expect(runGuard({ root, waivers }).status).toBe(0);
  });

  test('exceeding the waiver ceiling fails with the non-bypass remediation', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/big.ts', 1272);
    const run = runGuard({ root, waivers: { 'apps/src/big.ts': waiver(1200) } });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('exceeds its temporary waiver ceiling by 72 lines');
    expect(run.stderr).toContain('identify a cohesive responsibility to extract');
    expect(run.stderr).toContain('explicit human review');
  });

  test('an expired waiver fails with the exact actionable message', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/big.ts', 1000);
    const run = runGuard({
      root,
      waivers: { 'apps/src/big.ts': waiver(1200, { reviewBy: '2026-12-31' }) },
      today: '2027-01-01',
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('expired on 2026-12-31');
    expect(run.stderr).toContain('obtain explicit human review for a renewed waiver');
    expect(run.stderr).toContain('Do NOT extend reviewBy automatically');
  });

  test('a malformed reviewBy fails', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/big.ts', 1000);
    const run = runGuard({
      root,
      waivers: { 'apps/src/big.ts': waiver(1200, { reviewBy: 'soon' }) },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('real ISO date');
  });

  test('a waiver without an issue fails', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/big.ts', 1000);
    const run = runGuard({
      root,
      waivers: { 'apps/src/big.ts': waiver(1200, { issue: undefined }) },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('"issue" is required');
  });

  test('an obsolete waiver (file back under the hard limit) fails', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/small.ts', 700);
    const run = runGuard({ root, waivers: { 'apps/src/small.ts': waiver(1200) } });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('obsolete waiver');
  });

  test('a baseline entry and a waiver for the same path is a configuration error', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/big.ts', 1000);
    writeJson(root, `${POLICY_DIR}/baseline.json`, { 'apps/src/big.ts': 1000 });
    const run = runGuard({ root, waivers: { 'apps/src/big.ts': waiver(1200) } });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('superseded');
  });
});

// ── Trusted-base enforcement ─────────────────────────────────────────────

describe('guard CLI — trusted base revision', () => {
  const initRepo = (root: string, policy: Record<string, unknown>): void => {
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@test.invalid']);
    git(root, ['config', 'user.name', 'Test']);
    for (const [name, value] of Object.entries(policy)) {
      writeJson(root, `${POLICY_DIR}/${name}.json`, value);
    }
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'trusted policy']);
  };

  test('rejects a raised allowance against the trusted base', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/big.ts', 1200);
    initRepo(root, {
      baseline: {},
      exemptions: {},
      waivers: { 'apps/src/big.ts': waiver(1200) },
    });
    // The branch raises the ceiling. The file itself did not change.
    const run = runGuard({
      root,
      baseRef: 'HEAD',
      waivers: { 'apps/src/big.ts': waiver(1300) },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('unauthorized allowance expansion');
    expect(run.stderr).toContain('guard-policy expansion');
  });

  test('rejects laundering a baseline entry into a larger waiver', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/big.ts', 1160);
    initRepo(root, {
      // Trusted base: a grandfathered BASELINE entry of 1156 lines.
      baseline: { 'apps/src/big.ts': 1156 },
      exemptions: {},
      waivers: {},
    });

    const run = runGuard({
      root,
      baseRef: 'HEAD',
      // Branch: the same file, now expressed as a WAIVER of 1160 lines.
      waivers: { 'apps/src/big.ts': waiver(1160) },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('unauthorized allowance expansion');
    expect(run.stderr).toContain('1156 → 1160');
  });

  test('permits an allowance reduction against the trusted base', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/big.ts', 1150);
    initRepo(root, {
      baseline: {},
      exemptions: {},
      waivers: { 'apps/src/big.ts': waiver(1200) },
    });

    const run = runGuard({
      root,
      baseRef: 'HEAD',
      waivers: { 'apps/src/big.ts': waiver(1150) },
    });
    expect(run.status).toBe(0);
  });

  test('permits the legacy-exceptions → split-files migration unchanged', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/big.ts', 1160);
    initRepo(root, {
      baseline: {},
      exemptions: {},
      waivers: {},
      // Trusted base still has the pre-split single file.
      legacy_exceptions: { 'apps/src/big.ts': { maxLines: 1160 } },
    });

    const run = runGuard({
      root,
      baseRef: 'HEAD',
      waivers: { 'apps/src/big.ts': waiver(1160) },
    });
    expect(run.status).toBe(0);
  });

  test('a new waiver on a path with no prior allowance is an expansion', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/new_big.ts', 900);
    initRepo(root, { baseline: {}, exemptions: {}, waivers: {} });

    const run = runGuard({
      root,
      baseRef: 'HEAD',
      waivers: { 'apps/src/new_big.ts': waiver(900) },
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('unauthorized allowance expansion');
  });

  test('fails closed when an explicit base revision cannot be read', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/fine.ts', 10);
    const run = runGuard({ root, baseRef: 'missing-ref' });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('base-revision check skipped (missing-ref)');
    expect(run.stderr).toContain('could not verify the source-size policy');
  });

  test('an authorized policy expansion is reported, not fatal', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/big.ts', 1200);
    initRepo(root, {
      baseline: {},
      exemptions: {},
      waivers: { 'apps/src/big.ts': waiver(1200) },
    });

    const paths = {
      baseline: join(root, POLICY_DIR, 'baseline.json'),
      exemptions: join(root, POLICY_DIR, 'exemptions.json'),
      waivers: join(root, POLICY_DIR, 'waivers.json'),
      legacy: join(root, POLICY_DIR, 'legacy_exceptions.json'),
    };
    // Write the raised ceiling directly; the helper's `waivers` option would
    // overwrite it, and this test is about the authorization channel.
    writeJson(root, `${POLICY_DIR}/waivers.json`, { 'apps/src/big.ts': waiver(1300) });

    const result = spawnSync('bun', ['run', GUARD_PATH, '--base-ref=HEAD'], {
      env: {
        ...process.env,
        AIKAMI_GUARD_ROOT: root,
        AIKAMI_GUARD_BASELINE: paths.baseline,
        AIKAMI_GUARD_EXEMPTIONS: paths.exemptions,
        AIKAMI_GUARD_WAIVERS: paths.waivers,
        AIKAMI_GUARD_EXCEPTIONS: paths.legacy,
        AIKAMI_GUARD_TODAY: '2026-09-18',
        AIKAMI_GUARD_POLICY_AUTHORIZATION: 'guard-policy-approved',
        BASE_REF: '',
        AIKAMI_GUARD_BASE_REF: '',
      },
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('GUARD POLICY CHANGE (authorized)');
  });
});

// ── Exclusions and determinism ───────────────────────────────────────────

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
    writeJson(root, `${POLICY_DIR}/baseline.json`, { 'apps/src/b.ts': 900 });
    const first = runGuard({ root, args: ['--show-all'] });
    const second = runGuard({ root, args: ['--show-all'] });
    expect(first.stdout).toBe(second.stdout);
    expect(first.stdout).toContain('Source file size report');
  });

  test('--report prints the threshold distribution', () => {
    const root = createRoot();
    writeSource(root, 'apps/src/small.ts', 100);
    writeSource(root, 'apps/src/mid.ts', 650);
    writeSource(root, 'apps/src/big.ts', 850);
    writeSource(root, 'apps/src/waived.ts', 1000);
    writeSource(root, 'apps/src/table.ts', 2000);
    writeSource(root, 'apps/src/x.test.ts', 900);

    const run = runGuard({
      root,
      args: ['--report'],
      baseline: { 'apps/src/big.ts': 850 },
      waivers: { 'apps/src/waived.ts': waiver(1200) },
      exemptions: { 'apps/src/table.ts': declarativeExemption(2500) },
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('THRESHOLD DISTRIBUTION');
    expect(run.stdout).toContain('Mutable production implementation');
    expect(run.stdout).toContain('Permanent exemptions');
    expect(run.stdout).toContain('Temporary waivers');
    expect(run.stdout).toContain('Waiver calibration');
    expect(run.stdout).toContain('Largest files overall');
  });
});
