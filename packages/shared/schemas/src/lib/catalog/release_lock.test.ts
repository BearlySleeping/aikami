// packages/shared/schemas/src/lib/catalog/release_lock.test.ts

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import {
  InstalledPackLockSchema,
  ReleaseDependencySchema,
  ReleasePointerSchema,
  ReleaseShardSchema,
} from './release_lock.ts';

const HASH = 'a'.repeat(64);

describe('release lock hash fields', () => {
  test('accepts exactly 64 lowercase hexadecimal characters', () => {
    expect(Value.Check(ReleaseDependencySchema, { key: 'seed/a.json', hash: HASH })).toBe(true);
    expect(
      Value.Check(ReleaseShardSchema, { category: 'lpc', key: 'index/lpc.json', hash: HASH }),
    ).toBe(true);
    expect(
      Value.Check(ReleasePointerSchema, {
        schemaVersion: 'catalog.release.v1',
        releaseId: 'release',
        rootKey: 'index/root.json',
        rootHash: HASH,
        shards: [{ category: 'lpc', key: 'index/lpc.json', hash: HASH }],
        dependencies: [{ key: 'seed/a.json', hash: HASH }],
        publishedAt: '2026-09-11T00:00:00.000Z',
      }),
    ).toBe(true);
    expect(
      Value.Check(InstalledPackLockSchema, {
        schemaVersion: 'catalog.release.v1',
        releaseId: 'release',
        assets: [{ id: 'hero', imageHash: HASH, definitionHash: HASH }],
      }),
    ).toBe(true);
  });

  test('rejects malformed hashes in every hash field', () => {
    const invalidHashes = ['a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64)];
    for (const invalidHash of invalidHashes) {
      expect(Value.Check(ReleaseDependencySchema, { key: 'seed/a.json', hash: invalidHash })).toBe(
        false,
      );
      expect(
        Value.Check(ReleaseShardSchema, {
          category: 'lpc',
          key: 'index/lpc.json',
          hash: invalidHash,
        }),
      ).toBe(false);
      expect(
        Value.Check(ReleasePointerSchema, {
          schemaVersion: 'catalog.release.v1',
          releaseId: 'release',
          rootKey: 'index/root.json',
          rootHash: invalidHash,
          shards: [{ category: 'lpc', key: 'index/lpc.json', hash: HASH }],
          dependencies: [{ key: 'seed/a.json', hash: HASH }],
          publishedAt: '2026-09-11T00:00:00.000Z',
        }),
      ).toBe(false);
      expect(
        Value.Check(InstalledPackLockSchema, {
          schemaVersion: 'catalog.release.v1',
          releaseId: 'release',
          assets: [{ id: 'hero', imageHash: invalidHash, definitionHash: HASH }],
        }),
      ).toBe(false);
      expect(
        Value.Check(InstalledPackLockSchema, {
          schemaVersion: 'catalog.release.v1',
          releaseId: 'release',
          assets: [{ id: 'hero', imageHash: HASH, definitionHash: invalidHash }],
        }),
      ).toBe(false);
    }
  });
});
