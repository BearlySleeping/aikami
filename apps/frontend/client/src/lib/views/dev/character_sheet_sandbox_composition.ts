// apps/frontend/client/src/lib/views/dev/character_sheet_sandbox_composition.ts
//
// Production wiring for the Character Sheet dev sandbox. This is the only
// module in the feature that imports the `$services` barrel; the ViewModel
// receives an isolated player-state service and the equipment service as typed
// capabilities.

import { createPlayerStateService, equipmentService } from '$services';
import {
  type CharacterSheetSandboxViewModelInterface,
  type CharacterSheetSandboxViewModelOptions,
  createCharacterSheetSandboxViewModel,
} from './character_sheet_sandbox_view_model.svelte';

/** Builds the sandbox ViewModel with an isolated mock player-state service. */
export const getCharacterSheetSandboxViewModel = (
  options: CharacterSheetSandboxViewModelOptions,
): CharacterSheetSandboxViewModelInterface =>
  createCharacterSheetSandboxViewModel(options, {
    playerState: createPlayerStateService({
      className: 'CharacterSheetSandboxPlayerStateService',
    }),
    equipment: equipmentService,
  });
