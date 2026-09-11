// scripts/src/lib/ops/guard_service_mock_coverage.test.ts
//
// Regression tests for the legacy scope of guard_service_mock_coverage.
//
// The guard must fail for a legacy dependency that lost its preload mock and
// pass for a migrated-only dependency that never needs one. These tests pin
// that behavior on the pure scope functions so a future refactor cannot
// silently widen the guard back to "every barrel export".

import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import {
  collectRequiredServiceExports,
  computeInventoryViolations,
  extractServicesExportNames,
} from './legacy_service_scope.ts';

describe('extractServicesExportNames', () => {
  it('collects runtime names and ignores type-only imports/exports', () => {
    const content = `
      import { authService, type AccountUser, hubApiBase as hub } from '$services';
      import type { SaveSlotEntry } from '$services';
      export { getTracksByMood } from '$services';
      export type { AccountViewModelInterface } from '$services';
    `;

    expect(extractServicesExportNames(content).sort()).toEqual([
      'authService',
      'getTracksByMood',
      'hubApiBase',
    ]);
  });
});

describe('collectRequiredServiceExports', () => {
  it('walks static imports and ignores dynamic-import-only branches', () => {
    // Build platform-correct paths so the resolver and the fake file system
    // agree on Windows (backslashes) as well as POSIX.
    const clientSrcRoot = resolve('/root/src');
    const files = new Map<string, string>([
      [resolve('/root/src/lib/feature/feature.test.ts'), "import { helper } from './helper.ts';"],
      [
        resolve('/root/src/lib/feature/helper.ts'),
        "import { legacyDep, newMigrated } from '$services';\nexport const x = [legacyDep, newMigrated];",
      ],
      [
        resolve('/root/src/lib/feature/lazy.ts'),
        "import { migratedOnly } from '$services';\nexport const y = migratedOnly;",
      ],
      [
        resolve('/root/src/lib/feature/lazy_user.ts'),
        "export const load = () => import('./lazy.ts');",
      ],
    ]);

    const required = collectRequiredServiceExports({
      entryFiles: [resolve('/root/src/lib/feature/feature.test.ts')],
      clientSrcRoot,
      readFile: (file) => {
        const content = files.get(file);
        if (content === undefined) {
          throw new Error(`unexpected read: ${file}`);
        }
        return content;
      },
      fileExists: (file) => files.has(file),
    });

    expect(required).toEqual(['legacyDep', 'newMigrated']);
    expect(required).not.toContain('migratedOnly');
  });

  it('walks package-alias and relative side-effect imports', () => {
    const clientSrcRoot = resolve('/root/src');
    const files = new Map<string, string>([
      [
        resolve('/root/src/lib/feature/feature.test.ts'),
        "import '$lib/feature/package_side_effect.ts';\nimport './relative_side_effect.ts';",
      ],
      [
        resolve('/root/src/lib/feature/package_side_effect.ts'),
        "import { packageAliasDep } from '$services';",
      ],
      [
        resolve('/root/src/lib/feature/relative_side_effect.ts'),
        "import { relativeDep } from '$services';",
      ],
    ]);

    const required = collectRequiredServiceExports({
      entryFiles: [resolve('/root/src/lib/feature/feature.test.ts')],
      clientSrcRoot,
      readFile: (file) => {
        const content = files.get(file);
        if (content === undefined) {
          throw new Error(`unexpected read: ${file}`);
        }
        return content;
      },
      fileExists: (file) => files.has(file),
    });

    expect(required).toEqual(['packageAliasDep', 'relativeDep']);
  });
});

describe('computeInventoryViolations', () => {
  it('fails when a legacy inventory dependency has no preload mock', () => {
    const result = computeInventoryViolations({
      inventory: ['legacyDep'],
      mockKeys: new Set(),
      barrelExports: new Set(['legacyDep']),
    });

    expect(result.missingMocks).toEqual(['legacyDep']);
    expect(result.notBarrelExports).toEqual([]);
  });

  it('passes for a migrated-only dependency that has no preload entry', () => {
    const result = computeInventoryViolations({
      inventory: ['legacyDep'],
      mockKeys: new Set(['legacyDep']),
      barrelExports: new Set(['legacyDep', 'newMigratedOnly']),
    });

    expect(result).toEqual({ missingMocks: [], notBarrelExports: [] });
  });

  it('flags inventory entries that are no longer barrel exports (ratchet)', () => {
    const result = computeInventoryViolations({
      inventory: ['removedService'],
      mockKeys: new Set(['removedService']),
      barrelExports: new Set(),
    });

    expect(result).toEqual({ missingMocks: [], notBarrelExports: ['removedService'] });
  });
});
