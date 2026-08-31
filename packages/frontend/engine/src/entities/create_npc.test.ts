// packages/frontend/engine/src/entities/create_npc.test.ts

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import { registerAppearanceObservers } from '../components/appearance.ts';
import {
  CollisionData,
  CollisionLayer,
  registerCollisionDataObservers,
} from '../components/collision_data.ts';
import { registerCompanionObservers } from '../components/companion.ts';
import { GridPosition, registerGridPositionObservers } from '../components/grid_position.ts';
import { registerNPCDialogObservers } from '../components/npc_dialog.ts';
import { registerPositionObservers } from '../components/position.ts';
import { registerSpatialLinkObservers, SpatialLink } from '../components/spatial_link.ts';
import { registerVisualObservers } from '../components/visual.ts';
import {
  insertIntoSpatialGrid,
  isCellBlocked,
  resetCollisionGrid,
  setCollisionGrid,
} from '../systems/collision_system.ts';
import { createNPC } from './create_npc.ts';

const WALKABLE_GRID = {
  width: 10,
  height: 10,
  tileSize: 32,
  grid: Array.from({ length: 100 }, () => false),
};

describe('createNPC companion collision', () => {
  let world: World;

  beforeEach(() => {
    world = createWorld();
    registerAppearanceObservers(world);
    registerCollisionDataObservers(world);
    registerCompanionObservers(world);
    registerGridPositionObservers(world);
    registerNPCDialogObservers(world);
    registerPositionObservers(world);
    registerSpatialLinkObservers(world);
    registerVisualObservers(world);
    setCollisionGrid(WALKABLE_GRID, world);
  });

  afterEach(() => {
    resetCollisionGrid();
  });

  test('a companion can overlap a player-layer occupant as a C-402 soft obstacle', () => {
    const companionId = createNPC(world, {
      npcId: 'companion',
      npcName: 'Companion',
      x: 160,
      y: 160,
      textureKey: 'npc_test',
      dialog: 'Hello',
      interactionRadius: 64,
      isCompanion: true,
    });
    insertIntoSpatialGrid(companionId);

    const playerId = addEntity(world);
    addComponent(world, playerId, GridPosition);
    addComponent(world, playerId, set(GridPosition, { x: 5, y: 5 }));
    addComponent(world, playerId, SpatialLink);
    addComponent(world, playerId, set(SpatialLink, { next: 0, prev: 0 }));
    addComponent(world, playerId, CollisionData);
    addComponent(
      world,
      playerId,
      set(CollisionData, { layer: CollisionLayer.player, mask: CollisionLayer.wall }),
    );
    insertIntoSpatialGrid(playerId);

    const companionMask = CollisionData.mask[companionId];
    expect(companionMask).toBe(CollisionLayer.wall | CollisionLayer.npc | CollisionLayer.enemy);
    expect(isCellBlocked(5, 5, CollisionLayer.player, companionId)).toBe(true);
    expect(isCellBlocked(5, 5, companionMask, companionId)).toBe(false);
  });
});
