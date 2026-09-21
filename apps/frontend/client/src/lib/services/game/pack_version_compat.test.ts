// apps/frontend/client/src/lib/services/game/pack_version_compat.test.ts
//
// C-381 AC-3: a save pinned to an older pack version must preserve its map
// when possible and redirect only when that map no longer exists.

import { describe, expect, test } from 'bun:test';
import { planPackVersionHydration } from './pack_version_compat.ts';

const base = {
  packId: 'emberwatch',
  savedMapId: 'village',
  currentMapIds: ['village', 'inn', 'merchant_shop'],
  startingMapId: 'village',
  startingMap: { defaultX: 1024, defaultY: 1440 },
  savedX: 320,
  savedY: 576,
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
