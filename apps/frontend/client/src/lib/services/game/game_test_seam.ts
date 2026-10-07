// apps/frontend/client/src/lib/services/game/game_test_seam.ts
//
// Non-production test seam (C-495 AC-6, C-500, C-514, C-516 AC-10).
//
// Installs `window.__AIKAMI_TEST__` ONLY when `getPublicMode() !== 'production'`.
// Every probe drives the PRODUCTION path — discovery, derivation, validation,
// precondition and command execution are unchanged; only the *trigger* (an AI
// provider, a dialogue chip, a pointer) is replaced by a direct call.
//
// Extracted from `game_composition_root.svelte.ts` so the composition root stays
// inside the source-file-size hard limit. It is a single cohesive
// responsibility with no production consumer, and it is the only module allowed
// to name `__AIKAMI_TEST__`. Its own size pressure is answered by sibling
// probe modules rather than by a waiver: text generation, dialogue/memory and
// the authored-encounter lifecycle each live in their own file, and this module
// composes them.
//
// The engine is deliberately NOT imported here: the composition root loads
// `@aikami/frontend/engine` dynamically to keep the boot chunk small, so
// `createEngineBridge`/`djb2Hash` arrive as options instead of pulling the
// engine back into a static import graph.
//
// Contract: C-495 AC-6, C-500, C-514, C-516 AC-10

import { getPublicMode } from '@aikami/frontend/configs';
import type { EngineBridge } from '@aikami/frontend/engine';
// Type-only: erased at build time, so this never pulls the (dynamically
// imported) engine back into a static import graph.
import type { ContentPackLoaderInterface } from '@aikami/frontend/engine/sim';
import { getActiveAudioCue } from '../audio/audio_asset_resolver.ts';
import { equipmentService } from './equipment_service.svelte.ts';
import type { GameEngineServiceInterface } from './game_engine_service.svelte';
import type { GameModeServiceInterface } from './game_mode_service.svelte';
import type { GameOverlayServiceInterface } from './game_overlay_service.svelte';
import {
  prepareNpcPrefetchProbe,
  runDialogueTurnProbe,
  runNpcPrefetchBurstProbe,
} from './game_test_seam_dialogue_probes.ts';
import { createEncounterProbes } from './game_test_seam_encounter_probes.ts';
import {
  readResolvedTextRouting,
  readTextTelemetry,
  runStructuredBatchBenchmark,
} from './game_test_seam_text_probes.ts';
import { inventoryService } from './inventory_service.svelte.ts';
import type { NpcDialogueServiceInterface } from './npc_dialogue_service.svelte';
import { playerJournalService } from './player_journal_service.svelte.ts';
import type { PlayerStateServiceInterface } from './player_state_service.svelte';
import {
  questStateService as productionQuestStateService,
  type QuestStateServiceInterface,
} from './quest_state_service.svelte';

/** Clears authored quest evidence without detaching production bridge listeners. */
const clearManagementQuestState = (): void => {
  productionQuestStateService.hydrate({
    schemaVersion: 1,
    activeQuests: [],
    completedQuestIds: [],
    completedQuests: [],
    failedQuestIds: [],
    declinedQuestIds: [],
    worldStateFlags: {},
    repeatableCompletions: {},
    journalEntries: [],
  });
};

/** Clears campaign-scoped journal rows through the production CRUD path. */
const clearPlayerJournalEntries = async (campaignId: string): Promise<void> => {
  await playerJournalService.loadEntries({ campaignId });
  for (const entry of [...playerJournalService.entries]) {
    await playerJournalService.deleteEntry({ id: entry.id });
  }
};

