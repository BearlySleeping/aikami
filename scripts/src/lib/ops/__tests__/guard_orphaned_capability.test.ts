// scripts/src/lib/ops/__tests__/guard_orphaned_capability.test.ts
//
// Tests for the orphaned-capability guard.
//
// Two behaviours matter here and are easy to get wrong in opposite directions:
//
//   1. A RUNTIME capability that only its own tests call IS orphaned — test-only
//      use is the case this guard exists to catch.
//   2. A TYPE-ONLY export is NOT a runtime capability and must not be reported.
//      Before the narrowing, `FooServiceInterface` and `FooServiceOptions` were
//      reported as orphaned capabilities, which pushed real service modules
//      into deleting legitimate public types to satisfy the guard.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import {
  extractExports,
  extractSvelteCode,
  isProductionFile,
} from '../guard_orphaned_capability.ts';

const GUARD_PATH = resolve(import.meta.dir, '../guard_orphaned_capability.ts');
const tempRoots: string[] = [];

afterAll(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const createRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'aikami-orphan-'));
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
      AIKAMI_GUARD_SERVICES: join(options.root, 'apps/frontend/client/src/lib/services'),
      AIKAMI_GUARD_BASELINE: baselinePath,
      AIKAMI_GUARD_CONTRACTS: join(options.root, 'docs/contracts'),
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

// ── extractExports: runtime only ─────────────────────────────────────────

describe('extractExports', () => {
  test('includes public methods from an exported service class', () => {
    const exports = extractExports(`
      export class ExampleService {
        public selectGroupParticipants() {}
        async generateMultiNpcResponses() {}
        protected internalHook() {}
        private secret() {}
      }
    `);

    expect(exports).toContain('ExampleService');
    expect(exports).toContain('ExampleService.selectGroupParticipants');
    expect(exports).toContain('ExampleService.generateMultiNpcResponses');
    expect(exports).not.toContain('ExampleService.internalHook');
    expect(exports).not.toContain('ExampleService.secret');
  });

  test('includes methods from a class exposed through an exported singleton', () => {
    const exports = extractExports(`
      class ExampleService {
        run() {}
      }
      export const exampleService: ExampleService =
        ExampleService.create({}) as ExampleService;
    `);

    expect(exports).toContain('exampleService');
    expect(exports).toContain('ExampleService.run');
  });

  test('does NOT include type aliases or interfaces — they are not runtime capabilities', () => {
    const exports = extractExports(`
      export type ExampleServiceOptions = BaseOptions & { retries: number };
      export interface ExampleServiceInterface { run(): void }
      export class ExampleService { run() {} }
    `);
    expect(exports).not.toContain('ExampleServiceOptions');
    expect(exports).not.toContain('ExampleServiceInterface');
    expect(exports).toContain('ExampleService');
  });

  test('does NOT include a type-only re-export', () => {
    expect(extractExports('export type { Foo } from "./foo.ts";\n')).toEqual([]);
    expect(extractExports('export type { Foo };\ndeclare const Foo: number;\n')).toEqual([]);
  });

  test('does NOT include a forward re-export — ownership lives at the declaration', () => {
    // `export { foo } from './foo.ts'` forwards a symbol declared elsewhere; the
    // declaring file is scanned on its own. Including the forward would
    // double-report it and would attribute foreign symbols to the barrel.
    expect(extractExports('export { foo, bar } from "./foo.ts";\n')).toEqual([]);
  });

  test('includes a LOCAL re-export of a binding declared in this file', () => {
    expect(extractExports('const value = 1;\nexport { value };\n')).toEqual(['value']);
  });

  test('records the PUBLIC name of a renamed local re-export', () => {
    // `export { internal as publicName }` — consumers see `publicName`, and that
    // is the name the production reference index records, so that is the name
    // the orphan check must look up.
    expect(extractExports('const internal = 1;\nexport { internal as publicName };\n')).toEqual([
      'publicName',
    ]);
  });

  test('includes an exported enum — it emits a real object', () => {
    expect(extractExports('export enum Mode { A, B }\n')).toEqual(['Mode']);
  });

  test('includes exported functions and consts', () => {
    expect(
      extractExports('export function go() {}\nexport const factory = () => 1;\n').sort(),
    ).toEqual(['factory', 'go']);
  });

  test('excludes underscore-prefixed exports', () => {
    expect(extractExports('export const _internal = 1;\nexport const visible = 2;\n')).toEqual([
      'visible',
    ]);
  });
});

