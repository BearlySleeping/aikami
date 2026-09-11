// apps/frontend/client/src/lib/views/game/dashboard/character_dashboard_view_model.test.ts
//
// C-153 Character Dashboard & Equipment tests.
//
// This suite exercises the ViewModel through plain, feature-owned capability
// fixtures — no global `$services` barrel mock and no dependency on the
// test_preload mock inventory. Each test constructs exactly the capabilities
// it needs.

import { describe, expect, mock, test } from 'bun:test';
import { BaseViewModel } from '@aikami/frontend/services/base';
import {
  createCharacterDashboardViewModel,
  type EquipmentCapabilities,
  type PlayerStateCapabilities,
} from './character_dashboard_view_model.svelte';

const createPlayerState = (
  overrides: Partial<PlayerStateCapabilities> = {},
): PlayerStateCapabilities => ({
  playerLevel: 3,
  playerXp: 50,
  playerXpToNext: 200,
  playerHp: 40,
  playerMaxHp: 80,
  playerBaseAttack: 7,
  playerBaseDefense: 4,
  ...overrides,
});

const createEquipment = (
  overrides: Partial<EquipmentCapabilities> = {},
): EquipmentCapabilities => ({
  totalAttack: 17,
  totalDefense: 14,
  equippedItems: [{ slot: 'rightHand', itemId: 'ironSword' }],
  ...overrides,
});

const createViewModel = (
  overrides: {
    playerState?: PlayerStateCapabilities;
    equipment?: EquipmentCapabilities;
    onClose?: () => void;
  } = {},
) =>
  createCharacterDashboardViewModel({
    className: 'CharacterDashboardViewModel',
    onClose: overrides.onClose ?? mock(() => {}),
    playerState: overrides.playerState ?? createPlayerState(),
    equipment: overrides.equipment ?? createEquipment(),
  });

describe('CharacterDashboardViewModel — stats', () => {
  test('reflects the playerState capability', () => {
    const viewModel = createViewModel();

    expect(viewModel.level).toBe(3);
    expect(viewModel.xp).toBe(50);
    expect(viewModel.xpToNext).toBe(200);
    expect(viewModel.xpPercent).toBe(25);
    expect(viewModel.hp).toBe(40);
    expect(viewModel.maxHp).toBe(80);
    expect(viewModel.hpPercent).toBe(50);
    expect(viewModel.baseAttack).toBe(7);
    expect(viewModel.baseDefense).toBe(4);
  });

  test('re-reads live playerState fields on each access', () => {
    const playerState = {
      playerLevel: 3,
      playerXp: 50,
      playerXpToNext: 200,
      playerHp: 40,
      playerMaxHp: 80,
      playerBaseAttack: 7,
      playerBaseDefense: 4,
    } satisfies PlayerStateCapabilities;
    const viewModel = createViewModel({ playerState });

    expect(viewModel.level).toBe(3);

    playerState.playerLevel = 9;

    expect(viewModel.level).toBe(9);
  });

  test('clamps xpPercent and hpPercent at their edges', () => {
    const viewModel = createViewModel({
      playerState: createPlayerState({
        playerXp: 400,
        playerXpToNext: 200,
        playerMaxHp: 0,
      }),
      equipment: createEquipment(),
    });

    expect(viewModel.xpPercent).toBe(100);
    expect(viewModel.hpPercent).toBe(0);
  });
});

describe('CharacterDashboardViewModel — equipment', () => {
  test('reflects total attack and defense from the equipment capability', () => {
    const viewModel = createViewModel();

    expect(viewModel.totalAttack).toBe(17);
    expect(viewModel.totalDefense).toBe(14);
  });

  test('maps equipped items to catalog definitions in slot order', () => {
    const viewModel = createViewModel({
      equipment: createEquipment({
        equippedItems: [
          { slot: 'rightHand', itemId: 'ironSword' },
          { slot: 'leftHand', itemId: 'woodenShield' },
        ],
      }),
    });

    const items = viewModel.equippedItems;
    expect(items).toHaveLength(2);
    expect(items[0]?.slot).toBe('rightHand');
    expect(items[0]?.itemId).toBe('ironSword');
    expect(items[0]?.definition.label).toBe('Iron Sword');
    expect(items[0]?.definition.attackBonus).toBe(5);
    expect(items[1]?.slot).toBe('leftHand');
    expect(items[1]?.itemId).toBe('woodenShield');
    expect(items[1]?.definition.label).toBe('Wooden Shield');
    expect(items[1]?.definition.defenseBonus).toBe(2);
  });

  test('exposes slot labels and icons', () => {
    const viewModel = createViewModel();

    expect(viewModel.getSlotLabel('rightHand')).toBe('Right Hand');
    expect(viewModel.getSlotIcon('rightHand').length).toBeGreaterThan(0);
  });
});

describe('CharacterDashboardViewModel — actions', () => {
  test('closeDashboard delegates to the onClose callback', () => {
    const onClose = mock(() => {});
    const viewModel = createViewModel({ onClose });

    viewModel.closeDashboard();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('handleKeyDown closes only on Escape', () => {
    const onClose = mock(() => {});
    const viewModel = createViewModel({ onClose });

    viewModel.handleKeyDown(new KeyboardEvent('keydown', { key: 'a' }));
    expect(onClose).not.toHaveBeenCalled();

    viewModel.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('handleBackdropClick closes only when the backdrop itself is the target', () => {
    const onClose = mock(() => {});
    const viewModel = createViewModel({ onClose });

    viewModel.handleBackdropClick({ target: {}, currentTarget: {} } as unknown as MouseEvent);
    expect(onClose).not.toHaveBeenCalled();

    const target = {};
    viewModel.handleBackdropClick({ target, currentTarget: target } as unknown as MouseEvent);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('CharacterDashboardViewModel — real base class', () => {
  test('extends the production BaseViewModel, not a shared fake', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
