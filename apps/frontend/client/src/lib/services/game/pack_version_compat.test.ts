// apps/frontend/client/src/lib/services/game/pack_version_compat.test.ts
//
// C-381 AC-3 + C-496: a save pinned to an older pack version must resolve
// cleanly, and old-revision resolution only trusts a lock whose pinned bytes
// match what is installed. The boot branch is otherwise only reachable behind
// a full engine boot, so its policy is extracted and tested here.

import { describe, expect, test } from 'bun:test';
import { installedPackRevisionStore, planPackVersionHydration } from './pack_version_compat.ts';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const lockFor = (releaseId: string, imageHash = HASH_A) => ({
  schemaVersion: 'catalog.release.v1' as const,
  releaseId,
  assets: [{ id: 'tileset:atlas', imageHash, definitionHash: HASH_B }],
});

const installedRevision = { version: '4.1.0', lock: lockFor('release-410') };

const base = {
  packId: 'emberwatch',
  savedMapId: 'village',
  currentMapIds: ['village', 'inn', 'merchant_shop'],
  startingMapId: 'village',
  startingMap: { defaultX: 1024, defaultY: 1440 },
  savedX: 320,
  savedY: 576,
  installedRevisions: [] as (typeof installedRevision)[],
};

describe('planPackVersionHydration', () => {
  test('v3 save without a pinned version needs no warnings', () => {
    expect(
      planPackVersionHydration({ ...base, savedVersion: undefined, currentVersion: '4.2.0' }),
    ).toEqual({ kind: 'compatible', warnings: [] });
  });

  test('unknown installed version is compatible rather than a false mismatch', () => {
    expect(
      planPackVersionHydration({ ...base, savedVersion: '4.2.0', currentVersion: undefined }),
    ).toEqual({ kind: 'compatible', warnings: [] });
  });

  test('equal versions are compatible', () => {
    expect(
      planPackVersionHydration({ ...base, savedVersion: '4.2.0', currentVersion: '4.2.0' }),
    ).toEqual({ kind: 'compatible', warnings: [] });
  });

  test('mismatch with the saved map present warns once and restores in place', () => {
    const plan = planPackVersionHydration({
      ...base,
      savedVersion: '4.1.0',
      currentVersion: '4.2.0',
    });
    expect(plan.kind).toBe('mismatch');
    if (plan.kind !== 'mismatch') {
      throw new Error('expected mismatch');
    }
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]?.event).toBe('stage:hydrating_snapshot:pack-version-mismatch');
    expect(plan.redirect).toBeUndefined();
    expect(plan.revisionResolution.kind).toBe('unresolved');
  });

  test('mismatch with a retained lock resolves the old installed revision', () => {
    const plan = planPackVersionHydration({
      ...base,
      savedVersion: '4.1.0',
      currentVersion: '4.2.0',
      installedRevisions: [installedRevision],
    });
    expect(plan.kind).toBe('mismatch');
    if (plan.kind !== 'mismatch') {
      throw new Error('expected mismatch');
    }
    expect(plan.revisionResolution).toEqual({
      kind: 'installed-revision',
      version: '4.1.0',
      releaseId: 'release-410',
    });
  });

  test('a retained lock whose bytes changed does not resolve', () => {
    const plan = planPackVersionHydration({
      ...base,
      savedVersion: '4.1.0',
      currentVersion: '4.2.0',
      installedRevisions: [installedRevision],
      installedAssets: [{ id: 'tileset:atlas', imageHash: HASH_B, definitionHash: HASH_B }],
    });
    expect(plan.kind).toBe('mismatch');
    if (plan.kind !== 'mismatch') {
      throw new Error('expected mismatch');
    }
    expect(plan.revisionResolution.kind).toBe('unresolved');
  });

  test('mismatch with the saved map missing redirects to the starting map', () => {
    const plan = planPackVersionHydration({
      ...base,
      savedMapId: 'removed_map',
      savedVersion: '4.1.0',
      currentVersion: '4.2.0',
    });
    expect(plan.kind).toBe('mismatch');
    if (plan.kind !== 'mismatch') {
      throw new Error('expected mismatch');
    }
    expect(plan.warnings).toHaveLength(2);
    expect(plan.warnings[1]?.event).toBe('stage:hydrating_snapshot:map-not-found-in-updated-pack');
    expect(plan.redirect).toEqual({ mapId: 'village', x: 1024, y: 1440 });
  });

  test('redirect retains saved coordinates without starting-map defaults', () => {
    const plan = planPackVersionHydration({
      ...base,
      savedMapId: 'removed_map',
      startingMap: {},
      savedVersion: '4.1.0',
      currentVersion: '4.2.0',
    });
    expect(plan.kind).toBe('mismatch');
    if (plan.kind !== 'mismatch') {
      throw new Error('expected mismatch');
    }
    expect(plan.redirect).toEqual({ mapId: 'village', x: 320, y: 576 });
  });

  test('redirect retains saved coordinates without a starting map entry', () => {
    const plan = planPackVersionHydration({
      ...base,
      savedMapId: 'removed_map',
      startingMap: undefined,
      savedVersion: '4.1.0',
      currentVersion: '4.2.0',
    });
    expect(plan.kind).toBe('mismatch');
    if (plan.kind !== 'mismatch') {
      throw new Error('expected mismatch');
    }
    expect(plan.redirect).toEqual({ mapId: 'village', x: 320, y: 576 });
  });
});

describe('installedPackRevisionStore', () => {
  test('records, retrieves and lists valid revisions', () => {
    installedPackRevisionStore.clear();
    installedPackRevisionStore.record('4.1.0', lockFor('release-410'));
    expect(installedPackRevisionStore.get('4.1.0')?.releaseId).toBe('release-410');
    expect(installedPackRevisionStore.list().map((r) => r.version)).toEqual(['4.1.0']);
    installedPackRevisionStore.clear();
    expect(installedPackRevisionStore.list()).toEqual([]);
  });

  test('rejects an invalid lock instead of storing corrupt revision data', () => {
    installedPackRevisionStore.clear();
    expect(() =>
      installedPackRevisionStore.record('bad', {
        schemaVersion: 'catalog.release.v1',
        releaseId: '',
        assets: [],
      }),
    ).toThrow('invalid lock');
  });
});
