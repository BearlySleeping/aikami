// apps/frontend/client/src/lib/views/game/hotbar/hotbar_view_model.test.ts
//
// Unit tests for HotbarViewModel — slot derivation, class-registry label
// resolution, ability activation, and visibility. Exercises the ViewModel
// through feature-owned fixtures — no global `$services` barrel mock.
//
// Contract: C-337 Complete Character Progression, Classes, Abilities, Skills, and Spells

import { describe, expect, mock, test } from 'bun:test';
import { CLASS_REGISTRY } from '@aikami/constants';
import { BaseViewModel } from '@aikami/frontend/services/base';
import type { ClassFeature } from '@aikami/types';
import {
  createHotbarViewModel,
  type HotbarPlayerStateCapabilities,
} from './hotbar_view_model.svelte';
import { createHotbarPlayerState } from './testing/hotbar_fixtures.ts';

/** First feature declared by any class, used to prove registry resolution. */
const sampleFeature = ((): ClassFeature | undefined => {
  const registry = CLASS_REGISTRY as Record<string, { features: Record<string, ClassFeature[]> }>;
  for (const classDef of Object.values(registry)) {
    for (const levelFeatures of Object.values(classDef.features)) {
      const found = levelFeatures[0];
      if (found) {
        return found;
      }
    }
  }
  return undefined;
})();

const createViewModel = (playerState: HotbarPlayerStateCapabilities = createHotbarPlayerState()) =>
  createHotbarViewModel({ className: 'HotbarViewModelTest', playerState });

describe('HotbarViewModel — slot derivation', () => {
  test('produces six empty slots when none are configured', () => {
    const viewModel = createViewModel();

    expect(viewModel.slots).toHaveLength(6);
    expect(viewModel.slots.every((slot) => !slot.filled)).toBe(true);
    expect(viewModel.slots[0].title).toBe('Slot 1 (empty)');
    expect(viewModel.slots[5].keybind).toBe('6');
  });

  test('resolves a known feature name from the class registry', () => {
    if (!sampleFeature) {
      return;
    }
    const viewModel = createViewModel(createHotbarPlayerState({ hotbarSlots: [sampleFeature.id] }));

    expect(viewModel.slots[0].filled).toBe(true);
    expect(viewModel.slots[0].label).toBe(sampleFeature.name);
  });

  test('falls back to the raw feature id when unknown', () => {
    const viewModel = createViewModel(
      createHotbarPlayerState({ hotbarSlots: ['mystery_feature'] }),
    );

    expect(viewModel.slots[0].label).toBe('mystery_feature');
  });

  test('treats an absent use count as unlimited and a zero count as unusable', () => {
    const viewModel = createViewModel(
      createHotbarPlayerState({
        hotbarSlots: ['unlimited', 'exhausted'],
        abilityUses: { exhausted: 0 },
      }),
    );

    expect(viewModel.slots[0].usesRemaining).toBeNull();
    expect(viewModel.slots[0].canUse).toBe(true);
    expect(viewModel.slots[1].usesRemaining).toBe(0);
    expect(viewModel.slots[1].canUse).toBe(false);
  });
});

describe('HotbarViewModel — assigned-slot projection (C-497 AC-3)', () => {
  test('projects only filled slots from a partially-filled hotbar', () => {
    const viewModel = createViewModel(
      createHotbarPlayerState({ hotbarSlots: ['action_surge', '', 'second_wind'] }),
    );

    expect(viewModel.slots).toHaveLength(6);
    const assigned = viewModel.assignedSlots;
    expect(assigned).toHaveLength(2);
    expect(assigned.map((slot) => slot.featureId)).toEqual(['action_surge', 'second_wind']);
    expect(assigned.every((slot) => slot.filled)).toBe(true);
  });

  test('retains true keybind/index on projected slots', () => {
    const viewModel = createViewModel(
      createHotbarPlayerState({ hotbarSlots: ['', '', 'action_surge'] }),
    );

    const [slot] = viewModel.assignedSlots;
    expect(slot.index).toBe(2);
    expect(slot.keybind).toBe('3');
  });

  test('projects nothing when the hotbar is empty', () => {
    const viewModel = createViewModel(createHotbarPlayerState());
    expect(viewModel.assignedSlots).toHaveLength(0);
  });

  test('updates the projected count when an ability is assigned or cleared', () => {
    const playerState = createHotbarPlayerState({ hotbarSlots: ['action_surge'] });
    const viewModel = createViewModel(playerState);
    expect(viewModel.assignedSlots).toHaveLength(1);

    // Simulate clearing slot 0 — the projection re-derives without a reload.
    playerState.hotbarSlots = [];
    expect(viewModel.assignedSlots).toHaveLength(0);
  });
});

describe('HotbarViewModel — activation', () => {
  test('activateSlot uses the slot ability', () => {
    const useAbility = mock((_featureId: string) => {});
    const viewModel = createViewModel(
      createHotbarPlayerState({ hotbarSlots: ['action_surge'], useAbility }),
    );

    viewModel.activateSlot(0);

    expect(useAbility).toHaveBeenCalledWith('action_surge');
  });

  test('activateSlot is a no-op for an empty slot', () => {
    const useAbility = mock((_featureId: string) => {});
    const viewModel = createViewModel(createHotbarPlayerState({ useAbility }));

    viewModel.activateSlot(3);

    expect(useAbility).not.toHaveBeenCalled();
  });
});

describe('HotbarViewModel — visibility', () => {
  test('setVisible toggles the visible flag', () => {
    const viewModel = createViewModel();

    expect(viewModel.visible).toBe(true);
    viewModel.setVisible(false);
    expect(viewModel.visible).toBe(false);
  });
});

describe('HotbarViewModel — real base class', () => {
  test('extends the production BaseViewModel', () => {
    expect(createViewModel()).toBeInstanceOf(BaseViewModel);
  });
});
