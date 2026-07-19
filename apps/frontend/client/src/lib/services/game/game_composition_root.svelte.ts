// apps/frontend/client/src/lib/services/game/game_composition_root.svelte.ts
//
// GameCompositionRoot (C-314) — single owner of all game runtime services.
// Wires campaign service (C-313), game engine, overlay, session, and the
// five split game state services. Defines a clear initialize/dispose lifecycle.
//
// Contract: C-314 Establish a Production Game Composition Root and Split God Services
// Contract: C-326 Make Game Boot Atomic, Observable, and Content-Driven (campaign wiring)

import type { GameCommand } from '@aikami/frontend/engine';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { ContentPackLootEntry } from '@aikami/types';
import { aiGatewayService } from '../ai/ai_gateway_service.svelte';
import type { CampaignServiceInterface } from '../campaign/campaign_service.svelte';
import { campaignService } from '../campaign/campaign_service.svelte';
import { buildItemCatalogFromPack } from './content_pack_catalog';
import type { EquipmentServiceInterface } from './equipment_service.svelte';
import { equipmentService } from './equipment_service.svelte';
import type { GameEngineServiceInterface } from './game_engine_service.svelte';
import { gameEngineService } from './game_engine_service.svelte';
import type { GameModeServiceInterface } from './game_mode_service.svelte';
import { gameModeService } from './game_mode_service.svelte';
import type { GameOverlayServiceInterface } from './game_overlay_service.svelte';
import { gameOverlayService } from './game_overlay_service.svelte';
import type { InventoryServiceInterface } from './inventory_service.svelte';
import { inventoryService } from './inventory_service.svelte';
import type { NpcDialogueServiceInterface } from './npc_dialogue_service.svelte';
import { npcDialogueService } from './npc_dialogue_service.svelte';
import type { PartyRosterServiceInterface } from './party_roster_service.svelte.ts';
import { partyRosterService } from './party_roster_service.svelte.ts';
import type { PlayerStateServiceInterface } from './player_state_service.svelte';
import { playerStateService } from './player_state_service.svelte';
import type { QuestStateServiceInterface } from './quest_state_service.svelte';
import { questStateService } from './quest_state_service.svelte';
import type { SessionServiceInterface } from './session_service.svelte';
import { sessionService } from './session_service.svelte';
import { vendorService } from './vendor_service.svelte';
import type { WorldStateServiceInterface } from './world_state_service.svelte';
import { worldStateService } from './world_state_service.svelte';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GameCompositionRootOptions = BaseFrontendClassOptions & {
  uid: string;
};

