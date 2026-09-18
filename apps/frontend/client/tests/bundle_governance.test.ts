// apps/frontend/client/tests/bundle_governance.test.ts
//
// Focused tests for the build-governance scripts:
//   - scripts/report_bundle_budget.ts   (budget measurement + ratchet)
//   - scripts/check_ineffective_dynamic_imports.ts (import-boundary ratchet)
//   - scripts/diagnostic_collector.ts   (diagnostic parsing/first-party split)
//
// These pin the pure logic so a refactor cannot quietly disable the ratchets.

import { describe, expect, test } from 'bun:test';
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
  workerBundles: [{ file: 'workers/w.js', bytes: 500 }],
  routeClosures: [
    { route: '/', files: 5, rawBytes: 1000 },
    { route: '/game', files: 8, rawBytes: 2000 },
  ],
  ...overrides,
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