// ── isProductionFile ─────────────────────────────────────────────────────

describe('production file detection', () => {
  test('a service file is production', () => {
    expect(isProductionFile('apps/frontend/client/src/lib/services/foo_service.svelte.ts')).toBe(
      true,
    );
  });

  test('test, spec, __tests__, declaration and e2e files are not production', () => {
    expect(isProductionFile('apps/frontend/client/src/lib/services/foo.test.ts')).toBe(false);
    expect(isProductionFile('apps/frontend/client/src/lib/services/foo.spec.ts')).toBe(false);
    expect(isProductionFile('apps/frontend/client/src/lib/services/__tests__/foo.ts')).toBe(false);
    expect(isProductionFile('apps/frontend/client/src/lib/services/foo.d.ts')).toBe(false);
    // A page object under apps/e2e/ that is NOT a *.spec.ts file, so this
    // exercises the `/apps/e2e/` branch rather than the spec-file rule.
    expect(isProductionFile('apps/e2e/src/pom/character_page.ts')).toBe(false);
    expect(isProductionFile('apps/e2e/tests/client/foo.spec.ts')).toBe(false);
  });
});

describe('extractSvelteCode', () => {
  test('keeps scripts and template expressions but excludes comments and visible text', () => {
    const code = extractSvelteCode(`
      <script lang="ts">const service = getService();</script>
      <!-- service.commentOnlyMethod() -->
      <p>service.visibleTextOnlyMethod()</p>
      <button onclick={() => service.actualMethod()}>Run</button>
    `);

    expect(code).toContain('getService');
    expect(code).toContain('actualMethod');
    expect(code).not.toContain('commentOnlyMethod');
    expect(code).not.toContain('visibleTextOnlyMethod');
  });
});

// ── CLI: orphan semantics ────────────────────────────────────────────────

const serviceFile = (body: string): string => `// service\n${body}\n`;

describe('guard CLI — orphan detection', () => {
  test('a runtime capability used only by its own tests is orphaned', () => {
    const root = createRoot();
    writeFile(
      root,
      'apps/frontend/client/src/lib/services/demo/demo_service.svelte.ts',
      serviceFile('export const doThing = () => 1;'),
    );
    writeFile(
      root,
      'apps/frontend/client/src/lib/services/demo/demo_service.test.ts',
      "import { doThing } from './demo_service.svelte.ts';\ndoThing();\n",
    );

    const run = runGuard({ root, baseline: {} });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('doThing');
    expect(run.stderr).toContain('no production consumer');
  });

  test('a runtime capability used by production code is not orphaned', () => {
    const root = createRoot();
    writeFile(
      root,
      'apps/frontend/client/src/lib/services/demo/demo_service.svelte.ts',
      serviceFile('export const doThing = () => 1;'),
    );
    writeFile(
      root,
      'apps/frontend/client/src/lib/views/demo/demo_view.svelte',
      '<script lang="ts">\nimport { doThing } from "$services";\ndoThing();\n</script>\n<p>x</p>\n',
    );

    expect(runGuard({ root, baseline: {} }).status).toBe(0);
  });

  test('a type-only export never becomes runtime debt', () => {
    const root = createRoot();
    writeFile(
      root,
      'apps/frontend/client/src/lib/services/demo/demo_types.ts',
      serviceFile(
        'export type DemoOptions = { a: number };\nexport interface DemoInterface { a: number }',
      ),
    );

    expect(runGuard({ root, baseline: {} }).status).toBe(0);
  });

  test('an unused runtime method on an exported service class is orphaned', () => {
    const root = createRoot();
    writeFile(
      root,
      'apps/frontend/client/src/lib/services/demo/demo_service.svelte.ts',
      serviceFile(
        'class DemoService {\n  usedElsewhere() {}\n  neverCalled() {}\n}\nexport const demoService = DemoService.create({});\n',
      ),
    );
    writeFile(
      root,
      'apps/frontend/client/src/lib/views/demo/demo_view.svelte',
      '<script lang="ts">\nimport { demoService } from "$services";\ndemoService.usedElsewhere();\n</script>\n',
    );

    const run = runGuard({ root, baseline: {} });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('DemoService.neverCalled');
    expect(run.stderr).not.toContain('DemoService.usedElsewhere');
  });

  test('a symbol held open by a contract Evidence Matrix is reported, not silently passed', () => {
    const root = createRoot();
    writeFile(
      root,
      'apps/frontend/client/src/lib/services/demo/demo_service.svelte.ts',
      serviceFile('export const plannedCapability = () => 1;'),
    );
    writeFile(
      root,
      'docs/contracts/C-999-demo.md',
      [
        '# C-999',
        '',
        '**Evidence Matrix**',
        '',
        '| AC | Requirement | Verification | Production Path | Status |',
        '|---|---|---|---|---|',
        '| 1 | demo | test | `demo_service.svelte.ts#plannedCapability` | done |',
        '',
      ].join('\n'),
    );

    const run = runGuard({ root, baseline: {}, args: ['--show-all'] });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('held open by a contract Evidence Matrix');
    expect(run.stdout).toContain('plannedCapability');
  });
});

