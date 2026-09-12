// apps/frontend/client/src/lib/views/combat/combat_composition.ts
//
// Production wiring for the combat feature. This is the only module in the
// feature that imports the `$services` barrel; the ViewModel receives its
// dependencies as typed capabilities, so unit tests never touch the global
// service registry.

import {
  audioService,
  diceService,
  getExpressionAssetResolver,
  getTracksByMood,
  imageGenerationService,
  inventoryService,
  playerStateService,
  playSceneBgm,
  resolveAudioTrackUrl,
  textGenerationService,
  ttsService,
  worldGenSeedingService,
  worldStateService,
} from '$services';
import { getCombatLogService } from './combat_log_service.svelte.ts';
import {
  type CombatViewModelInterface,
  type CombatViewModelPublicOptions,
  createCombatViewModel,
} from './combat_view_model.svelte';
import { getStatusEffectsService } from './status_effects_service.svelte.ts';

/**
 * Builds the combat ViewModel wired to the production engine, AI, audio,
 * dice, expression, inventory, world, and combat-log singletons.
 */
export const getCombatViewModel = (
  options: CombatViewModelPublicOptions,
): CombatViewModelInterface =>
  createCombatViewModel({
    ...options,
    engine: {
      createBridge: async () => {
        const { createEngineBridge } = await import('@aikami/frontend/engine');
        return createEngineBridge();
      },
    },
    images: imageGenerationService,
    // Combat intent is a latency-sensitive structured call — pin its task so
    // the gateway applies the tight `combat-intent` token/temperature preset.
    text: {
      extractStructure: (request) =>
        textGenerationService.extractStructure({ ...request, task: 'combat-intent' }),
    },
    tts: ttsService,
    dice: diceService,
    audio: {
      getTracksByMood,
      resolveAudioTrackUrl,
      transitionToBgm: (trackUrl, durationMs) => audioService.transitionToBgm(trackUrl, durationMs),
      playSceneBgm: (scene, durationMs) => playSceneBgm(scene, durationMs),
    },
    expressions: getExpressionAssetResolver({ className: 'CombatExpressionResolver' }),
    playerState: playerStateService,
    inventory: inventoryService,
    worldState: worldStateService,
    worldGen: worldGenSeedingService,
    combatLog: getCombatLogService({ className: 'CombatLogService' }),
    statusEffects: getStatusEffectsService({ className: 'StatusEffectsService' }),
  });
