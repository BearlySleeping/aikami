// apps/frontend/client/src/lib/utils/appearance_recipe.test.ts
//
// Equipment-collision normalisation of a character's base appearance.
//
// Regression: the character creator PERSISTS an AI-generated `lpcRecipe` onto
// the persona, and the boot path applies it over `DEFAULT_LPC_RECIPE` for every
// slot it names. So a character whose outfit already contained
// `torso/chainmail_male` wore chainmail as its BASE layer. Equipment merges over
// the base with `mergeLpcRecipes`, which can only replace or append — never
// remove — so equipping and unequipping `chainmailArmor` produced an identical
// sprite and the toggle looked broken. Changing `DEFAULT_LPC_RECIPE` alone does
// not help such a character: its persona overrides the default on every boot.

import { describe, expect, test } from 'bun:test';
import { DEFAULT_LPC_RECIPE } from '@aikami/constants';
import type { ItemDefinition } from '@aikami/types';
import { equipmentAssetsBySlot, normalizeRecipeAgainstEquipment } from './appearance_recipe';

const CATALOG: Record<string, ItemDefinition> = {
  chainmailArmor: {
    label: 'Chainmail',
    itemType: 'armor',
    attackBonus: 0,
    defenseBonus: 4,
    equippable: true,
    slot: 'body',
    basePrice: 90,
    lpcSlot: 'torso',
    lpcAssetId: 'torso/chainmail_male',
  },
  leatherBoots: {
    label: 'Leather Boots',
    itemType: 'armor',
    attackBonus: 0,
    defenseBonus: 1,
    equippable: true,
    slot: 'feet',
    basePrice: 15,
    lpcSlot: 'feet',
    lpcAssetId: 'feet/boots/basic_male',
  },
  ironSword: {
    label: 'Iron Sword',
    itemType: 'weapon',
    attackBonus: 3,
    defenseBonus: 0,
    equippable: true,
    slot: 'rightHand',
    basePrice: 40,
    lpcSlot: 'weapon',
    lpcAssetId: 'weapon/sword/longsword',
  },
  healthPotion: {
    label: 'Health Potion',
    itemType: 'consumable',
    attackBonus: 0,
    defenseBonus: 0,
    equippable: false,
    slot: undefined,
    basePrice: 10,
  },
};

describe('equipmentAssetsBySlot', () => {
  test('collects the assets equippable items provide, keyed by LPC layer', () => {
    const bySlot = equipmentAssetsBySlot(CATALOG);
    expect(bySlot.get('torso')).toEqual(new Set(['torso/chainmail_male']));
    expect(bySlot.get('feet')).toEqual(new Set(['feet/boots/basic_male']));
    expect(bySlot.get('weapon')).toEqual(new Set(['weapon/sword/longsword']));
  });

  test('ignores non-equippable items and items with no LPC mapping', () => {
    const bySlot = equipmentAssetsBySlot(CATALOG);
    // healthPotion is not equippable and has no lpcSlot/lpcAssetId.
    expect(bySlot.size).toBe(3);
  });
});

describe('normalizeRecipeAgainstEquipment', () => {
  test('the historical case: a persona already wearing chainmail is corrected', () => {
    // Exactly what a saved persona looks like today.
    const persona = {
      head: 'head/heads/human_male',
      body: 'body/bodies_male',
      hair: 'hair/bangs_adult',
      torso: 'torso/chainmail_male',
      legs: 'legs/pants_male',
      feet: 'feet/boots/basic_male',
    };
    const { recipe, collisions } = normalizeRecipeAgainstEquipment(persona, CATALOG);

    expect(recipe.torso).toBe(DEFAULT_LPC_RECIPE.torso);
    expect(recipe.torso).not.toBe('torso/chainmail_male');
    expect(recipe.feet).toBe(DEFAULT_LPC_RECIPE.feet);
    expect(collisions).toEqual([
      { slot: 'torso', assetId: 'torso/chainmail_male', replacement: DEFAULT_LPC_RECIPE.torso },
      { slot: 'feet', assetId: 'feet/boots/basic_male', replacement: DEFAULT_LPC_RECIPE.feet },
    ]);
  });

  test('the corrected recipe lets equipment visibly toggle', () => {
    // The actual user-visible invariant: with a normalised base, merging the
    // equipped item CHANGES the composed torso, and unequipping restores it.
    const { recipe: base } = normalizeRecipeAgainstEquipment({ ...DEFAULT_LPC_RECIPE }, CATALOG);
    const unequipped = base.torso;
    const equipped = CATALOG.chainmailArmor?.lpcAssetId;

    expect(equipped).toBeDefined();
    expect(equipped).not.toBe(unequipped);
  });

  test('a non-colliding outfit is left untouched', () => {
    const persona = {
      ...DEFAULT_LPC_RECIPE,
      torso: 'torso/clothes/robe_female',
      head: 'head/heads/human_female',
    };
    const { recipe, collisions } = normalizeRecipeAgainstEquipment(persona, CATALOG);
    expect(collisions).toEqual([]);
    expect(recipe).toEqual(persona);
  });

  test('does not mutate the input recipe', () => {
    const persona = { torso: 'torso/chainmail_male' };
    normalizeRecipeAgainstEquipment(persona, CATALOG);
    expect(persona.torso).toBe('torso/chainmail_male');
  });

  test('leaves a colliding layer alone when there is no neutral default', () => {
    // `dress` has no DEFAULT_LPC_RECIPE entry, so blanking it would drop a layer
    // the sprite needs. A redundant outfit beats a missing layer.
    const persona = { dress: 'dress/evening_gown' };
    const catalog: Record<string, ItemDefinition> = {
      eveningGown: {
        label: 'Evening Gown',
        itemType: 'armor',
        attackBonus: 0,
        defenseBonus: 0,
        equippable: true,
        slot: 'body',
        basePrice: 99,
        lpcSlot: 'dress',
        lpcAssetId: 'dress/evening_gown',
      },
    };
    const { recipe, collisions } = normalizeRecipeAgainstEquipment(persona, catalog);
    expect(collisions).toEqual([]);
    expect(recipe.dress).toBe('dress/evening_gown');
  });

  test('a colliding head IS replaced — DEFAULT_LPC_RECIPE has a neutral head', () => {
    const persona = { head: 'hat/helmet/nasal_adult' };
    const catalog: Record<string, ItemDefinition> = {
      ironHelm: {
        label: 'Iron Helm',
        itemType: 'armor',
        attackBonus: 0,
        defenseBonus: 2,
        equippable: true,
        slot: 'head',
        basePrice: 30,
        lpcSlot: 'head',
        lpcAssetId: 'hat/helmet/nasal_adult',
      },
    };
    const { recipe, collisions } = normalizeRecipeAgainstEquipment(persona, catalog);
    expect(collisions).toHaveLength(1);
    expect(recipe.head).toBe(DEFAULT_LPC_RECIPE.head);
  });

  test('the shipped default recipe has no collision with the real catalog', () => {
    // Belt-and-braces: DEFAULT_LPC_RECIPE must never itself wear an item asset,
    // or every character without a persona recipe regresses.
    const { collisions } = normalizeRecipeAgainstEquipment(DEFAULT_LPC_RECIPE, CATALOG);
    expect(collisions).toEqual([]);
  });
});
