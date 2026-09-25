// apps/frontend/client/src/lib/views/inventory/inventory_presentation.test.ts

import { describe, expect, test } from 'bun:test';
import { getItemDefinition } from '$utils/inventory_utils';
import {
  createInventoryPresentationState,
  type InventoryPresentationSource,
  inventorySlotClass,
} from './inventory_presentation.svelte';

const createSource = (): InventoryPresentationSource => ({
  items: [
    { itemId: 'ironSword', quantity: 1 },
    { itemId: 'healthPotion', quantity: 3 },
  ],
  getCompareLabel: (itemId) => (itemId === 'ironSword' ? '+2 ATK' : undefined),
});

describe('inventory presentation state', () => {
  test('falls back to the first real bag item for a populated detail panel', () => {
    const state = createInventoryPresentationState(createSource());

    expect(state.selectedItemId).toBe('ironSword');
    expect(state.selectedItem?.label).toBe(getItemDefinition('ironSword').label);
    expect(state.selectedItem?.quantity).toBe(1);
    expect(state.selectedItem?.compareLabel).toBe('+2 ATK');
    expect(state.selectedItemIcon).toBe('⚔️');
    expect(state.detailEmptyHint).toContain('Choose a bag item');
  });

  test('selects another item and exposes direct action facts', () => {
    const state = createInventoryPresentationState(createSource());

    state.selectItem('healthPotion');

    expect(state.isSelected('healthPotion')).toBe(true);
    expect(state.isSelected('ironSword')).toBe(false);
    expect(state.selectedItem?.quantity).toBe(3);
    expect(state.selectedItem?.isConsumable).toBe(true);
  });

  test('has no selected item for an empty source', () => {
    const state = createInventoryPresentationState({ ...createSource(), items: [] });

    expect(state.selectedItem).toBeUndefined();
    expect(state.selectedItemIcon).toBe('');
    expect(state.detailEmptyHint).toContain('Collect equipment');
  });
});

describe('inventory role projections', () => {
  test('uses the brass selection role only for equipped slots', () => {
    expect(inventorySlotClass('head', true)).toContain('game-inventory__slot--filled');
    expect(inventorySlotClass('head', false)).toContain('game-inventory__slot--empty');
    expect(inventorySlotClass('body', false)).toContain('col-start-2');
  });

  test('marks the selected bag card with the game selection role', () => {
    const state = createInventoryPresentationState(createSource());

    expect(state.itemClass('ironSword')).toContain('game-inventory__item--selected');
    expect(state.itemClass('healthPotion')).not.toContain('game-inventory__item--selected');
  });
});
