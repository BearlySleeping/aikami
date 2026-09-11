// apps/frontend/client/src/lib/views/dev/sandbox/combat/combat_sandbox_composition.ts
//
// Production wiring for the isolated Combat Encounter sandbox. This is the only
// module in the feature that imports the `$services` barrel; the ViewModel
// receives the game-mode, TTS, and audio services as typed capabilities.

import { audioContextManager, gameModeService, playSfxByName, ttsService } from '$services';
import {
  type CombatSandboxPublicOptions,
  type CombatSandboxViewModelInterface,
  createCombatSandboxViewModel,
} from './combat_sandbox_view_model.svelte';

/** Builds the combat-sandbox ViewModel wired to the production singletons. */
export const getCombatSandboxViewModel = (
  options: CombatSandboxPublicOptions,
): CombatSandboxViewModelInterface =>
  createCombatSandboxViewModel(options, {
    mode: gameModeService,
    tts: ttsService,
    sfx: {
      playSfxByName,
      resumeAudioContext: async () => {
        if (audioContextManager.context.state === 'suspended') {
          await audioContextManager.context.resume();
        }
      },
    },
  });
