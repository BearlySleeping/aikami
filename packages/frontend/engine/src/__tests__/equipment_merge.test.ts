// packages/frontend/engine/src/__tests__/equipment_merge.test.ts
//
// C-417 AC-1 regression coverage for GameWorld._mergeEquipmentRecipes.
//
// The equipment → sprite sync chain (equipmentService → APPEARANCE_CHANGED →
// _mergeEquipmentRecipes → layer reload) predates C-417 and is verified
// end-to-end by the equipment_visual E2E spec. This unit test pins the merge
// semantics so a refactor cannot silently break the torso/feet replacement
// or the append-only behaviour for non-overlapping slots.

import { describe, expect, it } from 'bun:test';

// ---------------------------------------------------------------------------
// Environment bootstrap
//
// game_world.ts transitively imports @aikami/frontend-configs (via pixi_app),
// whose environment singleton validates PUBLIC_APP_ID / PUBLIC_MODE at module
// load. The engine test task has no preload (unlike client), so the env is
// set here and the module is imported dynamically AFTER the vars exist.
// ---------------------------------------------------------------------------

process.env.PUBLIC_APP_ID = 'client';
process.env.PUBLIC_MODE = 'testing';

import type { LpcLayerRecipe } from '../components/appearance.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import type { GameWorld as GameWorldInstance } from '../game_world.ts';

const { MockEngineBridge } = await import('../engine_bridge.ts');
const { GameWorld } = await import('../game_world.ts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createWorld = (options?: {
  equipmentRecipes?: readonly LpcLayerRecipe[];
}): GameWorldInstance => {
  // Type the bridge as EngineBridge so the create() factory overload infers
  // the canonical options shape (MockEngineBridge has extra members).
  const bridge: EngineBridge = new MockEngineBridge();
  return GameWorld.create({
    className: 'GameWorld',
    bridge,
    ...(options?.equipmentRecipes
      ? { equipmentRecipeProvider: () => options.equipmentRecipes ?? [] }
      : {}),
  }) as unknown as GameWorldInstance;
};

/** Accesses the private merge method for white-box regression assertions. */
const merge = (
  world: GameWorldInstance,
  base: readonly LpcLayerRecipe[],
  equipment: readonly LpcLayerRecipe[],
): LpcLayerRecipe[] => {
  const worldWithPrivate = world as unknown as {
    _mergeEquipmentRecipes(
      baseRecipes: readonly LpcLayerRecipe[],
      equipmentRecipes: readonly LpcLayerRecipe[],
    ): LpcLayerRecipe[];
  };
  return worldWithPrivate._mergeEquipmentRecipes(base, equipment);
};

const recipe = (slot: string, assetId: string): LpcLayerRecipe => ({
  slot,
  assetId,
  hexPalette: new Uint8Array(1024),
  layerRole: 'front',
});

// A default player base: body, hair, torso (cloth), legs, feet (boots), head.
const BASE_RECIPES: readonly LpcLayerRecipe[] = [
  recipe('body', 'body/male'),
  recipe('hair', 'hair/bangslong'),
  recipe('torso', 'torso/cloth'),
  recipe('legs', 'legs/pants'),
  recipe('feet', 'feet/boots'),
  recipe('head', 'head/helmet'),
];

// Iron Armour maps to the torso slot (emberwatch manifest: lpcSlot 'torso').
const IRON_ARMOUR = recipe('torso', 'torso/armour/plate_male');
const WOODEN_SHIELD = recipe('shield', 'shield/heater/original/wood_fg');
const IRON_SWORD = recipe('weapon', 'weapon/sword/longsword');

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('GameWorld._mergeEquipmentRecipes (C-417 AC-1)', () => {
  it('replaces the base torso recipe when torso equipment is equipped', () => {
    const world = createWorld({ equipmentRecipes: [IRON_ARMOUR] });
    const merged = merge(world, BASE_RECIPES, [IRON_ARMOUR]);

    const torso = merged.find((r) => r.slot === 'torso');
    expect(torso?.assetId).toBe('torso/armour/plate_male');
    expect(merged.length).toBe(BASE_RECIPES.length); // replaced, not appended
  });

  it('replaces the base feet recipe when feet equipment is equipped', () => {
    const world = createWorld();
    const ironBoots = recipe('feet', 'feet/plate');
    const merged = merge(world, BASE_RECIPES, [ironBoots]);

    const feet = merged.find((r) => r.slot === 'feet');
    expect(feet?.assetId).toBe('feet/plate');
  });

  it('appends non-overlapping slots (weapon, shield) without removing base layers', () => {
    const world = createWorld();
    const merged = merge(world, BASE_RECIPES, [IRON_SWORD, WOODEN_SHIELD]);

    expect(merged.length).toBe(BASE_RECIPES.length + 2);
    expect(merged.find((r) => r.slot === 'weapon')?.assetId).toBe('weapon/sword/longsword');
    expect(merged.find((r) => r.slot === 'shield')?.assetId).toBe('shield/heater/original/wood_fg');
    // Base layers survive alongside the appended gear.
    expect(merged.find((r) => r.slot === 'body')?.assetId).toBe('body/male');
    expect(merged.find((r) => r.slot === 'hair')?.assetId).toBe('hair/bangslong');
  });

  it('reverts to the base recipe on unequip (empty equipment provider)', () => {
    const world = createWorld();
    const merged = merge(world, BASE_RECIPES, []);

    expect(merged).toEqual([...BASE_RECIPES]);
    expect(merged.find((r) => r.slot === 'torso')?.assetId).toBe('torso/cloth');
  });

  it('equips Iron Armour over the base and reverts the sprite layer when unequipped', () => {
    // Mirrors the AC-1 user story: equip → torso replaced; unequip → base restored.
    const world = createWorld({ equipmentRecipes: [IRON_ARMOUR] });

    const equipped = merge(world, BASE_RECIPES, [IRON_ARMOUR]);
    expect(equipped.find((r) => r.slot === 'torso')?.assetId).toBe('torso/armour/plate_male');

    const unequipped = merge(world, BASE_RECIPES, []);
    expect(unequipped.find((r) => r.slot === 'torso')?.assetId).toBe('torso/cloth');
  });

  it('keeps the base recipe intact when no equipment provider is configured', () => {
    const world = createWorld();
    const merged = merge(world, BASE_RECIPES, [IRON_ARMOUR, IRON_SWORD]);
    // Merge is pure — the base array must not be mutated by replacement.
    expect(BASE_RECIPES.find((r) => r.slot === 'torso')?.assetId).toBe('torso/cloth');
    expect(merged.find((r) => r.slot === 'torso')?.assetId).toBe('torso/armour/plate_male');
  });
});
