// apps/frontend/client/src/lib/services/game/bridge_listeners.ts
//
// Thin wiring — translates engine bridge events into domain service calls.
// No direct state mutation. Every interaction goes through a service method.

import type { EngineBridge } from '@aikami/frontend/engine';
import { audioService } from '$lib/services/audio/audio_service.svelte';
import { combatService } from './combat_service.svelte';
import { gameEngineService } from './game_engine_service.svelte';
import { gameOverlayService } from './game_overlay_service.svelte';
import { npcDialogueService } from './npc_dialogue_service.svelte';
import { timeService } from './time_service.svelte';

export const setupBridgeListeners = async (): Promise<void> => {
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
      setOverlay: (type) => {
        gameOverlayService.setActive(type);
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

  bridge.on('INVENTORY_UPDATED', (event) => {
    const newCount = event.inventory.reduce((sum, item) => sum + item.quantity, 0);
    gameOverlayService.onInventoryCountChange(newCount);
  });

  bridge.on('COMBAT_ENDED', (event) => {
    if (gameOverlayService.activeOverlay === 'COMBAT') {
      if (event.victory) {
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
};
