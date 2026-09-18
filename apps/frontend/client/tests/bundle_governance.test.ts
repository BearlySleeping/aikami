// apps/frontend/client/tests/bundle_governance.test.ts
//
// Focused tests for the build-governance scripts:
//   - scripts/report_bundle_budget.ts   (budget measurement + ratchet)
//   - scripts/check_ineffective_dynamic_imports.ts (import-boundary ratchet)
//   - scripts/diagnostic_collector.ts   (diagnostic parsing/first-party split)
//
// These pin the pure logic so a refactor cannot quietly disable the ratchets.

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  findNewIneffectiveImports,
  findResolvedIneffectiveImports,
} from '../scripts/check_ineffective_dynamic_imports.ts';
import {
  isFirstPartyModule,
  parseIneffectiveDynamicImportModule,
} from '../scripts/diagnostic_collector.ts';
import {
  type BundleBudget,
  findBudgetRegressions,
  formatBudget,
  measureBundleBudget,
  parseRouteTable,
  transitiveClosure,
} from '../scripts/report_bundle_budget.ts';

const budget = (overrides: Partial<BundleBudget> = {}): BundleBudget => ({
  jsChunkCount: 10,
  largestJsChunkBytes: 1000,
  largestJsChunkGzipBytes: 400,
  largestJsChunk: 'chunks/a.js',
  totalJsBytes: 10_000,
  totalCssBytes: 1000,
  totalWasmBytes: 2000,
  workerBundles: [{ id: 'w.js', file: 'workers/w-hash0001.js', bytes: 500 }],
  routeClosures: [
    { route: '/', files: 5, rawBytes: 1000 },
    { route: '/game', files: 8, rawBytes: 2000 },
  ],
  ...overrides,
});

const temporaryDirectories: string[] = [];

