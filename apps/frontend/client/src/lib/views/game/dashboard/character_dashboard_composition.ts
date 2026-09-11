// apps/frontend/client/src/lib/views/game/dashboard/character_dashboard_composition.ts
//
// Production wiring for the character dashboard feature. This is the only module
// in the feature that imports the `$services` barrel; the ViewModel receives its
// dependencies as typed capabilities, so unit tests never touch the global
// service registry.

import { equipmentService, playerStateService } from '$services';
import {
  type CharacterDashboardViewModelInterface,
  type CharacterDashboardViewModelOptions,
  createCharacterDashboardViewModel,
} from './character_dashboard_view_model.svelte';

type CharacterDashboardCompositionOptions = Omit<
  CharacterDashboardViewModelOptions,
  'playerState' | 'equipment'
>;

/**
 * Builds the character-dashboard ViewModel wired to the production player-state
 * and equipment singletons. Capability fields are getters so the ViewModel keeps
 * tracking reactivity on the underlying `$state` services.
 */
export const getCharacterDashboardViewModel = (
  options: CharacterDashboardCompositionOptions,
): CharacterDashboardViewModelInterface =>
  createCharacterDashboardViewModel({
    ...options,
    playerState: {
      get playerLevel(): number {
        return playerStateService.playerLevel;
      },
      get playerXp(): number {
        return playerStateService.playerXp;
      },
      get playerXpToNext(): number {
        return playerStateService.playerXpToNext;
      },
      get playerHp(): number {
        return playerStateService.playerHp;
      },
      get playerMaxHp(): number {
        return playerStateService.playerMaxHp;
      },
      get playerBaseAttack(): number {
        return playerStateService.playerBaseAttack;
      },
      get playerBaseDefense(): number {
        return playerStateService.playerBaseDefense;
      },
    },
    equipment: {
      get totalAttack(): number {
        return equipmentService.totalAttack;
      },
      get totalDefense(): number {
        return equipmentService.totalDefense;
      },
      get equippedItems() {
        return equipmentService.equippedItems;
      },
    },
  });
