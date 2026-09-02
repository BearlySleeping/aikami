// apps/backend/cloudflare/src/lib/db/__tests__/migrate.test.ts
//
// C-455 AC-1: One D1 migration implementation, reached three ways.

import { describe, expect, test } from 'bun:test';

describe('migrate (AC-1)', () => {
  test('applyMigrations is exported and callable', async () => {
    const { applyMigrations } = await import('../migrate.ts');
    expect(applyMigrations).toBeDefined();
    expect(typeof applyMigrations).toBe('function');
  });

  test('applyMigrations rejects unknown mode', async () => {
    const { applyMigrations } = await import('../migrate.ts');
    expect(applyMigrations({ mode: 'invalid', isLocal: false })).rejects.toThrow(
      'No D1 database configured',
    );
  });

  test('applyMigrations rejects missing D1 config for emulator (no production entry)', async () => {
    const { applyMigrations } = await import('../migrate.ts');
    // emulator has no D1 entry in D1_DATABASES.hub
    expect(applyMigrations({ mode: 'emulator', isLocal: true })).rejects.toThrow(
      'No D1 database configured',
    );
  });
});

describe('AC-1 structural: old files deleted', () => {
  test('scripts/src/lib/deploy/database_migration.ts no longer exists', async () => {
    const exists = await Bun.file(
      `${import.meta.dir}/../../../../../scripts/src/lib/deploy/database_migration.ts`,
    ).exists();
    expect(exists).toBe(false);
  });

  test('scripts/src/lib/database/migrate.ts no longer exists', async () => {
    const exists = await Bun.file(
      `${import.meta.dir}/../../../../../scripts/src/lib/database/migrate.ts`,
    ).exists();
    expect(exists).toBe(false);
  });

  test('scripts/src/lib/ops/d1_migrate_local.ts no longer exists', async () => {
    const exists = await Bun.file(
      `${import.meta.dir}/../../../../../scripts/src/lib/ops/d1_migrate_local.ts`,
    ).exists();
    expect(exists).toBe(false);
  });

  test('scripts/src/lib/ops/d1_seed_local.ts no longer exists', async () => {
    const exists = await Bun.file(
      `${import.meta.dir}/../../../../../scripts/src/lib/ops/d1_seed_local.ts`,
    ).exists();
    expect(exists).toBe(false);
  });
});