const temporaryBuild = (): string => {
  const buildDir = mkdtempSync(join(tmpdir(), 'aikami-bundle-budget-'));
  temporaryDirectories.push(buildDir);
  return buildDir;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('parseRouteTable', () => {
  test('parses SvelteKit route → node id entries', () => {
    const source = '{"/(dev)/dev/voice":[55,[2]],"/game":[57],"/settings":[58]}';
    const table = parseRouteTable(source);
    expect(table.get('/game')).toEqual([57]);
    expect(table.get('/settings')).toEqual([58]);
  });

  test('returns an empty map for unrelated source', () => {
    expect(parseRouteTable('const x = 1;').size).toBe(0);
  });
});

describe('transitiveClosure', () => {
  test('follows static imports and stops at dynamic ones', () => {
    const manifest = {
      a: { file: 'a.js', imports: ['b'] },
      b: { file: 'b.js', imports: ['c'], dynamicImports: ['lazy'] },
      c: { file: 'c.js' },
      lazy: { file: 'lazy.js', isDynamicEntry: true },
    };
    const closure = transitiveClosure(manifest, ['a']);
    expect([...closure].sort()).toEqual(['a', 'b', 'c']);
    expect(closure.has('lazy')).toBe(false);
  });

  test('resolves imports by emitted basename', () => {
    const manifest = {
      'src/x.ts': {
        file: '_app/immutable/x.abc.js',
        imports: ['shared.def.js'],
      },
      'src/shared.ts': { file: '_app/immutable/shared.def.js' },
    };
    const closure = transitiveClosure(manifest, ['src/x.ts']);
    expect(closure.has('src/shared.ts')).toBe(true);
  });

  test('resolves a reference that omits the manifest key underscore', () => {
    // Real Vite manifests key shared chunks `_<hash>.js` while emitting
    // `_app/immutable/chunks/<hash>.js`; either spelling must resolve.
    const manifest = {
      'src/x.ts': {
        file: '_app/immutable/nodes/x.abc.js',
        imports: ['abc123.js'],
      },
      _abc123: { file: '_app/immutable/chunks/abc123.js' },
    };
    const closure = transitiveClosure(manifest, ['src/x.ts']);
    expect(closure.has('_abc123')).toBe(true);
  });

  test('tolerates cycles without hanging', () => {
    const manifest = {
      a: { file: 'a.js', imports: ['b'] },
      b: { file: 'b.js', imports: ['a'] },
    };
    expect([...transitiveClosure(manifest, ['a'])].sort()).toEqual(['a', 'b']);
  });
});

describe('measureBundleBudget', () => {
  test('requires manifest and app-entry inputs', () => {
    const buildDir = temporaryBuild();
    expect(() =>
      measureBundleBudget({ buildDir, manifest: undefined, appEntrySource: '{}' }),
    ).toThrow('requires a Vite manifest');
    expect(() =>
      measureBundleBudget({ buildDir, manifest: {}, appEntrySource: undefined }),
    ).toThrow('requires the emitted app entry source');
  });

  test('requires every tracked route and referenced manifest node', () => {
    const buildDir = temporaryBuild();
    writeFileSync(join(buildDir, '0.js'), '0');
    const manifest = {
      '.svelte-kit/generated/build/client-optimized/nodes/0.js': { file: '0.js' },
    };
    expect(() =>
      measureBundleBudget({
        buildDir,
        manifest,
        appEntrySource: '{"/":[0],"/game":[0]}',
      }),
    ).toThrow('route table is missing tracked route /settings');
    expect(() =>
      measureBundleBudget({
        buildDir,
        manifest,
        appEntrySource: '{"/":[0],"/game":[0],"/settings":[99]}',
      }),
    ).toThrow('references missing manifest node 99');
  });

  test('counts de-duplicated entry CSS and assigns workers a stable logical id', () => {
    const buildDir = temporaryBuild();
    mkdirSync(join(buildDir, '_app/immutable/workers'), { recursive: true });
    writeFileSync(join(buildDir, 'node.js'), '1234');
    writeFileSync(join(buildDir, 'shared.css'), '123456');
    writeFileSync(
      join(buildDir, '_app/immutable/workers/speech_worker-Ab12_cd3.js'),
      '12345678',
    );
    const manifest = {
      '.svelte-kit/generated/build/client-optimized/nodes/0.js': {
        file: 'node.js',
        imports: ['shared'],
        css: ['shared.css'],
        assets: ['_app/immutable/workers/speech_worker-Ab12_cd3.js'],
      },
      shared: { file: 'node.js', css: ['shared.css'] },
    };

    const measured = measureBundleBudget({
      buildDir,
      manifest,
      appEntrySource: '{"/":[0],"/game":[0],"/settings":[0]}',
    });

    expect(measured.routeClosures).toEqual([
      { route: '/', files: 2, rawBytes: 10 },
      { route: '/game', files: 2, rawBytes: 10 },
      { route: '/settings', files: 2, rawBytes: 10 },
    ]);
    expect(measured.workerBundles).toEqual([
      {
        id: 'speech_worker.js',
        file: '_app/immutable/workers/speech_worker-Ab12_cd3.js',
        bytes: 8,
      },
    ]);
  });

  test('fails when a tracked route closure has no emitted file', () => {
    const buildDir = temporaryBuild();
    const manifest = {
      '.svelte-kit/generated/build/client-optimized/nodes/0.js': { file: 'missing.js' },
    };
    expect(() =>
      measureBundleBudget({
        buildDir,
        manifest,
        appEntrySource: '{"/":[0],"/game":[0],"/settings":[0]}',
      }),
    ).toThrow('tracked route / has no emitted files');
  });
});

describe('findBudgetRegressions', () => {
  test('reports no regressions for identical budgets', () => {
    expect(findBudgetRegressions(budget(), budget())).toEqual([]);
  });

  test('allows growth within the headroom ratio', () => {
    const grown = budget({ totalJsBytes: Math.floor(10_000 * 1.05) });
    expect(findBudgetRegressions(grown, budget())).toEqual([]);
  });

  test('flags a tracked total that doubles', () => {
    const grown = budget({ totalJsBytes: 25_000 });
    const regressions = findBudgetRegressions(grown, budget());
    expect(regressions.some((line) => line.startsWith('total JS'))).toBe(true);
  });

  test('flags per-route initial closure growth', () => {
    const grown = budget({
      routeClosures: [{ route: '/game', files: 8, rawBytes: 9000 }],
    });
    const regressions = findBudgetRegressions(grown, budget());
    expect(regressions.some((line) => line.includes('initial closure /game'))).toBe(true);
  });

  test('flags worker growth when only the emitted hash changes', () => {
    const baseline = budget({
      workerBundles: [{ id: 'speech_worker.js', file: 'workers/speech-oldhash1.js', bytes: 500 }],
    });
    const grown = budget({
      workerBundles: [{ id: 'speech_worker.js', file: 'workers/speech-newhash2.js', bytes: 700 }],
    });
    expect(findBudgetRegressions(grown, baseline)).toEqual([
      'worker speech_worker.js: 500 → 700 (+40%)',
    ]);
  });

  test('ignores a metric with no baseline value', () => {
    const grown = budget({
      routeClosures: [{ route: '/new', files: 1, rawBytes: 999_999 }],
    });
    expect(findBudgetRegressions(grown, budget())).toEqual([]);
  });
});

describe('formatBudget', () => {
  test('renders totals and route closures', () => {
    const output = formatBudget(budget());
    expect(output).toContain('JS: 10 chunks');
    expect(output).toContain('largest 0.001 MiB raw');
    expect(output).toContain('Initial dependency closure (static)');
    expect(output).toContain('/game');
  });
});

describe('ineffective dynamic import ratchet', () => {
  test('finds only modules not present in the baseline', () => {
    const measured = ['a.ts', 'b.ts', 'c.ts'];
    expect(findNewIneffectiveImports(measured, ['a.ts'])).toEqual(['b.ts', 'c.ts']);
  });

  test('treats an absent baseline as an empty allow-list', () => {
    expect(findNewIneffectiveImports(['a.ts'], [])).toEqual(['a.ts']);
  });

  test('deduplicates repeated modules', () => {
    expect(findNewIneffectiveImports(['a.ts', 'a.ts'], [])).toEqual(['a.ts']);
  });

  test('reports baseline entries that no longer apply', () => {
    expect(findResolvedIneffectiveImports(['a.ts'], ['a.ts', 'gone.ts'])).toEqual(['gone.ts']);
  });
});

describe('diagnostic collector parsing', () => {
  const message =
    'src/lib/services/foo.ts is dynamically imported by a.ts, b.ts but also statically imported by c.ts, dynamic import will not move module into another chunk.';

  test('extracts the dynamically imported module', () => {
    expect(parseIneffectiveDynamicImportModule(message)).toBe('src/lib/services/foo.ts');
  });

  test('returns undefined for unrelated messages', () => {
    expect(parseIneffectiveDynamicImportModule('something else entirely')).toBeUndefined();
  });

  test('classifies node_modules as third-party', () => {
    expect(isFirstPartyModule('node_modules/.bun/onnxruntime-web/dist/x.mjs')).toBe(false);
    expect(isFirstPartyModule('src/lib/services/foo.ts')).toBe(true);
    expect(isFirstPartyModule('packages/shared/parser/src/index.ts')).toBe(true);
  });
});