/** Populates the real inventory, equipment, quest and journal stores for review. */
const populateManagementStores = async (options: {
  readonly campaignId: string;
}): Promise<{
  inventoryCount: number;
  equippedCount: number;
  questCount: number;
  noteCount: number;
}> => {
  inventoryService.hydrate({
    items: [
      { itemId: 'steelSword', quantity: 1 },
      { itemId: 'healthPotion', quantity: 3 },
      { itemId: 'manaPotion', quantity: 2 },
      { itemId: 'wardWand', quantity: 1 },
    ],
    gold: 640,
  });
  equipmentService.hydrate({
    slots: {
      rightHand: 'ironSword',
      body: 'ironArmor',
      leftHand: 'woodenShield',
    },
  });
  clearManagementQuestState();
  productionQuestStateService.acceptQuest({ questId: 'fading_ward', npcId: 'village_elder' });
  await clearPlayerJournalEntries(options.campaignId);
  await playerJournalService.createEntry({
    campaignId: options.campaignId,
    sessionNumber: 1,
    title: 'Inn lead',
    content: 'Sella keeps the inn ledger. The wand was delivered there before the disappearance.',
    tags: ['inn'],
  });
  await playerJournalService.createEntry({
    campaignId: options.campaignId,
    sessionNumber: 1,
    title: 'Watch the eastern ward',
    content: 'The eastern lantern flickers after dusk. Ask the elder which path feels wrong.',
    tags: ['ward', 'clue'],
  });
  await playerJournalService.loadEntries({ campaignId: options.campaignId });
  return {
    inventoryCount: inventoryService.inventory.length,
    equippedCount: equipmentService.equippedItems.length,
    questCount: productionQuestStateService.quests.length,
    noteCount: playerJournalService.entries.length,
  };
};

/**
 * Everything the seam drives — all of it production, none of it replaced.
 *
 * Deliberately module-private: the composition root is the only caller and it
 * passes an object literal, so exporting the shape would only add unused
 * public surface (guard-orphaned-capability).
 */
type GameTestSeamOptions = {
  /** Unsubscribers owned by the composition root; the seam adds its own. */
  bridgeUnsubscribers: Array<() => void>;
  contentPack: ContentPackLoaderInterface;
  gameEngineService: GameEngineServiceInterface;
  gameModeService: GameModeServiceInterface;
  gameOverlayService: GameOverlayServiceInterface;
  npcDialogueService: NpcDialogueServiceInterface;
  playerStateService: PlayerStateServiceInterface;
  questStateService: QuestStateServiceInterface;
  /** The engine's own bridge factory (dynamic import in the caller). */
  createEngineBridge: () => EngineBridge;
  /** Deterministic encounter seed derivation (dynamic import in the caller). */
  djb2Hash: (value: string) => number;
  /** Diagnostics sink for a seam that failed to install. */
  warn: (label: string, detail: Record<string, unknown>) => void;
  /** Active campaign identity used to scope persisted journal evidence. */
  activeCampaignId: () => string | undefined;
};

/**
 * Installs the seam, or does nothing in production or outside a browser.
 *
 * Failures are reported, never thrown: a broken probe must not be able to stop
 * the boot pipeline.
 */
