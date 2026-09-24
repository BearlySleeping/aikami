// apps/frontend/client/src/lib/services/game/bridge_listeners.ts
//
// Thin wiring — translates engine bridge events into domain service calls.
// No direct state mutation. Every interaction goes through a service method.
//
// Contract: C-314 AC-5 — services accepted as parameters, not imported as singletons.

import type { EngineBridge } from '@aikami/frontend/engine';
import { logger } from '$logger';

/**
 * The presentation identity for one encounter run (review F9).
 *
 * Prefers the ENGINE's execution-run identity, which is what distinguishes a
 * retry from the attempt it replaced; falls back to the authored encounter id
 * only for a legacy encounter that reports none.
 */
const presentationIdentityFor = (encounterId?: string | null, runId?: string): string =>
  runId !== undefined && runId.length > 0 ? runId : `encounter:${encounterId ?? 'unknown'}`;

/**
 * The durable identity for one settlement's consequences (review F7/F9).
 *
 * The kernel's `settlementId` binds encounter + execution run + revision +
 * reason. A legacy encounter that reports no settlement falls back to the
 * presentation identity so duplicate terminal delivery is still deduplicated
 * within one run.
 */
const settlementIdentityFor = (
  event: { settlement?: { settlementId: string }; encounterRunId?: string },
  encounterId: string | undefined,
): string =>
  event.settlement?.settlementId ?? presentationIdentityFor(encounterId, event.encounterRunId);

