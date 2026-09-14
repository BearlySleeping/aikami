// apps/frontend/client/src/lib/views/combat/combat_composition.ts
//
// Production wiring for the combat feature. This is the only module in the
// feature that imports the `$services` barrel; the ViewModel receives its
// dependencies as typed capabilities, so unit tests never touch the global
// service registry.

import { featureFlags } from '@aikami/frontend/configs';
import { resolveCompanionControlMode } from '@aikami/schemas';
import {
  audioService,
  diceService,
  getCombatAiService,
  getCombatIntentService,
  getCombatNarrationService,
  getExpressionAssetResolver,
  getTracksByMood,
  imageGenerationService,
  inventoryService,
  partyRosterService,
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
): CombatViewModelInterface => {
  // The intent interpreter is a latency-sensitive structured call pinned to the
  // `combat-intent` task preset (tight token/temperature budget). It is created
  // here, per encounter, so the ViewModel receives a typed capability instead of
  // reaching into the service registry.
  const intentService = getCombatIntentService({
    className: 'CombatIntentService',
    text: {
      extractStructure: (request) =>
        textGenerationService.extractStructure({ ...request, task: 'combat-intent' }),
    },
  });

  // C-526 AC-11: the outcome narrator is a prose-only capability. One
  // `PUBLIC_COMBAT_LLM_AGENTS` flag (default off) gates it; with the flag off
  // `enabled` is false and the ViewModel keeps the authored templates as the
  // single narration path, so no provider call is ever made.
  const llmAgentsEnabled = featureFlags.combatLlmAgents;
  const narrationService = getCombatNarrationService({
    className: 'CombatNarrationService',
    enabled: llmAgentsEnabled,
    text: {
      extractStructure: (request) =>
        textGenerationService.extractStructure({ ...request, task: 'combat-narration' }),
    },
  });

  // C-526 AC-3/AC-5: the AI decision service is the model half of the v2 AI
  // turn. The engine defers each AI actor's turn, and the ViewModel's AI
  // controller answers with a prefetched decision or the deterministic
  // fallback. Gated by the same pinned flag as the narrator.
  const aiDecisionService = getCombatAiService({
    className: 'CombatAiService',
    text: {
      extractStructure: (request) =>
        textGenerationService.extractStructure({ ...request, task: 'combat-ai' }),
    },
  });

  return createCombatViewModel({
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
    intent: {
      enabled: featureFlags.combatLanguageInput,
      interpretWithFallback: (request) => intentService.interpretWithFallback(request),
      cancel: (requestId) => intentService.cancel(requestId),
    },
    narration: {
      enabled: llmAgentsEnabled,
      narrate: (request) => narrationService.narrate(request),
      cancelAll: () => narrationService.cancelAll(),
    },
    // C-526 AC-6: the companion control surface. The PARTY ROSTER owns the
    // preference (it is saved with the campaign), so the ViewModel reads and
    // writes through this seam and never duplicates persistence.
    companions: {
      isCompanion: (combatantId) => partyRosterService.getMember(combatantId) !== undefined,
      list: () =>
        partyRosterService.members.map((member) => ({
          combatantId: member.npcId,
          name: member.name,
        })),
      modeFor: (combatantId) => {
        const member = partyRosterService.getMember(combatantId);
        return member === undefined ? 'suggest' : resolveCompanionControlMode(member);
      },
      intentFor: (combatantId) => partyRosterService.getStandingIntent(combatantId),
      persist: (change) => {
        partyRosterService.setControlMode({
          npcId: change.combatantId,
          mode: change.mode,
          intent: change.intent,
        });
      },
    },
    aiTurns: {
      enabled: llmAgentsEnabled,
      decide: (request) => aiDecisionService.decide(request),
      decideBatch: (requests) => aiDecisionService.decideBatch(requests),
      cancel: (decisionId) => aiDecisionService.cancel(decisionId),
      cancelAll: () => aiDecisionService.cancelAll(),
    },
  });
};