// ── CLI: ratchet semantics ───────────────────────────────────────────────

describe('guard CLI — ratchet semantics', () => {
  test('bootstrap records the current orphans and a clean run then passes', () => {
    const root = createRoot();
    writeFile(
      root,
      'apps/frontend/client/src/lib/services/demo/demo_service.svelte.ts',
      serviceFile('export const doThing = () => 1;'),
    );
    expect(runGuard({ root, args: ['--bootstrap-baseline'] }).status).toBe(0);
    expect(
      readBaseline(root)['apps/frontend/client/src/lib/services/demo/demo_service.svelte.ts']
        ?.counts.orphans,
    ).toBe(1);
    expect(runGuard({ root }).status).toBe(0);
  });

  test('--update-baseline refuses a new orphan', () => {
    const root = createRoot();
    writeFile(
      root,
      'apps/frontend/client/src/lib/services/demo/demo_service.svelte.ts',
      serviceFile('export const doThing = () => 1;'),
    );
    expect(runGuard({ root, args: ['--bootstrap-baseline'] }).status).toBe(0);

    writeFile(
      root,
      'apps/frontend/client/src/lib/services/demo/demo_service.svelte.ts',
      serviceFile('export const doThing = () => 1;\nexport const brandNew = () => 2;'),
    );
    const run = runGuard({ root, args: ['--update-baseline'] });
    expect(run.status).toBe(1);
    expect(
      readBaseline(root)['apps/frontend/client/src/lib/services/demo/demo_service.svelte.ts']
        ?.counts.orphans,
    ).toBe(1);
  });

  test('a same-count symbol swap is refused, so identity cannot hide a regression', () => {
    const root = createRoot();
    writeFile(
      root,
      'apps/frontend/client/src/lib/services/demo/demo_service.svelte.ts',
      serviceFile('export const first = () => 1;'),
    );
    expect(runGuard({ root, args: ['--bootstrap-baseline'] }).status).toBe(0);

    writeFile(
      root,
      'apps/frontend/client/src/lib/services/demo/demo_service.svelte.ts',
      serviceFile('export const second = () => 1;'),
    );
    const run = runGuard({ root, args: ['--update-baseline'] });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('different violations');
  });

  test('an unlocked reduction fails until it is locked in', () => {
    const root = createRoot();
    writeFile(
      root,
      'apps/frontend/client/src/lib/services/demo/demo_service.svelte.ts',
      serviceFile('export const a = () => 1;\nexport const b = () => 2;'),
    );
    expect(runGuard({ root, args: ['--bootstrap-baseline'] }).status).toBe(0);

    writeFile(
      root,
      'apps/frontend/client/src/lib/services/demo/demo_service.svelte.ts',
      serviceFile('export const a = () => 1;'),
    );
    expect(runGuard({ root }).status).toBe(1);
    expect(runGuard({ root, args: ['--update-baseline'] }).status).toBe(0);
    expect(runGuard({ root }).status).toBe(0);
  });
});
