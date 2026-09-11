// apps/frontend/client/src/lib/views/game/dashboard/character_sheet_view_model.test.ts
//
// Character Sheet ViewModel tests. Every test constructs the ViewModel from
// feature-owned capability fixtures — no `$services` barrel mock and no
// dependency on a shared test inventory.

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import { createDefaultSheet } from '@aikami/utils';
import {
  type CharacterSheetEquipmentCapabilities,
  type CharacterSheetPlayerStateCapabilities,
  createCharacterSheetViewModel,
} from './character_sheet_view_model.svelte';

const createPlayerStateFixture = (
  overrides: Partial<CharacterSheetPlayerStateCapabilities> = {},
): CharacterSheetPlayerStateCapabilities => {
  const sheet = createDefaultSheet();
  return {
    playerLevel: 3,
    playerXp: 50,
    playerXpToNext: 100,
    playerHp: 8,
    playerMaxHp: 10,
    playerBaseAttack: 5,
    playerBaseDefense: 12,
    abilities: sheet.abilities,
    skills: sheet.skills,
    savingThrows: sheet.savingThrows,
    traits: sheet.traits,
    narrativeTraits: sheet.narrativeTraits,
    classId: 'fighter',
    classFeatures: [],
    hotbarSlots: [],
    characterSheet: sheet,
    setHotbarSlot: mock(() => {}),
    clearHotbarSlot: mock(() => {}),
    useAbility: mock(() => {}),
    setAbilityScore: mock(() => {}),
    toggleSkillProficiency: mock(() => {}),
    toggleSkillExpertise: mock(() => {}),
    toggleSaveProficiency: mock(() => {}),
    setTrait: mock(() => {}),
    addNarrativeTrait: mock(() => {}),
    removeNarrativeTrait: mock(() => {}),
    importCharacterSheet: mock(() => {}),
    ...overrides,
  };
};

const createEquipmentFixture = (
  overrides: Partial<CharacterSheetEquipmentCapabilities> = {},
): CharacterSheetEquipmentCapabilities => ({
  totalAttack: 7,
  totalDefense: 14,
  equippedItems: [],
  ...overrides,
});

const createViewModel = (
  options: {
    onClose?: () => void;
    playerState?: CharacterSheetPlayerStateCapabilities;
    equipment?: CharacterSheetEquipmentCapabilities;
  } = {},
) =>
  createCharacterSheetViewModel({
    className: 'CharacterSheetViewModel',
    onClose: options.onClose ?? (() => {}),
    playerState: options.playerState ?? createPlayerStateFixture(),
    equipment: options.equipment ?? createEquipmentFixture(),
  });

describe('CharacterSheetViewModel — proxied stats', () => {
  test('reads level, xp, hp, attack, and defense from the capabilities', () => {
    const viewModel = createViewModel();

    expect(viewModel.level).toBe(3);
    expect(viewModel.xp).toBe(50);
    expect(viewModel.xpToNext).toBe(100);
    expect(viewModel.xpPercent).toBe(50);
    expect(viewModel.hp).toBe(8);
    expect(viewModel.maxHp).toBe(10);
    expect(viewModel.hpPercent).toBe(80);
    expect(viewModel.baseAttack).toBe(5);
    expect(viewModel.totalAttack).toBe(7);
    expect(viewModel.totalDefense).toBe(14);
  });

  test('hpPercent clamps to zero when maxHp is zero', () => {
    const viewModel = createViewModel({
      playerState: createPlayerStateFixture({ playerMaxHp: 0 }),
    });

    expect(viewModel.hpPercent).toBe(0);
  });
});

describe('CharacterSheetViewModel — mutations delegate to the player state', () => {
  test('setAbilityScore delegates', () => {
    const setAbilityScore = mock(() => {});
    const viewModel = createViewModel({
      playerState: createPlayerStateFixture({ setAbilityScore }),
    });

    viewModel.setAbilityScore('strength', 16);

    expect(setAbilityScore).toHaveBeenCalledWith({ key: 'strength', value: 16 });
  });

  test('activateAbility logs and delegates to useAbility', () => {
    const useAbility = mock(() => {});
    const viewModel = createViewModel({
      playerState: createPlayerStateFixture({ useAbility }),
    });

    viewModel.activateAbility('power-strike');

    expect(useAbility).toHaveBeenCalledWith('power-strike');
  });

  test('hotbar slot edits delegate', () => {
    const setHotbarSlot = mock(() => {});
    const clearHotbarSlot = mock(() => {});
    const viewModel = createViewModel({
      playerState: createPlayerStateFixture({ setHotbarSlot, clearHotbarSlot }),
    });

    viewModel.setHotbarSlot(2, 'power-strike');
    viewModel.clearHotbarSlot(2);

    expect(setHotbarSlot).toHaveBeenCalledWith({ slotIndex: 2, featureId: 'power-strike' });
    expect(clearHotbarSlot).toHaveBeenCalledWith(2);
  });
});

describe('CharacterSheetViewModel — JSON editing', () => {
  test('saveJsonEdit imports a valid sheet and leaves edit mode', () => {
    const importCharacterSheet = mock(() => {});
    const viewModel = createViewModel({
      playerState: createPlayerStateFixture({ importCharacterSheet }),
    });

    viewModel.toggleJsonEditing();
    viewModel.setJsonText(JSON.stringify(createDefaultSheet()));
    viewModel.saveJsonEdit();

    expect(importCharacterSheet).toHaveBeenCalledTimes(1);
    expect(viewModel.jsonError).toBeUndefined();
    expect(viewModel.isJsonEditing).toBe(false);
  });

  test('saveJsonEdit rejects invalid JSON without importing', () => {
    const importCharacterSheet = mock(() => {});
    const viewModel = createViewModel({
      playerState: createPlayerStateFixture({ importCharacterSheet }),
    });

    viewModel.setJsonText('{ not valid json');
    viewModel.saveJsonEdit();

    expect(importCharacterSheet).not.toHaveBeenCalled();
    expect(viewModel.jsonError).toBeDefined();
  });
});

describe('CharacterSheetViewModel — base class', () => {
  test('extends the production BaseViewModel', async () => {
    const viewModel = createViewModel();

    expect(viewModel).toBeInstanceOf(BaseViewModel);
    expect('registerEffectRoot' in viewModel).toBe(true);
  });

  test('closeSheet invokes the onClose callback', () => {
    const onClose = mock(() => {});
    const viewModel = createViewModel({ onClose });

    viewModel.closeSheet();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
