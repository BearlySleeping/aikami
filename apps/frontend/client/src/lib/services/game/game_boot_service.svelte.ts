// apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts
//
// Cancellable, observable staged /game boot orchestrator.
// Owns the stage pipeline, a cancellation token per boot attempt,
// and reactive bootProgress state.
//
// Contract: C-326 Make Game Boot Atomic, Observable, and Content-Driven

// biome-ignore-all lint/style/useNamingConvention: stage identifiers use snake_case per GameBootStage type

import type { EngineBridge, GameWorld, LpcLayerRecipe } from '@aikami/frontend/engine';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { Campaign, PersonaData } from '@aikami/types';
import { authService } from '$services';
import type { GameBootInput, GameBootProgress, GameBootResult, GameBootStage } from '$types';
import { transition } from '../campaign/boot_state_machine.ts';
import { campaignService } from '../campaign/campaign_service.svelte';
import { personaService } from '../persona/persona_repository.svelte';

/** Ordered pipeline stages that execute sequentially during a boot attempt. */
const bootStageOrder: readonly GameBootStage[] = [
  'loading_campaign',
  'validating_save',
  'preloading_content',
  'creating_engine',
  'hydrating_snapshot',
  'spawning_entities',
];

/** Stage labels for the loading UI — displayed during each stage. */
/** Stage labels for the loading UI — displayed during each stage. */
const bootStageLabels: Record<GameBootStage, string> = {
  idle: 'Preparing...',
  loading_campaign: 'Loading campaign...',
  validating_save: 'Validating save...',
  preloading_content: 'Loading content pack...',
  creating_engine: 'Starting game engine...',
  hydrating_snapshot: 'Restoring world...',
  spawning_entities: 'Spawning entities...',
  ready: 'Ready',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for constructing a {@link GameBootService}. */
export type GameBootServiceOptions = BaseFrontendClassOptions;

export type GameBootServiceInterface = BaseFrontendClassInterface & {
  /** Reactive boot progress exposed to the ViewModel layer. */
  readonly bootProgress: GameBootProgress;

  /** The terminal result of the last boot attempt, or undefined if not yet run. */
  readonly lastResult: GameBootResult | undefined;

  /** Whether a boot attempt is currently in flight. */
  readonly isBooting: boolean;

  /** Starts a new boot attempt. No-op if already booting. */
  boot(input: GameBootInput): Promise<GameBootResult>;

  /** Cancels the current boot attempt (if any). */
  cancelBoot(): void;

  /** Resets boot state for a retry attempt. */
  resetForRetry(): void;

  /** Tears down engine resources and resets state. */
  teardown(): void;
};

// ---------------------------------------------------------------------------
// Boot service
// ---------------------------------------------------------------------------

class GameBootService
  extends BaseFrontendClass<GameBootServiceOptions>
  implements GameBootServiceInterface
{
  /** Reactive boot progress exposed to the ViewModel layer. */
  bootProgress = $state<GameBootProgress>({
    stage: 'idle',
    stageIndex: 0,
    stageCount: bootStageOrder.length,
  });

  /** Terminal result from the most recent boot attempt. */
  lastResult = $state<GameBootResult | undefined>(undefined);

  /** Whether a boot attempt is in flight. */
  isBooting = $state(false);

  /** Cancellation token — set to true to abort the current boot. */
  private _cancelled = false;

  /** The current boot input — valid only during a boot attempt. */
  private _input: GameBootInput | undefined;

  /** Engine resources owned by the current boot attempt. */
  private _bridge: EngineBridge | undefined;
  private _gameWorld: GameWorld | undefined;
  private _clearContentPackCache: (() => void) | undefined;
  private _resizeCleanup: (() => void) | undefined;

  /** Chosen renderer (set during creating_engine stage). */
  private _renderer: 'webgpu' | 'webgl' = 'webgl';

  /** Resolved campaign during loading_campaign stage. */
  private _campaign: Campaign | undefined;

  /** Resolved persona data during loading_campaign stage. */
  private _persona: PersonaData | undefined;

  // ── Public API ──

  /** @inheritdoc */
  async boot(input: GameBootInput): Promise<GameBootResult> {
    if (this.isBooting) {
      this.debug('boot:already-booting');
      return { outcome: 'cancelled' };
    }

    this.isBooting = true;
    this._cancelled = false;
    this._input = input;
    this._resetProgress();

    const t0 = performance.now();

    for (let i = 0; i < bootStageOrder.length; i++) {
      if (this._cancelled) {
        this._finishProgress('cancelled');
        this._teardownEngineResources();
        const result: GameBootResult = { outcome: 'cancelled' };
        this.lastResult = result;
        this.isBooting = false;
        return result;
      }

      const stage = bootStageOrder[i];
      if (!stage) {
        continue;
      }
      this._setStage(stage, i);

      try {
        await this._runStage(stage);

        // Check cancellation immediately after each stage completes
        if (this._cancelled) {
          this._finishProgress('cancelled');
          this._teardownEngineResources();
          const result: GameBootResult = { outcome: 'cancelled' };
          this.lastResult = result;
          this.isBooting = false;
          return result;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.error('boot:stage-failed', { stage, error: message });

        this._finishProgress('failed', message, stage);
        this._teardownEngineResources();

        // Drive campaign state machine to failed
        if (this._campaign) {
          try {
            const failedState = transition(this._campaign.state, {
              type: 'LOAD_FAILED',
              error: message,
            });
            const { campaignRepository } = await import('../campaign/campaign_repository.svelte');
            const updated = {
              ...this._campaign,
              state: failedState,
              updatedAt: new Date().toISOString(),
            };
            await campaignRepository.update(updated);
            this._campaign = updated;
          } catch (transitionError) {
            this.warn('boot:campaign-fail-transition', { error: String(transitionError) });
          }
        }

        const result: GameBootResult = { outcome: 'failed', stage, error: message };
        this.lastResult = result;
        this.isBooting = false;
        return result;
      }
    }

    // All stages passed — persist campaign state before declaring success
    const elapsed = performance.now() - t0;
    this.debug('boot:complete', { elapsedMs: elapsed, renderer: this._renderer });

    // Drive campaign state machine to playing (loading → playing via LOAD_COMPLETE)
    if (this._campaign) {
      try {
        const playingState = transition(this._campaign.state, { type: 'LOAD_COMPLETE' });
        const { campaignRepository } = await import('../campaign/campaign_repository.svelte');
        const updated = {
          ...this._campaign,
          state: playingState,
          updatedAt: new Date().toISOString(),
        };
        await campaignRepository.update(updated);
        this._campaign = updated;
      } catch (error) {
        // Campaign persistence failure is a boot failure
        const message = error instanceof Error ? error.message : String(error);
        this.error('boot:campaign-persist-failed', { error: message });

        this._finishProgress('failed', message, 'spawning_entities');
        this._teardownEngineResources();

        const result: GameBootResult = {
          outcome: 'failed',
          stage: 'spawning_entities',
          error: `Campaign persistence failed: ${message}`,
        };
        this.lastResult = result;
        this.isBooting = false;
        return result;
      }
    }

    // Campaign persisted — now finalize progress and publish ready
    this._finishProgress('ready');

    const result: GameBootResult = { outcome: 'ready', renderer: this._renderer };
    this.lastResult = result;
    this.isBooting = false;
    return result;
  }

  /** @inheritdoc */
  cancelBoot(): void {
    if (!this.isBooting) {
      return;
    }
    this.debug('boot:cancelling');
    this._cancelled = true;
  }

  /** @inheritdoc */
  resetForRetry(): void {
    this.debug('boot:reset-for-retry');
    this._cancelled = false;
    this.isBooting = false;
    this._teardownEngineResources();
    this._setStage('idle', 0);

    // Clear content pack cache so a fixed manifest is re-fetched
    if (this._clearContentPackCache) {
      this._clearContentPackCache();
      this._clearContentPackCache = undefined;
    }
  }

  /** @inheritdoc */
  teardown(): void {
    this.debug('boot:teardown');
    this.cancelBoot();
    this._teardownEngineResources();
    this._setStage('idle', 0);
    this.lastResult = undefined;
    this._campaign = undefined;
    this._persona = undefined;
  }

  // ── Stage runners ──

  /** Executes a single pipeline stage. */
  private async _runStage(stage: GameBootStage): Promise<void> {
    const input = this._input;
    if (!input) {
      throw new Error('Boot input not set');
    }

    switch (stage) {
      case 'loading_campaign':
        await this._stageLoadCampaign(input);
        break;
      case 'validating_save':
        await this._stageValidateSave(input);
        break;
      case 'preloading_content':
        await this._stagePreloadContent(input);
        break;
      case 'creating_engine':
        await this._stageCreateEngine(input);
        break;
      case 'hydrating_snapshot':
        await this._stageHydrateSnapshot(input);
        break;
      case 'spawning_entities':
        await this._stageSpawnEntities();
        break;
    }
  }

  /** Stage: resolve campaign + persona. */
  private async _stageLoadCampaign(input: GameBootInput): Promise<void> {
    const t0 = performance.now();

    // Resolve campaign
    let campaign: Campaign | undefined;
    if (input.campaignId) {
      // Load specific campaign via repository
      const { campaignRepository } = await import('../campaign/campaign_repository.svelte');
      campaign = await campaignRepository.getById(input.campaignId);
    }

    if (!campaign) {
      // Fallback: latest campaign or default transient
      const latest = campaignService.getLatestCampaign();
      if (latest) {
        campaign = latest;
        this.debug('stage:loading_campaign:latest-campaign', { campaignId: latest.id });
      } else {
        // Default transient campaign (logged as fallback)
        this.warn('stage:loading_campaign:no-campaign-fallback', {
          fallback: 'emberwatch',
        });
      }
    }

    // Drive state machine: LOAD_REQUESTED → loading
    if (campaign) {
      try {
        // Validate transition is legal from current state
        const loadingState = transition(campaign.state, {
          type: 'LOAD_REQUESTED',
          campaignId: campaign.id,
        });
        // Persist the loading state
        const { campaignRepository } = await import('../campaign/campaign_repository.svelte');
        campaign = { ...campaign, state: loadingState, updatedAt: new Date().toISOString() };
        await campaignRepository.update(campaign);
        this._campaign = campaign;
      } catch (error) {
        this.warn('stage:loading_campaign:transition-failed', {
          currentState: campaign.state,
          error: String(error),
        });
        this._campaign = campaign;
      }
    }

    // Resolve persona — prefer campaign.personaId, then active persona, then localStorage
    const persona = await this._resolvePersona(campaign);
    this._persona = persona;
    if (persona) {
      this.debug('stage:loading_campaign:persona-resolved', { personaId: persona.id });
    }

    // Override content pack ID from campaign if available
    if (campaign?.contentPackId && campaign.contentPackId !== input.contentPackId) {
      this._input = { ...input, contentPackId: campaign.contentPackId };
      this.debug('stage:loading_campaign:contentPackId-override', {
        from: input.contentPackId,
        to: campaign.contentPackId,
      });
    }

    const elapsed = performance.now() - t0;
    this.debug('stage:loading_campaign:complete', { elapsedMs: elapsed });
  }

  /** Stage: validate/migrate pending save. */
  private async _stageValidateSave(input: GameBootInput): Promise<void> {
    const t0 = performance.now();

    // If a payload is already provided (e.g., from main menu), validate it
    if (input.pendingSavePayload) {
      this.debug('stage:validating_save:payload-provided');

      // C-334 AC-4: Validate checksum for v2+ payloads
      const { parseSavePayloadEnvelope, validateEnvelopeChecksum } = await import(
        './game_save_service.svelte.ts'
      );
      const { ecsSnapshot, serviceSnapshots, version, storedChecksum } = parseSavePayloadEnvelope(
        input.pendingSavePayload,
      );

      if (version && version >= 2 && storedChecksum) {
        const valid = await validateEnvelopeChecksum({
          ecsSnapshot,
          serviceSnapshots,
          storedChecksum,
        });
        if (!valid) {
          // C-334 AC-4: Distinct corruption error (not "Save not found")
          throw new Error(`Save is corrupted: checksum mismatch`);
        }
        this.debug('stage:validating_save:checksum-valid', { version });
      }

      const elapsed = performance.now() - t0;
      this.debug('stage:validating_save:complete', { elapsedMs: elapsed });
      return;
    }

    // Check if campaign has a lastSaveSlotId
    if (!this._campaign?.lastSaveSlotId) {
      this.debug('stage:validating_save:no-save-slot');
      const elapsed = performance.now() - t0;
      this.debug('stage:validating_save:complete', { elapsedMs: elapsed });
      return;
    }

    // Fetch the payload to validate it exists and is parseable
    const slotId = this._campaign.lastSaveSlotId;
    try {
      const { gameSaveService, parseSavePayloadEnvelope, validateEnvelopeChecksum } = await import(
        './game_save_service.svelte.ts'
      );
      // Raw envelope — hydration stage splits it into ECS + service snapshots (C-331)
      const payload = await gameSaveService.getRawSavePayload(slotId);

      // C-334 AC-4: Validate checksum for v2+ payloads
      const { ecsSnapshot, serviceSnapshots, version, storedChecksum } =
        parseSavePayloadEnvelope(payload);

      if (version && version >= 2 && storedChecksum) {
        const valid = await validateEnvelopeChecksum({
          ecsSnapshot,
          serviceSnapshots,
          storedChecksum,
        });
        if (!valid) {
          // Attempt recovery: find previous valid save for this campaign
          const recoverySlotId = await this._findRecoverySave();
          if (recoverySlotId) {
            this.warn('stage:validating_save:corrupt-recovered', {
              corruptSlot: slotId,
              recoverySlot: recoverySlotId,
            });
            const recoveryPayload = await gameSaveService.getRawSavePayload(recoverySlotId);
            input.pendingSavePayload = recoveryPayload;
            this._input = input;

            const elapsed = performance.now() - t0;
            this.debug('stage:validating_save:complete', { elapsedMs: elapsed });
            return;
          }

          throw new Error(
            `Save is corrupted: checksum mismatch for slot "${slotId}". No recovery save available.`,
          );
        }
        this.debug('stage:validating_save:checksum-valid', { version });
      }

      // Validation passed — store payload for hydration stage
      input.pendingSavePayload = payload;
      this._input = input;
      this.debug('stage:validating_save:valid', { slotId, bytes: payload.length });
    } catch (error) {
      // Save not found or corrupt — do NOT overwrite the save slot.
      // The campaign record is untouched. Surface as a stage failure.
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Save validation failed for slot "${slotId}": ${message}`);
    }

    const elapsed = performance.now() - t0;
    this.debug('stage:validating_save:complete', { elapsedMs: elapsed });
  }

  /** Stage: preload content pack manifest + asset bundles. */
  private async _stagePreloadContent(input: GameBootInput): Promise<void> {
    const t0 = performance.now();

    const { loadContentPack, clearContentPackCache } = await import('@aikami/frontend/engine');

    // AC-5: Clear stale pack cache before loading a new pack to prevent
    // asset/state leakage when switching between campaigns with different packs.
    clearContentPackCache();

    const pack = await loadContentPack({ packId: input.contentPackId });
    this._clearContentPackCache = clearContentPackCache;

    // Validate pack has a starting map
    const startMap = pack.getStartingMap();
    if (!startMap) {
      throw new Error(`Content pack "${input.contentPackId}" has no starting map`);
    }

    // Validate spawn coordinates — missing spawn is a validation failure
    if (startMap.defaultX === undefined || startMap.defaultY === undefined) {
      throw new Error(
        `Content pack "${input.contentPackId}" starting map "${pack.manifest.startingMapId}" is missing spawn coordinates (defaultX/defaultY)`,
      );
    }

    // Preload map asset
    const mapUrl = pack.resolveMapUrl(pack.manifest.startingMapId);
    this.bootProgress.detail = mapUrl;
    await this._preloadAsset(mapUrl);

    const elapsed = performance.now() - t0;
    this.debug('stage:preloading_content:complete', {
      elapsedMs: elapsed,
      packId: input.contentPackId,
    });
  }

  /** Stage: create PixiJS engine + ECS world. */
  private async _stageCreateEngine(input: GameBootInput): Promise<void> {
    const t0 = performance.now();

    const { createEngineBridge, GameWorld, TextureManager } = await import(
      '@aikami/frontend/engine'
    );

    this._bridge = createEngineBridge();
    const textureManager = new TextureManager();

    // Build LPC pipeline
    const { getLpcAssetPath } = await import('$lib/data/lpc_asset_catalog');
    const { GENERATED_LPC_SLOTS: generatedLpcSlots } = await import(
      '$lib/data/lpc_asset_catalog_generated'
    );

    const { recipeResolver, assetUrlResolver } = this._buildLpcPipeline(
      generatedLpcSlots,
      (slot, assetId, state) => getLpcAssetPath(slot, assetId, state as unknown as number),
    );

    this._gameWorld = (GameWorld.create as (opts: Record<string, unknown>) => GameWorld)({
      className: 'GameWorld',
      bridge: this._bridge,
      recipeResolver,
      assetUrlResolver,
      textureManager,
    });

    // Build player init data from resolved persona
    const playerData = this._buildPlayerData();

    // Determine renderer preference — default 'webgl', boot may override
    this.bootProgress.detail = `Initializing renderer...`;

    await this._gameWorld.initialize({
      canvas: input.canvas,
      width: input.canvas.clientWidth,
      height: input.canvas.clientHeight,
      initialPayload: undefined,
      playerData,
      rendererPreference: input.rendererPreference,
    });

    // Lock input immediately after initialization
    this._gameWorld.setInputLocked(true);

    // Determine which renderer was actually used
    this._renderer = (this._gameWorld.renderer as 'webgpu' | 'webgl') ?? 'webgl';
    this.bootProgress.detail = `Renderer: ${this._renderer}`;

    this._registerResizeHandler(input.canvas);

    const elapsed = performance.now() - t0;
    this.debug('stage:creating_engine:complete', {
      elapsedMs: elapsed,
      renderer: this._renderer,
    });
  }

  /** Stage: hydrate snapshot or start fresh. */
  private async _stageHydrateSnapshot(input: GameBootInput): Promise<void> {
    if (!this._gameWorld) {
      throw new Error('Engine not initialized');
    }

    const t0 = performance.now();

    if (input.pendingSavePayload) {
      // Restore from save snapshot — the payload may be a full envelope
      // ({ ecsSnapshot, serviceSnapshots }) or a legacy plain ECS snapshot.
      this.bootProgress.detail = 'Restoring saved world...';
      const { parseSavePayloadEnvelope } = await import('./game_save_service.svelte.ts');
      const { hydrateAllServices } = await import('./serializable_service');
      const { ecsSnapshot, serviceSnapshots } = parseSavePayloadEnvelope(input.pendingSavePayload);

      // Hydrate domain services FIRST so world flags (collected pickups,
      // loot-granted encounters) are in place before any map load (C-331).
      if (serviceSnapshots) {
        hydrateAllServices(serviceSnapshots);
        this.debug('stage:hydrating_snapshot:services-hydrated', {
          snapshotCount: serviceSnapshots.length,
        });
      }

      await this._gameWorld.restoreWorld(ecsSnapshot);
      this.debug('stage:hydrating_snapshot:restored', {
        bytes: input.pendingSavePayload.length,
      });
    } else {
      // Fresh spawn — load the pack's declared starting map
      const packId = input.contentPackId;
      const { loadContentPack } = await import('@aikami/frontend/engine');
      const pack = await loadContentPack({ packId });
      const startingMap = pack.getStartingMap();

      if (startingMap.defaultX === undefined || startingMap.defaultY === undefined) {
        throw new Error(
          'Starting map is missing spawn coordinates — this should have been caught in preloading_content',
        );
      }

      this.bootProgress.detail = `Loading map: ${pack.manifest.startingMapId}`;

      const { worldStateService } = await import('./world_state_service.svelte');
      await this._gameWorld.loadMap({
        mapUrl: pack.resolveMapUrl(pack.manifest.startingMapId),
        targetX: startingMap.defaultX,
        targetY: startingMap.defaultY,
        defeatedEnemies: [...worldStateService.defeatedEnemies],
        collectedPickups: [...worldStateService.collectedPickups],
      });

      this.debug('stage:hydrating_snapshot:fresh', {
        mapId: pack.manifest.startingMapId,
        spawnX: startingMap.defaultX,
        spawnY: startingMap.defaultY,
      });
    }

    // Re-lock input after hydration completes
    this._gameWorld.setInputLocked(true);

    const elapsed = performance.now() - t0;
    this.debug('stage:hydrating_snapshot:complete', { elapsedMs: elapsed });
  }

  /** Stage: unlock input, finalize. */
  private async _stageSpawnEntities(): Promise<void> {
    if (!this._gameWorld) {
      throw new Error('Engine not initialized');
    }

    const t0 = performance.now();

    // Unlock input — the world is ready
    this._gameWorld.setInputLocked(false);

    const elapsed = performance.now() - t0;
    this.debug('stage:spawning_entities:complete', { elapsedMs: elapsed });
  }

  // ── Persona resolution ──

  /** Resolves persona preferring campaign.personaId, then active persona, then localStorage. */
  private async _resolvePersona(campaign?: Campaign): Promise<PersonaData | undefined> {
    // 1. Prefer campaign.personaId
    if (campaign?.personaId) {
      try {
        const user = authService.currentUser;
        if (user) {
          const personas = await personaService.getPersonas(user.id);
          const match = personas.find((p) => p.id === campaign.personaId);
          if (match) {
            return match;
          }
        }
      } catch (error) {
        this.debug('_resolvePersona:campaign-persona-failed', { error: String(error) });
      }
    }

    // 2. Fall back to active persona
    try {
      const active = await personaService.getActivePersona();
      if (active) {
        return active;
      }
    } catch (error) {
      this.debug('_resolvePersona:active-persona-failed', { error: String(error) });
    }

    // 3. Fall back to localStorage
    try {
      const stored = localStorage.getItem('aikami-characters');
      if (stored) {
        const characters = JSON.parse(stored) as Array<{ persona: PersonaData }>;
        if (characters.length > 0) {
          const last = characters[characters.length - 1];
          if (last) {
            return last.persona;
          }
        }
      }
    } catch (error) {
      this.debug('_resolvePersona:localStorage-failed', { error: String(error) });
    }

    return undefined;
  }

  // ── LPC pipeline ──

  private _cachedLpcSlots:
    | readonly { slot: string; variants: readonly { assetId: string }[] }[]
    | undefined;

  private _buildLpcPipeline(
    generatedLpcSlots: readonly { slot: string; variants: readonly { assetId: string }[] }[],
    getLpcAssetPath: (_slot: string, assetId: string, state: string) => string,
  ): {
    recipeResolver: (layerIds: readonly number[]) => LpcLayerRecipe[];
    assetUrlResolver: (_slot: string, assetId: string, state: string) => string;
  } {
    this._cachedLpcSlots = generatedLpcSlots;

    const SlotCatalogIndex: Record<string, number> = {};
    for (let idx = 0; idx < generatedLpcSlots.length; idx++) {
      const entry = generatedLpcSlots[idx];
      if (!entry) {
        continue;
      }
      SlotCatalogIndex[entry.slot] = idx;
    }

    const EngineSlots = ['body', 'hair', 'torso', 'legs', 'feet', 'head'] as const;

    const recipeResolver = (layerIds: readonly number[]): LpcLayerRecipe[] => {
      const recipes: LpcLayerRecipe[] = [];
      for (let i = 0; i < EngineSlots.length; i++) {
        const rawId = layerIds[i];
        const slotName = EngineSlots[i] ?? `layer_${i}`;
        const catalogIdx = SlotCatalogIndex[slotName];
        if (catalogIdx === undefined) {
          continue;
        }
        const slotDef = generatedLpcSlots[catalogIdx];
        let effectiveIdx = typeof rawId === 'number' ? rawId - 1 : slotName === 'head' ? 94 : -1;
        if (slotName === 'head' && effectiveIdx < 0) {
          effectiveIdx = 94;
        }
        const variant = slotDef?.variants[effectiveIdx];
        if (!variant) {
          continue;
        }
        recipes.push({
          slot: slotName,
          assetId: variant.assetId,
          hexPalette: new Uint8Array(1024),
        });
      }
      return recipes;
    };

    const assetUrlResolver = (_slot: string, assetId: string, state: string): string => {
      return getLpcAssetPath(_slot, assetId, state);
    };

    return { recipeResolver, assetUrlResolver };
  }

  /** Builds player init data from the resolved persona. */
  private _buildPlayerData(): { name: string; appearanceLayers?: number[] } | undefined {
    if (!this._persona?.name) {
      return undefined;
    }

    const playerData: { name: string; appearanceLayers?: number[] } = {
      name: this._persona.name,
    };

    const lpcRecipe = (this._persona.appearance as Record<string, unknown> | undefined)
      ?.lpcRecipe as Record<string, string> | undefined;

    if (!lpcRecipe) {
      return playerData;
    }

    const { generatedLpcSlots } = this._getLpcCatalogSync();
    if (!generatedLpcSlots) {
      return playerData;
    }

    const EngineSlots = ['body', 'hair', 'torso', 'legs', 'feet', 'head'] as const;
    const slotIndexMap = new Map<string, number>();
    for (let i = 0; i < generatedLpcSlots.length; i++) {
      const entry = generatedLpcSlots[i];
      if (!entry) {
        continue;
      }
      slotIndexMap.set(entry.slot, i);
    }

    const appearanceLayers: number[] = [];
    for (const slotName of EngineSlots) {
      const assetId = lpcRecipe[slotName];
      if (!assetId) {
        appearanceLayers.push(1);
        continue;
      }
      const catalogIdx = slotIndexMap.get(slotName);
      if (catalogIdx === undefined) {
        appearanceLayers.push(1);
        continue;
      }
      const slotDef = generatedLpcSlots[catalogIdx];
      if (!slotDef) {
        appearanceLayers.push(1);
        continue;
      }
      const variantIdx = slotDef.variants.findIndex((v) => v.assetId === assetId);
      appearanceLayers.push(variantIdx >= 0 ? variantIdx + 1 : 1);
    }
    playerData.appearanceLayers = appearanceLayers;

    return playerData;
  }

  private _getLpcCatalogSync(): {
    generatedLpcSlots: readonly { slot: string; variants: readonly { assetId: string }[] }[];
  } {
    if (this._cachedLpcSlots) {
      return { generatedLpcSlots: this._cachedLpcSlots };
    }
    return { generatedLpcSlots: [] };
  }

  // ── Asset preloading ──

  /** Preloads a single PixiJS asset by URL. Cancellation-safe. */
  private async _preloadAsset(url: string): Promise<void> {
    if (this._cancelled) {
      return;
    }
    try {
      const { Assets } = await import('pixi.js');
      await Assets.load(url);
    } catch (error) {
      this.warn('_preloadAsset:failed', { url, error: String(error) });
      // Non-fatal — the map loader will retry on first load
    }
  }

  // ── Resize handler ──

  private _registerResizeHandler(canvas: HTMLCanvasElement): void {
    const handleResize = (): void => {
      if (this._gameWorld) {
        this._gameWorld.resize(canvas.clientWidth, canvas.clientHeight);
      }
    };
    window.addEventListener('resize', handleResize);
    this._resizeCleanup = (): void => {
      window.removeEventListener('resize', handleResize);
    };
  }

  // ── Progress helpers ──

  /** Sets the current stage and progress. */
  private _setStage(stage: GameBootStage, index: number): void {
    this.bootProgress = {
      stage,
      stageIndex: index,
      stageCount: bootStageOrder.length,
      detail: bootStageLabels[stage],
    };
  }

  /** Finalizes progress (ready, failed, or cancelled). */
  private _finishProgress(
    stage: 'ready' | 'failed' | 'cancelled',
    error?: string,
    failedStage?: GameBootStage,
  ): void {
    this.bootProgress = {
      stage,
      stageIndex: bootStageOrder.length,
      stageCount: bootStageOrder.length,
      detail: bootStageLabels[stage],
      error,
      failedStage,
    };
  }

  /** Resets progress to idle. */
  private _resetProgress(): void {
    this.bootProgress = {
      stage: 'idle',
      stageIndex: 0,
      stageCount: bootStageOrder.length,
    };
  }

  // ── Teardown ──

  /**
   * Finds the most recent valid save for the current campaign,
   * excluding a corrupt slot. Used for recovery (C-334 AC-4).
   *
   * @returns The slot ID of the recovery save, or undefined if none found.
   */
  private async _findRecoverySave(): Promise<string | undefined> {
    if (!this._campaign?.id) {
      return undefined;
    }

    try {
      const { gameSaveService, parseSavePayloadEnvelope, validateEnvelopeChecksum } = await import(
        './game_save_service.svelte.ts'
      );

      // Fetch all saves for this campaign, sorted newest first
      await gameSaveService.fetchAvailableSaves(this._campaign.id);
      const saves = gameSaveService.availableSaves;

      // Find the first valid save (skip corrupt ones)
      for (const save of saves) {
        try {
          const payload = await gameSaveService.getRawSavePayload(save.id);
          const { ecsSnapshot, serviceSnapshots, version, storedChecksum } =
            parseSavePayloadEnvelope(payload);

          if (version && version >= 2 && storedChecksum) {
            const valid = await validateEnvelopeChecksum({
              ecsSnapshot,
              serviceSnapshots,
              storedChecksum,
            });
            if (!valid) {
              continue; // skip this corrupt save, try next
            }
          }
          this.debug('_findRecoverySave:found', { slotId: save.id });
          return save.id;
        } catch {
          // Skip saves that can't be read
        }
      }

      this.warn('_findRecoverySave:no-valid-saves');
      return undefined;
    } catch (error) {
      this.warn('_findRecoverySave:failed', { error: String(error) });
      return undefined;
    }
  }

  /** Destroys engine resources (bridge, world, resize handler). */
  private _teardownEngineResources(): void {
    if (this._resizeCleanup) {
      this._resizeCleanup();
      this._resizeCleanup = undefined;
    }

    if (this._gameWorld) {
      this._gameWorld.destroy();
      this._gameWorld = undefined;
    }

    this._bridge = undefined;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const gameBootService: GameBootServiceInterface = GameBootService.create({
  className: 'GameBootService',
});
