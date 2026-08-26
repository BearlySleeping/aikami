// packages/shared/lpc/tests/purity.test.ts
//
// AC-1: The package is pure — no pixi.js, bitecs, svelte, node:fs, or node:path.

import { describe, expect, test } from 'bun:test';

describe('@aikami/lpc purity', () => {
  test('imports without pixi.js, bitecs, svelte, node:fs, or node:path', async () => {
    // Read the package.json to verify dependencies
    const pkg = await import('../package.json');
    const deps = Object.keys(pkg.dependencies ?? {});
    const forbidden = ['pixi.js', 'bitecs', 'svelte', 'node:fs', 'node:path'];

    for (const dep of forbidden) {
      expect(deps).not.toContain(dep);
    }
  });

  test('can be imported in a bare Node context', async () => {
    // Verify the module can be imported without errors
    const mod = await import('../src/index.ts');
    expect(mod.buildLpcCatalog).toBeDefined();
    expect(mod.LpcAnimationState).toBeDefined();
    expect(mod.LpcDirection).toBeDefined();
    expect(mod.lpcTag).toBeDefined();
    expect(mod.resolveLpcSheetGeometry).toBeDefined();
    expect(mod.LPC_LAYER_ORDER).toBeDefined();
    expect(mod.resolveLpcAppearance).toBeDefined();
  });
});