export type GameCompositionRootInterface = BaseFrontendClassInterface & {
  readonly isInitialized: boolean;
  readonly campaignService: CampaignServiceInterface;
  readonly playerStateService: PlayerStateServiceInterface;
  readonly worldStateService: WorldStateServiceInterface;
  readonly questStateService: QuestStateServiceInterface;
  readonly inventoryService: InventoryServiceInterface;
  readonly equipmentService: EquipmentServiceInterface;
  readonly gameModeService: GameModeServiceInterface;
  readonly gameEngineService: GameEngineServiceInterface;
  readonly gameOverlayService: GameOverlayServiceInterface;
  readonly sessionService: SessionServiceInterface;
  readonly npcDialogueService: NpcDialogueServiceInterface;

  initialize(): Promise<void>;
  dispose(): Promise<void>;

  /**
   * Overrides the loot roll RNG (0..1 per entry) for deterministic tests.
   * Contract C-331 AC-5 — declared-before-RNG discipline.
   */
  setLootRollFn(rollFn: () => number): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class GameCompositionRoot
  extends BaseFrontendClass<GameCompositionRootOptions>
  implements GameCompositionRootInterface
{
  private _initialized = false;

  /** Injectable loot roll RNG — deterministic in tests (C-331 AC-5). */
  private _lootRollFn: () => number = Math.random;

  /** Unsubscribers for composition-root-owned bridge listeners. */
  private _bridgeUnsubscribers: Array<() => void> = [];

  // Services are lazily initialised by initialize()
  // These are set during initialize() and cleared during dispose()
  private _campaignService: CampaignServiceInterface | undefined;
  private _playerStateService: PlayerStateServiceInterface | undefined;
  private _worldStateService: WorldStateServiceInterface | undefined;
  private _inventoryService: InventoryServiceInterface | undefined;
  private _equipmentService: EquipmentServiceInterface | undefined;
  private _gameModeService: GameModeServiceInterface | undefined;
  private _gameEngineService: GameEngineServiceInterface | undefined;
  private _gameOverlayService: GameOverlayServiceInterface | undefined;
  private _sessionService: SessionServiceInterface | undefined;
  private _questStateService: QuestStateServiceInterface | undefined;
  private _npcDialogueService: NpcDialogueServiceInterface | undefined;

  get isInitialized(): boolean {
    return this._initialized;
  }

  get campaignService(): CampaignServiceInterface {
    if (!this._campaignService) {
      throw new Error('GameCompositionRoot not initialised');
    }
    return this._campaignService;
  }

  get playerStateService(): PlayerStateServiceInterface {
    if (!this._playerStateService) {
      throw new Error('GameCompositionRoot not initialised');
    }
    return this._playerStateService;
  }

  get worldStateService(): WorldStateServiceInterface {
    if (!this._worldStateService) {
      throw new Error('GameCompositionRoot not initialised');
    }
    return this._worldStateService;
  }

  get questStateService(): QuestStateServiceInterface {
    if (!this._questStateService) {
      throw new Error('GameCompositionRoot not initialised');
    }
    return this._questStateService;
  }

  get inventoryService(): InventoryServiceInterface {
    if (!this._inventoryService) {
      throw new Error('GameCompositionRoot not initialised');
    }
    return this._inventoryService;
  }

  get equipmentService(): EquipmentServiceInterface {
    if (!this._equipmentService) {
      throw new Error('GameCompositionRoot not initialised');
    }
    return this._equipmentService;
  }

  get gameModeService(): GameModeServiceInterface {
    if (!this._gameModeService) {
      throw new Error('GameCompositionRoot not initialised');
    }
    return this._gameModeService;
  }

  get gameEngineService(): GameEngineServiceInterface {
    if (!this._gameEngineService) {
      throw new Error('GameCompositionRoot not initialised');
    }
    return this._gameEngineService;
  }

  get gameOverlayService(): GameOverlayServiceInterface {
    if (!this._gameOverlayService) {
      throw new Error('GameCompositionRoot not initialised');
    }
    return this._gameOverlayService;
  }

  get sessionService(): SessionServiceInterface {
    if (!this._sessionService) {
      throw new Error('GameCompositionRoot not initialised');
    }
    return this._sessionService;
  }

  get npcDialogueService(): NpcDialogueServiceInterface {
    if (!this._npcDialogueService) {
      throw new Error('GameCompositionRoot not initialised');
    }
    return this._npcDialogueService;
  }

  /** @inheritdoc */
  setLootRollFn(rollFn: () => number): void {
    this._lootRollFn = rollFn;
  }

  /**
   * Initializes all game runtime services in dependency order.
   * Idempotent — calling twice returns without duplicate subscriptions.
   *
   * Services are statically imported (no SSR concern in this static SPA).
   * Each service's initialize() handles heavy lifting (PixiJS, ECS worker).
   *
   * If SSR is re-enabled, restore dynamic imports below:
   *
   *   const { gameEngineService } = await import('./game_engine_service.svelte');
   *   const { gameOverlayService } = await import('./game_overlay_service.svelte');
   *   // ... etc for each service
   */
  async initialize(): Promise<void> {
    if (this._initialized) {
      return;
    }

    const t0 = performance.now();

    // Phase 1: Engine service (PixiJS + ECS worker initialised lazily inside)
    this._gameEngineService = gameEngineService;
    // Phase 1b: Overlay service (init EngineBridge)
    this._gameOverlayService = gameOverlayService;
    this._npcDialogueService = npcDialogueService;

    // Phase 2: Initialise overlay (sets up bridge listeners)
    await gameOverlayService.initialize();

    // Phase 3: Stateless infrastructure
    this._gameModeService = gameModeService;
    this._inventoryService = inventoryService;
    this._playerStateService = playerStateService;
    this._worldStateService = worldStateService;
    this._questStateService = questStateService;
    this._sessionService = sessionService;

    // Phase 4: Equipment (depends on PlayerStateService + InventoryService)
    this._equipmentService = equipmentService;

    // Phase 5: Campaign service (C-313)
    this._campaignService = campaignService;

    // Phase 5b: Thread contentPackId to engine and ensure campaign service is ready
    const contentPackId = campaignService.activeCampaign?.contentPackId ?? 'emberwatch';
    this.debug('initialize:contentPackId', { contentPackId });

    // Phase 5c: Wire NPC dialogue orchestrator with content pack + gateway
    const { loadContentPack, createEngineBridge } = await import('@aikami/frontend/engine');
    const contentPack = await loadContentPack({ packId: contentPackId });

    // ── C-331 AC-1: content pack is the single source of item truth ──
    inventoryService.configureCatalog({
      items: buildItemCatalogFromPack({ items: contentPack.manifest.items }),
    });

    // ── C-331: engine command senders (appearance sync + consumable heal) ──
    const sendEngineCommand = (command: GameCommand): void => {
      gameEngineService.sendCommand(command);
    };
    equipmentService.configureCommandSender({ sendCommand: sendEngineCommand });
    inventoryService.configureCommandSender({ sendCommand: sendEngineCommand });

    // ── C-331 AC-2: pickup suppression + SFX wiring ──
    inventoryService.configureWorldIntegration({
      isPickupCollected: (spawnId) => worldStateService.isPickupCollected(spawnId),
      recordPickup: (spawnId) => worldStateService.recordCollectedPickup(spawnId),
      onItemCountChange: (totalCount) => gameOverlayService.onInventoryCountChange(totalCount),
    });

    // ── C-331 AC-3: authored vendor fallback lines ──
    vendorService.configureFallback({
      getVendorLine: (vendorId) => {
        const npc = contentPack.getNpc(vendorId);
        if (!npc?.defaultDialogueKey) {
          return undefined;
        }
        return contentPack.getDialogue(npc.defaultDialogueKey);
      },
    });

    // ── C-331 AC-5: encounter loot delivery (idempotent, additive) ──
    try {
      const lootBridge = createEngineBridge();
      this._bridgeUnsubscribers.push(
        lootBridge.on('ENCOUNTER_COMPLETED', (event) => {
          if (event.victory) {
            this._applyEncounterLoot({
              encounterId: event.encounterId,
              getEncounterLoot: (id) => contentPack.getEncounter(id)?.loot,
            });
          }
        }),
      );
    } catch (error) {
      this.debug('initialize:loot-listener-failed', { error: String(error) });
      // Clean up any partial subscriptions before rethrowing
      for (const unsubscribe of this._bridgeUnsubscribers) {
        try {
          unsubscribe();
        } catch (_cleanupError) {
          // Best-effort cleanup
        }
      }
      this._bridgeUnsubscribers = [];
      throw error;
    }

    npcDialogueService.configure({
      contentProvider: {
        getNpc: (npcId) => {
          const npc = contentPack.getNpc(npcId);
          if (!npc) {
            return undefined;
          }
          return {
            name: npc.name,
            defaultDialogueKey: npc.defaultDialogueKey,
            isVendor: npc.isVendor,
            vendorInventory: npc.vendorInventory,
            combatStats: npc.combatStats as Record<string, unknown> | undefined,
          };
        },
        getDialogue: (key) => contentPack.getDialogue(key),
        getQuest: (questId) => {
          const q = contentPack.getQuest(questId);
          if (!q) {
            return undefined;
          }
          return { id: q.id, name: q.name, offerDialogueKey: q.offerDialogueKey };
        },
        getAllQuests: () =>
          contentPack.getAllQuests().map((q) => ({
            id: q.id,
            name: q.name,
            offerDialogueKey: q.offerDialogueKey,
          })),
        getAllEncounters: () =>
          contentPack.getAllEncounters().map((e) => ({
            id: e.id,
            dialogueKey: e.startDialogueKey,
            encounterNpcIds: e.enemyNpcIds,
          })),
        getEncounter: (encounterId) => {
          const e = contentPack.getEncounter(encounterId);
          if (!e) {
            return undefined;
          }
          return {
            id: e.id,
            dialogueKey: e.startDialogueKey,
            encounterNpcIds: e.enemyNpcIds,
          };
        },
        getItem: (itemId) => contentPack.getItem(itemId),
        getAllItems: () => contentPack.manifest.items,
      },
      textGenerator: async (opts) => {
        const result = await aiGatewayService.generateText({
          messages: opts.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })) as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
          schema: opts.schema,
          schemaName: opts.schemaName,
          signal: opts.signal,
          onChunk: undefined,
        });
        return {
          text: result.text,
          structured: result.structured,
        };
      },
      executors: {
        trade: (_opts) => {
          gameOverlayService.openVendor({
            vendorId: _opts.npcId,
            vendorName: _opts.vendorName ?? '',
            vendorInventory: _opts.vendorInventory ?? '',
          });
          return true;
        },
        offerQuest: (_opts) => {
          const accepted = questStateService.acceptQuest({
            questId: _opts.questId,
            npcId: _opts.npcId,
          });
          if (accepted) {
            gameOverlayService.openQuestLog();
          }
          return accepted;
        },
        skillCheck: (_opts) => {
          // Dice flow handled by the dialogue ViewModel; the orchestrator
          // validates the command and returns it as the turn.command.
          // The VM extracts it and runs the dice flow.
          return true;
        },
        giveItem: (_opts) => {
          // Add item to inventory via inventory service (C-331 — rewards
          // bypass the capacity cap; never silently lost)
          return inventoryService.addItem({
            itemId: _opts.itemId,
            quantity: _opts.quantity,
          });
        },
        startCombat: (opts) => {
          gameOverlayService.startCombat({ enemyName: opts.npcName });
          return true;
        },
        recruit: (opts) => {
          // Use partyRosterService to recruit the companion (C-340)
          const member = partyRosterService.recruit({
            npcId: opts.npcId,
            name: opts.npcName,
            classId: 'fighter', // TODO: read from content pack companionClassId
            level: 1,
            initialApproval: 0,
          });
          return !!member;
        },
      },
    });

    // Phase 5d: Configure quest state service with content pack
    questStateService.configure({ contentPackLoader: contentPack });

    // Phase 6: Start ECS bridge listeners for state services
    await playerStateService.startListening();
    await worldStateService.startListening();
    await inventoryService.startListening();
    await questStateService.startListening();

    this._initialized = true;

    const elapsed = performance.now() - t0;
    this.debug('initialize:complete', { elapsedMs: elapsed });
  }

  /**
   * Rolls a content-pack loot table and delivers drops additively to the
   * inventory (C-331 AC-5). Idempotent per encounter ID — the granted flag
   * persists with world state across save/reload.
   */
  private _applyEncounterLoot(options: {
    encounterId: string;
    getEncounterLoot: (encounterId: string) => ContentPackLootEntry[] | undefined;
  }): void {
    const { encounterId, getEncounterLoot } = options;
    if (!encounterId) {
      return;
    }
    if (worldStateService.isLootGranted(encounterId)) {
      this.debug('_applyEncounterLoot:already-granted', { encounterId });
      return;
    }

    const lootTable = getEncounterLoot(encounterId);
    if (!lootTable || lootTable.length === 0) {
      return;
    }

    // Build the rolled drop batch
    const rolled: Array<{ itemId: string; quantity: number }> = [];
    for (const entry of lootTable) {
      const roll = this._lootRollFn();
      if (roll < entry.dropChance) {
        rolled.push({ itemId: entry.itemId, quantity: entry.quantity });
      }
    }

    // Deliver the complete batch transactionally
    for (const drop of rolled) {
      // Loot delivery bypasses the capacity cap — authored drops are
      // never silently lost (C-331 edge case).
      const added = inventoryService.addItem({ itemId: drop.itemId, quantity: drop.quantity });
      if (!added) {
        this.debug('_applyEncounterLoot:delivery-failed', {
          encounterId,
          itemId: drop.itemId,
          quantity: drop.quantity,
        });
        // Failed delivery — do not mark as granted, allow replay
        return;
      }
    }

    // Record AFTER successful delivery — replayed events must never double-grant
    worldStateService.recordLootGranted(encounterId);
    this.debug('_applyEncounterLoot:granted', { encounterId, rolled });
  }

  /**
   * Disposes all services in reverse order.
   * Safe to call on an uninitialized root.
   */
  async dispose(): Promise<void> {
    if (!this._initialized) {
      return;
    }

    const t0 = performance.now();

    // Remove composition-root-owned bridge listeners (C-331 loot)
    for (const unsubscribe of this._bridgeUnsubscribers) {
      try {
        unsubscribe();
      } catch (_error) {
        // Best-effort cleanup
      }
    }
    this._bridgeUnsubscribers = [];

    // Reset all state services
    this._playerStateService?.reset();
    this._worldStateService?.reset();
    this._questStateService?.reset();
    this._inventoryService?.reset();
    this._equipmentService?.reset();
    this._gameModeService?.reset();

    // Clear references
    this._campaignService = undefined;
    this._playerStateService = undefined;
    this._worldStateService = undefined;
    this._questStateService = undefined;
    this._inventoryService = undefined;
    this._equipmentService = undefined;
    this._gameModeService = undefined;
    this._gameEngineService = undefined;
    this._gameOverlayService = undefined;
    this._sessionService = undefined;
    this._npcDialogueService = undefined;

    this._initialized = false;

    const elapsed = performance.now() - t0;
    this.debug('dispose:complete', { elapsedMs: elapsed });
  }
}

export const getGameCompositionRoot = (
  options: GameCompositionRootOptions,
): GameCompositionRootInterface => GameCompositionRoot.create(options);