export const installGameTestSeam = (deps: GameTestSeamOptions): void => {
  if (getPublicMode() === 'production' || typeof window === 'undefined') {
    return;
  }

  const {
    bridgeUnsubscribers,
    contentPack,
    createEngineBridge,
    djb2Hash,
    gameEngineService,
    gameModeService,
    gameOverlayService,
    npcDialogueService,
    playerStateService,
    questStateService,
    warn,
    activeCampaignId,
  } = deps;

  try {
    let combatCleanupResumeCount = 0;
    let combatCleanupResumeBaseline = 0;
    let combatEndTurnDispatchCount = 0;
    let startedEncounter:
      | {
          encounterId?: string | null;
          participantIds: number[];
          enemyName?: string;
          engine?: string;
        }
      | undefined;
    // C-531: flipped by MAP_LOADED — see `isMapReady` below.
    let mapLoaded = false;
    const testBridge = createEngineBridge();
    bridgeUnsubscribers.push(
      testBridge.on('COMBAT_STARTED', (event) => {
        startedEncounter = {
          encounterId: event.encounterId,
          participantIds: [...event.participantIds],
          enemyName: event.enemyName,
          engine: event.engine,
        };
      }),
    );
    bridgeUnsubscribers.push(
      testBridge.onCommand('COMBAT_END_TURN', () => {
        combatEndTurnDispatchCount += 1;
      }),
    );
    // C-531: the map-ready gate. `MAP_LOADED` is emitted on the same singleton
    // bridge after every load, so this flips exactly when the player's world
    // is loaded — never earlier (see `isMapReady` below).
    bridgeUnsubscribers.push(
      testBridge.on('MAP_LOADED', () => {
        mapLoaded = true;
      }),
    );
    const resumeEngine = gameEngineService.resumeEngine.bind(gameEngineService);
    gameEngineService.resumeEngine = (): void => {
      combatCleanupResumeCount += 1;
      resumeEngine();
    };
    // C-516/C-525/C-526/C-531 authored-encounter probes. Built here because they
    // share the seam's live combat counters (the cleanup baseline) with
    // `getCombatCleanupResumeCount` below.
    const encounterProbes = createEncounterProbes({
      contentPack,
      djb2Hash,
      gameEngineService,
      gameOverlayService,
      playerStateService,
      warn,
      markCombatTurnStart: () => {
        combatCleanupResumeBaseline = combatCleanupResumeCount;
      },
    });
    Object.assign(window, {
      // biome-ignore lint/style/useNamingConvention: __AIKAMI_TEST__ is the fixed key the release-gate E2E reads back
      __AIKAMI_TEST__: {
        ...encounterProbes,
        triggerAutoSave: async (): Promise<void> => {
          await gameOverlayService.triggerAutoSave();
        },
        // Deterministic authored opening/chip only. The real dialogue VM,
        // action dispatch, close lifecycle and device recorder remain intact.
        openJournalRecapDialogue: (): void => {
          npcDialogueService.startDialogue({
            npcData: {
              npcId: 'rollo_grasper',
              npcName: 'Rollo the Grasper',
              dialog: 'There is a tavern near the road.',
              initialSuggestions: [
                {
                  id: 'recap_attack',
                  label: 'Attack',
                  intentType: 'combat',
                  prefillText: 'I draw my weapon.',
                },
              ],
            },
            setOverlay: () => gameOverlayService.setActive('DIALOGUE'),
            pauseEngine: () => gameEngineService.pauseEngine(),
          });
        },
        seedManagementContent: async (options: { scenario: 'empty' | 'populated' }) => {
          const campaignId = activeCampaignId();
          if (!campaignId) {
            throw new Error('Management evidence requires an active campaign');
          }
          inventoryService.reset();
          equipmentService.reset();
          clearManagementQuestState();
          if (options.scenario === 'empty') {
            await clearPlayerJournalEntries(campaignId);
            playerJournalService.reset();
            return {
              inventoryCount: 0,
              equippedCount: 0,
              questCount: 0,
              noteCount: 0,
            };
          }
          return await populateManagementStores({ campaignId });
        },
        discoverEvidenceAt: (location: string): string[] =>
          questStateService.discoverEvidenceAt(location),
        presentEvidence: (options: {
          npcId: string;
          evidenceId: string;
        }): { commandAvailable: boolean; flagSet: boolean } => {
          const command = {
            kind: 'presentEvidence' as const,
            evidenceId: options.evidenceId,
          };
          const commandAvailable = npcDialogueService
            .deriveAllowedCommands(options.npcId)
            .includes(command.kind);
          const flagSet =
            commandAvailable &&
            npcDialogueService.executeCommand({
              kind: command.kind,
              npcId: options.npcId,
              npcName: contentPack.getNpc(options.npcId)?.name ?? 'Unknown',
              command,
            });
          return { commandAvailable, flagSet };
        },
        // C-495 AC-3/AC-6 test seam: the explicit ending choice. Evidence
        // presentation UNLOCKS a conditioned ending; only this call commits
        // one. The AC-6 journey asserts the unlock does not auto-select and
        // that a chosen ending survives a reload.
        getEligibleEndings: (
          questId: string,
        ): Array<{
          id: string;
          title: string;
          unlocked: boolean;
        }> => questStateService.getEligibleEndings(questId),
        chooseEnding: (options: { questId: string; endingId: string }): boolean =>
          questStateService.chooseEnding(options),
        // C-500 test seam: drive combat through the production overlay
        // entry/exit path without depending on the AI-generated dialogue
        // chip that normally starts it. Used by
        // apps/e2e/tests/client/combat.spec.ts to prove the combat UI
        // mounts and exits cleanly. Gated to non-production above.
        startCombat: (options: { enemyName: string; enemyNpcId?: string }): void => {
          combatCleanupResumeBaseline = combatCleanupResumeCount;
          gameOverlayService.startCombat(options);
        },
        // Only the conversation opener is deterministic; the chip, executor,
        // content-pack projection and worker start are all production code.
        openCombatDialogue: (npcId: string): void => {
          const npc = contentPack.getNpc(npcId);
          if (!npc) {
            return;
          }
          npcDialogueService.startDialogue({
            npcData: {
              npcId,
              npcName: npc.name,
              dialog: 'Hands off!',
              initialSuggestions: [
                {
                  id: 'fight_back_punch',
                  label: 'Fight back',
                  intentType: 'combat',
                  prefillText: 'Fight back',
                },
              ],
            },
            setOverlay: () => gameOverlayService.setActive('DIALOGUE'),
            pauseEngine: () => gameEngineService.pauseEngine(),
          });
        },
        getStartedEncounter: () => startedEncounter,
        getCombatEndTurnDispatchCount: (): number => combatEndTurnDispatchCount,
        scheduleCombatEndedCleanup: (): void => {
          testBridge.emit({ type: 'COMBAT_ENDED', victory: true });
        },
        // C-514 test seam: drive the production combat ViewModel through
        // the real engine bridge with the turn/budget events the worker
        // emits (TURN_CHANGED → ACTION_ECONOMY_CHANGED). Used by
        // apps/e2e/tests/client/combat.spec.ts to prove the four-budget
        // readout and the explicit End Turn control are wired in the
        // production overlay. The events are the production shapes; only
        // their origin (the ECS worker) is stubbed here.
        emitCombatTurn: (options: {
          currentEntityId: number;
          activeEntities: number[];
          actionEconomy: {
            movementRemaining: number;
            actionAvailable: boolean;
            quickActionAvailable: boolean;
            bonusActionAvailable: boolean;
            reactionAvailable: boolean;
          };
        }): void => {
          testBridge.emit({
            type: 'TURN_CHANGED',
            currentEntityId: options.currentEntityId,
            activeEntities: options.activeEntities,
          });
          testBridge.emit({
            type: 'ACTION_ECONOMY_CHANGED',
            entityId: options.currentEntityId,
            ...options.actionEconomy,
          });
        },
        dismissCombat: (): void => {
          gameOverlayService.closeCombat();
        },
        /**
         * C-523 AC-2/AC-5 probe: loads one of the loaded pack's maps through the
         * production `loadMap` path, so the visual and E2E lanes can reach all
         * five Emberwatch maps without walking the portal graph.
         *
         * Nothing is stubbed — `resolveMapUrl` + `loadMap` are exactly what the
         * portal handler calls; only the trigger is direct.
         */
        loadPackMap: async (options: {
          mapId: string;
          /** Optional landmark coordinate to spawn at instead of the default. */
          nearX?: number;
          nearY?: number;
        }): Promise<boolean> => {
          const entry = contentPack.manifest.maps[options.mapId];
          if (entry === undefined) {
            warn('loadPackMap:unknown-map', { mapId: options.mapId });
            return false;
          }
          const mapUrl = contentPack.resolveMapUrl(options.mapId);
          // The portal handler passes the *portal's* target coordinates. A
          // direct load has none, so use the map's own authored fallback —
          // passing (0, 0) would strand the player in an arbitrary corner and
          // make every capture a picture of empty ground.
          //
          // `nearX`/`nearY` place the camera on a specific authored object (a
          // landmark) for a review capture; the named default spawn is skipped
          // in that case, since a spawn point would override the coordinates.
          const atLandmark = options.nearX !== undefined && options.nearY !== undefined;
          // `MAP_LOADED` is a reusable event, so readiness from the previous map
          // must not satisfy a later load. The next event flips this back only
          // after the requested map has completed its load boundary.
          mapLoaded = false;
          await gameEngineService.loadMap({
            mapUrl,
            targetX: options.nearX ?? entry.defaultX ?? 0,
            targetY: options.nearY ?? entry.defaultY ?? 0,
            ...(atLandmark || entry.defaultSpawnId === undefined
              ? {}
              : { defaultSpawnHash: djb2Hash(entry.defaultSpawnId) }),
          });
          return true;
        },
        /** C-523: the map the engine is actually on, for capture assertions. */
        getCurrentMapId: (): string => gameEngineService.currentMapId,
        /** Current active engine-buffer position, independent of debug publication. */
        getPlayerPosition: (): { x: number; y: number } | undefined =>
          gameEngineService.getPlayerPosition(),
        /**
         * C-523 AC-3 probe: the cue currently holding the audio arbitration
         * authority, so a lane can prove map cues and the DJ are serialized by
         * one authority rather than racing.
         */
        getActiveAudioCue: (): { source: string; context: string; authored: boolean } | null => {
          const active = getActiveAudioCue();
          if (active === undefined) {
            return null;
          }
          return { source: active.source, context: active.context, authored: active.authored };
        },
        /**
         * C-516 test seam: whether the GameWorld has registered its combat
         * command forwarders yet. A command sent before that is dropped by
         * design, so the E2E must wait for routability instead of assuming
         * the overlay being open means the engine can be commanded.
         */
        isCombatStartRoutable: (): boolean =>
          testBridge.hasCommandHandler('COMBAT_START_ENCOUNTER'),
        /**
         * C-531 test seam: whether the map the player is standing on has
         * finished loading. Routability (above) is satisfied as soon as the
         * GameWorld registers its forwarders — BEFORE `LOAD_MAP` resolves —
         * and a start command that arrives while the worker still has no
         * terrain is rejected `pathInvalid` and PERMANENTLY falls back to the
         * legacy engine for that encounter. Gating the E2E's start poll on
         * this flag is what keeps a fast first attempt from wedging the
         * proof journey into legacy.
         */
        isMapReady: (): boolean => mapLoaded,
        getCombatCleanupResumeCount: (): number =>
          combatCleanupResumeCount - combatCleanupResumeBaseline,
        getOverlayState: (): { overlay: string; mode: string } => ({
          overlay: gameOverlayService.activeOverlay,
          mode: gameModeService.currentMode,
        }),
        benchmarkIdenticalStructuredBatch: runStructuredBatchBenchmark,
        runDialogueTurn: runDialogueTurnProbe,
        prepareNpcPrefetch: prepareNpcPrefetchProbe,
        runNpcPrefetchBurst: runNpcPrefetchBurstProbe,
        getTextTelemetry: readTextTelemetry,
        getResolvedTextRouting: readResolvedTextRouting,
        /**
         * C-549 evidence seam: resolve authored NPC ids to the live entity ids
         * so a same-camera capture can assert which NPC state it photographed.
         */
        getNpcEntityIds: (): Record<string, number> =>
          Object.fromEntries(
            Object.keys(contentPack.manifest.npcs)
              .map((npcId) => [npcId, gameEngineService.getEntityIdForNpc(npcId)] as const)
              .filter((entry): entry is readonly [string, number] => entry[1] !== undefined),
          ),
      },
    });
  } catch (error) {
    warn('initialize:test-hook-failed', { error: String(error) });
  }
};
