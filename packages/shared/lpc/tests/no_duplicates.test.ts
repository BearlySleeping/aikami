// packages/shared/lpc/tests/no_duplicates.test.ts
//
// AC-5: The duplicates are gone.

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';

describe('no duplicate LPC files', () => {
  const deletedFiles = [
    'apps/frontend/client/src/lib/data/lpc_models.ts',
    'apps/frontend/client/src/lib/data/lpc_tags.ts',
    'apps/frontend/client/src/lib/data/lpc_asset_catalog_generated.ts',
    'apps/frontend/client/src/lib/views/dev/sandbox/shared/lpc_sandbox_resolver.ts',
  ];

  for (const filePath of deletedFiles) {
    test(`${filePath} does not exist`, () => {
      expect(existsSync(filePath)).toBe(false);
    });
  }
});
