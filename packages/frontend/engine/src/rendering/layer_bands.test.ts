// packages/frontend/engine/src/rendering/layer_bands.test.ts
//
// C-548: the E2E debug/walkability grid must be visible on terrain maps.
//
// It used to sit BELOW the ground band, so once the autotiled terrain rendered
// the collision overlay was fully occluded and the evidence capture showed no
// overlay. Pin the band order here (the rendering.test.ts size ceiling is
// grandfathered, so this focused file carries the new assertion).

import { describe, expect, test } from 'bun:test';
import { MIN_ENTITY_Y, WORLD_Z_BANDS } from './layer_bands.ts';

describe('WORLD_Z_BANDS ordering (C-548)', () => {
  test('the debug grid draws above the opaque ground and decor bands', () => {
    expect(WORLD_Z_BANDS.debugGrid).toBeGreaterThan(WORLD_Z_BANDS.tilemapGround);
    expect(WORLD_Z_BANDS.debugGrid).toBeGreaterThan(WORLD_Z_BANDS.tilemapDecor);
  });

  test('every below band stays under MIN_ENTITY_Y so entities never interleave', () => {
    for (const band of [
      WORLD_Z_BANDS.debugGrid,
      WORLD_Z_BANDS.tilemapGround,
      WORLD_Z_BANDS.tilemapDecor,
      WORLD_Z_BANDS.zoneOverlays,
      WORLD_Z_BANDS.combatSelection,
    ]) {
      expect(band).toBeLessThan(MIN_ENTITY_Y);
    }
  });

  test('overhead draws above every entity band', () => {
    expect(WORLD_Z_BANDS.tilemapOverhead).toBeGreaterThan(0);
    expect(WORLD_Z_BANDS.tilemapOverhead).toBeGreaterThan(WORLD_Z_BANDS.debugGrid);
  });
});