import type { AudioServiceInterface } from '$services';
import {
  playSceneBgm,
  playSfxByName,
  setActiveAudioCueContext,
} from '../audio/audio_asset_resolver';
import type { ContextualTriggerServiceInterface } from '../image/contextual_trigger_service.svelte.ts';
// Direct singletons (like combatSettlementLedger): background memory prefetch
// needs no injection seam and must not grow the overlay service's wiring.
import { npcAwarenessService } from '../npc/npc_awareness_service.svelte.ts';
import { npcMemoryService } from '../npc/npc_memory_service.svelte.ts';
import type { CombatServiceInterface } from './combat_service.svelte';
import { combatSettlementLedger } from './combat_settlement_ledger.svelte.ts';
import type { GameEngineServiceInterface } from './game_engine_service.svelte';
import type { GameOverlayServiceInterface } from './game_overlay_service.svelte';
import type { InputActionServiceInterface } from './input_action_service.svelte.ts';
import type { NpcDialogueServiceInterface } from './npc_dialogue_service.svelte';
import type { OnboardingHintServiceInterface } from './onboarding_hint_service.svelte.ts';
import type { PartyFollowServiceInterface } from './party_follow_service.svelte.ts';
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
  partyFollowService: PartyFollowServiceInterface;
  /**
   * C-512: fires contextual generation on the first interaction with an NPC.
   * Optional so dev harnesses without the image stack can still wire listeners;
   * production passes the singleton.
   */
  contextualTriggerService?: ContextualTriggerServiceInterface;
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
    partyFollowService,
    contextualTriggerService,
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

    // C-512 AC-2: first interaction with an NPC queues a portrait generation.
    // Fire-and-forget — `fireTrigger` resolves without awaiting generation, so
    // dialogue starts immediately even while the engine is still rendering.
    void contextualTriggerService
      ?.fireTrigger({
        event: 'npc_introduced',
        context: `${event.npcName} — ${event.personaId ?? 'npc'} dialogue portrait`,
        characterName: event.npcName,
        npcId: event.npcId,
      })
      .catch(() => undefined);

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
    partyFollowService.start();
    // C-523: authored audio cues are resolved against the pack + map the game
    // is actually in, so announce it before the scene cue is requested.
    setActiveAudioCueContext({
      packId: gameEngineService.contentPackId,
      mapId: gameEngineService.currentMapId,
    });
    void playSceneBgm('explore');
  });

  bridge.on('MAP_LOADED', () => {
    gameOverlayService.setTransitioning(false);
    gameOverlayService.onMapLoaded();
    partyFollowService.onMapLoaded();
    // Warm returning-greeting openers for remembered NPCs on this map.
    npcMemoryService.prefetchForNpcs(npcAwarenessService.nearbyNpcIds);
    setActiveAudioCueContext({
      packId: gameEngineService.contentPackId,
      mapId: gameEngineService.currentMapId,
    });
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
    // Review F9: the presentation now belongs to THIS run. A delayed callback
    // scheduled by a previous encounter is inert from here on.
    combatSettlementLedger.begin(presentationIdentityFor(event.encounterId, event.encounterRunId));
    combatService.startCombat({
      enemyName: event.enemyName ?? 'Unknown Enemy',
      // No invented HP: the legacy funnel reports the enemy's HP on the event,
      // the v2 funnel reports it through COMBAT_STATE_UPDATE (which the driver
      // and the sync snapshot both emit). A placeholder here showed an 80-HP
      // enemy in a 20-HP fight.
      enemyHp: event.enemyHp ?? 0,
      enemyMaxHp: event.enemyMaxHp ?? 0,
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

  // ── C-516: the engine could not start the encounter at all ──
  // The overlay is opened optimistically before the start command, so a
  // rejection must close it again — otherwise the player sits in a dead,
  // unplayable fight (AC-2 / Edge Cases / Migration & Rollback).
  bridge.on('COMBAT_START_REJECTED', (event) => {
    logger.warn('[bridge_listeners] combat start rejected', {
      encounterId: event.encounterId,
      reasonCode: event.reasonCode,
      messageKey: event.messageKey,
    });
    if (gameOverlayService.activeOverlay === 'COMBAT') {
      // No `COMBAT_STARTED` arrived for this command, so the combat service was
      // never seeded: clearing the stack is enough, and it restores EXPLORE
      // input (the engine was paused when the overlay opened).
      gameOverlayService.closeCombat();
    }
  });

  bridge.on('COMBAT_LOG', (event) => {
    if (event.message.includes('Hits for')) {
      void playSfxByName('sfx_hit');
    }
  });

  bridge.on('COMBAT_ENDED', (event) => {
    if (gameOverlayService.activeOverlay === 'COMBAT') {
      if (event.victory) {
        // ── Review F7/F9: EXACTLY-ONCE consequences ─────────────────────────
        //
        // The engine may deliver the terminal event more than once (a duplicate
        // publication, a reload re-presenting it, a retry's delayed callback).
        // The claim is keyed on the kernel's `settlementId`, which binds the
        // authored encounter, the EXECUTION RUN, the committed revision and the
        // settlement reason — never the encounter id alone (it recurs on retry)
        // and never the state revision alone (it recurs across runs).
        const settlementIdentity = settlementIdentityFor(
          event,
          combatService.encounterId ?? undefined,
        );
        const presentationIdentity = combatSettlementLedger.activeIdentity();
        const firstDelivery = combatSettlementLedger.claim(settlementIdentity);

        if (firstDelivery) {
          // C-422 AC-4: Notify onboarding of combat step completion
          onboardingHintService.onEventPerformed('combat_ended');

          // Emit ENCOUNTER_COMPLETED for quest tracking (C-330 AC-4). Emitted
          // only on the FIRST delivery, so a duplicate terminal event cannot
          // double-count quest progress.
          const encounterId = combatService.encounterId;
          if (encounterId) {
            bridge.emit({ type: 'ENCOUNTER_COMPLETED', encounterId, victory: true });
          }
        } else {
          logger.debug('combat:settlement-already-applied', { settlementIdentity });
        }

        // Run-scoped delayed close: it must act only while the encounter it
        // belongs to is still the presented one. Encounter A ending, encounter B
        // starting and A's timer firing must NOT close B's overlay.
        const closeIdentity = presentationIdentity ?? settlementIdentity;
        setTimeout(() => {
          if (!combatSettlementLedger.isActive(closeIdentity)) {
            // A replacement encounter owns the presentation now: this callback is
            // stale and must not close it.
            logger.debug('combat:stale-close-callback-dropped', { closeIdentity });
            return;
          }
          // closeCombat clears the stack, returns to EXPLORE, and resumes the
          // engine exactly once (C-500) — the engine was paused on entry, so
          // clearing the overlay alone would leave the world input-locked.
          combatSettlementLedger.end();
          gameOverlayService.closeCombat();
          void playSceneBgm('explore');
        }, 2500);
      } else {
        // A defeat keeps the presentation: the game-over surface owns it and the
        // run guard stays until that surface is dismissed.
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

    // Approaching a remembered NPC: refresh a stale opener before they talk.
    if (event.targetType === 'npc' && event.targetName) {
      npcMemoryService.prefetchByName(event.targetName);
    }
  });

  // ── C-327 AC-5: Gamepad polling via UI rAF ──
  // Gamepad is polled externally via the game_ui_view_model frame loop
};
