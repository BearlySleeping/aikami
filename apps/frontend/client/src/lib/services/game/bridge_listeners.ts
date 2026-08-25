// apps/frontend/client/src/lib/services/game/bridge_listeners.ts
//
// Thin wiring — translates engine bridge events into domain service calls.
// No direct state mutation. Every interaction goes through a service method.
//
// Contract: C-314 AC-5 — services accepted as parameters, not imported as singletons.

import type { EngineBridge } from '@aikami/frontend/engine';
import type { AudioServiceInterface } from '$services';
import { playSceneBgm, playSfxByName } from '../audio/audio_asset_resolver';
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

    // C-422 AC-4: Notify onboarding of conversation step completion
    onboardingHintService.onEventPerformed('npc_dialogue_opened');

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
    void (async () => {
      // Transition zones reference maps by ID (e.g. 'inn'), but the engine
      // fetches maps by file URL. Resolve the ID through the active content
      // pack before loading — otherwise the raw ID resolves relative to the
      // current route and the SPA fallback returns HTML, breaking JSON parse.
      let mapUrl = event.targetMap;
      // defaultSpawnHash: the destination map's manifest `defaultSpawnId`
      // (e.g. 'village_gate'). The worker resolves it when the portal has no
      // targetSpawnId, so unpaired portals still land on the map's default.
      let defaultSpawnHash: number | undefined;
      try {
        const { loadContentPack, djb2Hash } = await import('@aikami/frontend/engine');
        const { assetTagResolver } = await import('$lib/services/assets/registry_resolver');
        const pack = await loadContentPack({
          packId: gameEngineService.contentPackId,
          resolveTag: assetTagResolver,
        });
        mapUrl = pack.resolveMapUrl(event.targetMap);
        const targetEntry = pack.manifest.maps[event.targetMap];
        if (targetEntry?.defaultSpawnId) {
          defaultSpawnHash = djb2Hash(targetEntry.defaultSpawnId);
        }
      } catch {
        // targetMap was already an absolute URL/path (or unknown map ID) —
        // fall back to passing it through; the engine surfaces fetch errors.
      }
      await gameEngineService.loadMap({
        mapUrl,
        targetX: event.targetX,
        targetY: event.targetY,
        defeatedEnemies: gameOverlayService.getDefeatedEnemies(),
        collectedPickups: gameOverlayService.getCollectedPickups(),
        interactableStates: gameOverlayService.getInteractableStates(),
        targetSpawnHash: event.targetSpawnHash,
        defaultSpawnHash,
      });
    })();
  });

  bridge.on('GAME_READY', () => {
    gameOverlayService.setTransitioning(false);
    void playSceneBgm('explore');
  });

  bridge.on('MAP_LOADED', () => {
    gameOverlayService.setTransitioning(false);
    gameOverlayService.onMapLoaded();
    void playSceneBgm('explore');
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
    void playSceneBgm('combat');
  });

  bridge.on('COMBAT_LOG', (event) => {
    if (event.message.includes('Hits for')) {
      void playSfxByName('sfx_hit');
    }
  });

  bridge.on('COMBAT_ENDED', (event) => {
    if (gameOverlayService.activeOverlay === 'COMBAT') {
      if (event.victory) {
        // C-422 AC-4: Notify onboarding of combat step completion
        onboardingHintService.onEventPerformed('combat_ended');

        // Emit ENCOUNTER_COMPLETED for quest tracking (C-330 AC-4)
        const encounterId = combatService.encounterId;
        if (encounterId) {
          bridge.emit({ type: 'ENCOUNTER_COMPLETED', encounterId, victory: true });
        }
        setTimeout(() => {
          gameOverlayService.clearActive();
          void playSceneBgm('explore');
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
        visible: gameOverlayService.activeOverlay === 'NONE',
        targetMetadata: { verb, targetName: event.targetName },
      });
    } else {
      gameOverlayService.setInteractionPrompt({
        label: '',
        visible: false,
        targetMetadata: undefined,
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
