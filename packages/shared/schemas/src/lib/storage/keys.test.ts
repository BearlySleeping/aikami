// packages/shared/schemas/src/lib/storage/keys.test.ts
//
// C-454 AC-1: Unit tests for key spec build/parse round-tripping.

import { describe, expect, test } from 'bun:test';
import {
  userObjectKey,
  saveBackupKey,
  assetKey,
  catalogIndexKey,
  seedKey,
  ASSET_CACHE_CONTROL,
  INDEX_CACHE_CONTROL,
  SEED_CACHE_CONTROL,
} from './keys.ts';

describe('userObjectKey', () => {
  test('builds a valid key', () => {
    const key = userObjectKey.build({ uid: 'user-123', filename: 'avatar.png' });
    expect(key).toBe('users/user-123/avatar.png');
  });

  test('parses a valid key', () => {
    const params = userObjectKey.parse('users/user-123/avatar.png');
    expect(params).toEqual({ uid: 'user-123', filename: 'avatar.png' });
  });

  test('round-trips build → parse', () => {
    const input = { uid: 'user-abc', filename: 'photo.jpg' };
    const key = userObjectKey.build(input);
    const parsed = userObjectKey.parse(key);
    expect(parsed).toEqual(input);
  });

  test('returns undefined for invalid key', () => {
    expect(userObjectKey.parse('')).toBeUndefined();
    expect(userObjectKey.parse('users/')).toBeUndefined();
    expect(userObjectKey.parse('saves/user-123/file.txt')).toBeUndefined();
  });

  test('belongs to saves bucket', () => {
    expect(userObjectKey.bucket).toBe('saves');
  });

  test('has no cache control (private)', () => {
    expect(userObjectKey.cacheControl).toBeUndefined();
  });
});

describe('saveBackupKey', () => {
  test('builds a valid key', () => {
    const key = saveBackupKey.build({
      accountId: 'acc-1',
      timestamp: '1234567890',
      backupId: '550e8400-e29b-41d4-a716-446655440000',
      filename: 'backup.db',
    });
    expect(key).toBe('saves/acc-1/1234567890-550e8400-e29b-41d4-a716-446655440000-backup.db');
  });

  test('parses a valid key', () => {
    const params = saveBackupKey.parse(
      'saves/acc-1/1234567890-550e8400-e29b-41d4-a716-446655440000-backup.db',
    );
    expect(params).toEqual({
      accountId: 'acc-1',
      timestamp: '1234567890',
      backupId: '550e8400-e29b-41d4-a716-446655440000',
      filename: 'backup.db',
    });
  });

  test('round-trips build → parse', () => {
    const input = {
      accountId: 'acc-42',
      timestamp: '9876543210',
      backupId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      filename: 'my-save.sqlite',
    };
    const key = saveBackupKey.build(input);
    const parsed = saveBackupKey.parse(key);
    expect(parsed).toEqual(input);
  });

  test('returns undefined for invalid key', () => {
    expect(saveBackupKey.parse('')).toBeUndefined();
    expect(saveBackupKey.parse('saves/acc-1/file.txt')).toBeUndefined();
  });

  test('belongs to saves bucket', () => {
    expect(saveBackupKey.bucket).toBe('saves');
  });
});

describe('assetKey', () => {
  test('builds a valid key', () => {
    const key = assetKey.build({
      sha256: 'abc123def456',
      ext: '.png',
    });
    expect(key).toBe('assets/abc123def456.png');
  });

  test('parses a valid key', () => {
    const params = assetKey.parse('assets/abc123def456.png');
    expect(params).toEqual({ sha256: 'abc123def456', ext: '.png' });
  });

  test('round-trips build → parse', () => {
    const input = { sha256: 'deadbeefcafe', ext: '.webp' };
    const key = assetKey.build(input);
    const parsed = assetKey.parse(key);
    expect(parsed).toEqual(input);
  });

  test('uses ASSET_CACHE_CONTROL', () => {
    expect(assetKey.cacheControl).toBe(ASSET_CACHE_CONTROL);
  });

  test('belongs to catalog bucket', () => {
    expect(assetKey.bucket).toBe('catalog');
  });
});

describe('catalogIndexKey', () => {
  test('builds the fixed key', () => {
    const key = catalogIndexKey.build({});
    expect(key).toBe('index/v1/catalog.json');
  });

  test('parses the fixed key', () => {
    const params = catalogIndexKey.parse('index/v1/catalog.json');
    expect(params).toEqual({});
  });

  test('returns undefined for non-matching key', () => {
    expect(catalogIndexKey.parse('')).toBeUndefined();
    expect(catalogIndexKey.parse('index/v1/other.json')).toBeUndefined();
  });

  test('uses INDEX_CACHE_CONTROL', () => {
    expect(catalogIndexKey.cacheControl).toBe(INDEX_CACHE_CONTROL);
  });
});

describe('seedKey', () => {
  test('builds a valid key', () => {
    const key = seedKey.build({ name: 'offline-core.json' });
    expect(key).toBe('seed/offline-core.json');
  });

  test('parses a valid key', () => {
    const params = seedKey.parse('seed/offline-core.json');
    expect(params).toEqual({ name: 'offline-core.json' });
  });

  test('round-trips build → parse', () => {
    const input = { name: 'credits.yaml' };
    const key = seedKey.build(input);
    const parsed = seedKey.parse(key);
    expect(parsed).toEqual(input);
  });

  test('uses SEED_CACHE_CONTROL', () => {
    expect(seedKey.cacheControl).toBe(SEED_CACHE_CONTROL);
  });
});

describe('cache control constants', () => {
  test('ASSET_CACHE_CONTROL is immutable for 1 year', () => {
    expect(ASSET_CACHE_CONTROL).toBe('public, max-age=31536000, immutable');
  });

  test('SEED_CACHE_CONTROL is 5 minutes', () => {
    expect(SEED_CACHE_CONTROL).toBe('public, max-age=300');
  });

  test('INDEX_CACHE_CONTROL is 1 minute', () => {
    expect(INDEX_CACHE_CONTROL).toBe('public, max-age=60');
  });
});
