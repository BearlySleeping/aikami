// apps/frontend/client/src/lib/services/game/bridge_listeners.ts
//
// Thin wiring — translates engine bridge events into domain service calls.
// No direct state mutation. Every interaction goes through a service method.
//
// Contract: C-314 AC-5 — services accepted as parameters, not imported as singletons.

import type { EngineBridge } from '@aikami/frontend/engine';
import type { AudioServiceInterface } from '$lib/services/audio/audio_service.svelte';
import type { CombatServiceInterface } from './combat_service.svelte';
import type { GameEngineServiceInterface } from './game_engine_service.svelte';
import type { GameOverlayServiceInterface } from './game_overlay_service.svelte';
import type { InputActionServiceInterface } from './input_action_service.svelte.ts';
import type { NpcDialogueServiceInterface } from './npc_dialogue_service.svelte';
import type { OnboardingHintServiceInterface } from './onboarding_hint_service.svelte.ts';
import type { TimeServiceInterface } from './time_service.svelte';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SetupBridgeListenersParams = {
  gameOverlayService: GameOverlayServiceInterface;
  npcDialogueService: NpcDialogueServiceInterface;
  gameEngineService: GameEngineServiceInterface;
  combatService: CombatServiceInterface;
  timeService: TimeServiceInterface;
  audioService: AudioServiceInterface;
  inputActionService: InputActionServiceInterface;
  onboardingHintService: OnboardingHintServiceInterface;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export const setupBridgeListeners = async (params: SetupBridgeListenersParams): Promise<void> => {
  const {
    gameOverlayService,
    npcDialogueService,
    gameEngineService,
    combatService,
    timeService,
    audioService,
    inputActionService,
    onboardingHintService,
  } = params;

  const { createEngineBridge } = await import('@aikami/frontend/engine');
  const bridge: EngineBridge = createEngineBridge();
  gameOverlayService.setBridge(bridge);

  // ── Dialogue ──

  bridge.on('NPC_INTERACTED', (event) => {
    if (gameOverlayService.activeOverlay !== 'NONE') {
      return;
    }
    npcDialogueService.startDialogue({
      npcData: {
        npcId: event.npcId,
        npcName: event.npcName,
        dialog: event.dialog,
        personaId: event.personaId,
      },
      setOverlay: (type: string) => {
        gameOverlayService.setActive(type as 'DIALOGUE');
      },
      pauseEngine: () => gameEngineService.pauseEngine(),
    });
  });

  bridge.on('NPC_DIALOG_END', () => {
    if (gameOverlayService.activeOverlay === 'DIALOGUE') {
      npcDialogueService.endDialogue({
        clearOverlay: () => gameOverlayService.clearActive(),
        resumeEngine: () => gameEngineService.resumeEngine(),
      });
    }
  });

  bridge.on('CAMERA_ZOOM_UPDATE', (event) => {
    gameOverlayService.setCameraZoom({
      npcScreenX: event.npcScreenX,
      npcScreenY: event.npcScreenY,
    });
  });

  // ── Vendor ──

  bridge.on('VENDOR_INTERACTED', (event) => {
    if (gameOverlayService.activeOverlay !== 'NONE') {
      return;
    }
    gameOverlayService.openVendor({
      vendorId: event.npcId,
      vendorName: event.npcName,
      vendorInventory: event.vendorInventory,
    });
  });

  // ── Environment ──

  bridge.on('ENVIRONMENT_UPDATED', (event) => {
    timeService.updateEnvironment({
      gameHour: event.gameHour,
      gameMinute: event.gameMinute,
      windVelocity: event.windVelocity,
      rainIntensity: event.rainIntensity,
    });
  });

  // ── Zone Transitions ──

  bridge.on('ZONE_TRIGGERED', (event) => {
    gameOverlayService.setTransitioning(true);
    audioService.stopAll();
    void gameEngineService.loadMap({
      mapUrl: event.targetMap,
      targetX: event.targetX,
      targetY: event.targetY,
      defeatedEnemies: gameOverlayService.getDefeatedEnemies(),
      collectedPickups: gameOverlayService.getCollectedPickups(),
      targetSpawnHash: event.targetSpawnHash,
    });
  });

  bridge.on('GAME_READY', () => {
    gameOverlayService.setTransitioning(false);
    void audioService.transitionToBgm('/assets/audio/music/bgm_explore.webm');
  });

  bridge.on('MAP_LOADED', () => {
    gameOverlayService.setTransitioning(false);
    gameOverlayService.onMapLoaded();
    void audioService.transitionToBgm('/assets/audio/music/bgm_explore.webm');
  });

  // ── Combat ──

  // NOTE (C-331): the INVENTORY_UPDATED replace-array listener was removed —
  // pickups now flow as ITEM_PICKED_UP deltas handled by inventoryService,
  // which triggers the pickup SFX via gameOverlayService.onInventoryCountChange.

  bridge.on('COMBAT_STARTED', (event) => {
    if (
      gameOverlayService.activeOverlay !== 'NONE' &&
      gameOverlayService.activeOverlay !== 'COMBAT'
    ) {
      return;
    }
    combatService.startCombat({
      enemyName: event.enemyName ?? 'Unknown Enemy',
      enemyHp: event.enemyHp ?? 80,
      enemyMaxHp: event.enemyMaxHp ?? 80,
      participantIds: event.participantIds,
      firstTurnEntityId: event.firstTurnEntityId,
      combatSeed: event.combatSeed,
      encounterId: event.encounterId,
      allowNonCombatResolution: event.allowNonCombatResolution,
      setActive: (overlay) => {
        gameOverlayService.setActive(overlay);
      },
    });
    void audioService.transitionToBgm('/assets/audio/music/bgm_combat.webm');
  });

  bridge.on('COMBAT_LOG', (event) => {
    if (event.message.includes('Hits for')) {
      void audioService.playSfx('/assets/audio/sfx/sfx_hit.wav');
    }
  });

  bridge.on('COMBAT_ENDED', (event) => {
    if (gameOverlayService.activeOverlay === 'COMBAT') {
      if (event.victory) {
        // Emit ENCOUNTER_COMPLETED for quest tracking (C-330 AC-4)
        const encounterId = combatService.encounterId;
        if (encounterId) {
          bridge.emit({ type: 'ENCOUNTER_COMPLETED', encounterId, victory: true });
        }
        setTimeout(() => {
          gameOverlayService.clearActive();
          void audioService.transitionToBgm('/assets/audio/music/bgm_explore.webm');
          gameEngineService.resumeEngine();
        }, 2500);
      } else {
        gameOverlayService.setActive('GAME_OVER');
      }
    }
  });

  // ── C-327 AC-2: Interaction proximity ──

  bridge.on('INTERACTION_TARGET_CHANGED', (event) => {
    if (event.targetEntityId !== undefined && event.targetName && event.targetType) {
      // Store target metadata so the display label can react to device/binding changes.
      // The prompt ViewModel/GUI derives the label from inputActionService.actionDisplayLabel()
      // whenever the prompt is rendered or device/bindings change.
      const verb = event.targetType === 'npc' ? 'Talk to' : 'Pick up';
      const keyLabel = inputActionService.actionDisplayLabel('interact');
      gameOverlayService.setInteractionPrompt({
        label: `${keyLabel} — ${verb} ${event.targetName}`,
        visible: true,
        targetMetadata: { verb, targetName: event.targetName },
      });
    } else {
      gameOverlayService.setInteractionPrompt({
        label: '',
        visible: false,
        targetMetadata: { verb: '', targetName: '' },
      });
    }

    // Forward target changes to the onboarding service for near_interactable hints
    if (event.targetEntityId !== undefined) {
      onboardingHintService.onInteractionTargetChanged();
    }
  });

  // ── C-327 AC-5: Gamepad polling via UI rAF ──
  // Gamepad is polled externally via the game_ui_view_model frame loop
};
