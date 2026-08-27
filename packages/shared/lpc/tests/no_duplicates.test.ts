// packages/shared/lpc/tests/no_duplicates.test.ts
//
// AC-5: The duplicates are gone.

import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '../../../..');

describe('no duplicate LPC files', () => {
  const deletedFiles = [
    'apps/frontend/client/src/lib/data/lpc_models.ts',
    'apps/frontend/client/src/lib/data/lpc_tags.ts',
    'apps/frontend/client/src/lib/data/lpc_asset_catalog_generated.ts',
  ];

  for (const filePath of deletedFiles) {
    test(`${filePath} does not exist`, async () => {
      const fullPath = resolve(REPO_ROOT, filePath);
      const exists = await Bun.file(fullPath).exists();
      expect(exists).toBe(false);
    });
  }
});
