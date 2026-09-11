// apps/frontend/client/src/lib/views/game/dashboard/character_sheet_composition.ts
//
// Production wiring for the character sheet. This is the only module in the
// feature that imports the `$services` barrel; the ViewModel receives its
// dependencies as typed capabilities, so unit tests never touch the global
// service registry.

import { equipmentService, playerStateService } from '$services';
import {
  type CharacterSheetViewModelInterface,
  type CharacterSheetViewModelOptions,
  createCharacterSheetViewModel,
} from './character_sheet_view_model.svelte';

type CharacterSheetCompositionOptions = Omit<
  CharacterSheetViewModelOptions,
  'playerState' | 'equipment'
>;

/**
 * Builds the character-sheet ViewModel wired to the production player-state and
 * equipment singletons.
 */
export const getCharacterSheetViewModel = (
  options: CharacterSheetCompositionOptions,
): CharacterSheetViewModelInterface =>
  createCharacterSheetViewModel({
    ...options,
    playerState: playerStateService,
    equipment: equipmentService,
  });
