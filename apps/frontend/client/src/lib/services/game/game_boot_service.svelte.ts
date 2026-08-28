// apps/frontend/client/src/lib/services/game/game_boot_service.svelte.ts
//
// Cancellable, observable staged /game boot orchestrator.
// Owns the stage pipeline, a cancellation token per boot attempt,
// and reactive bootProgress state.
//
// Contract: C-326 Make Game Boot Atomic, Observable, and Content-Driven

// biome-ignore-all lint/style/useNamingConvention: stage identifiers use snake_case per GameBootStage type

import { DEFAULT_LPC_RECIPE } from '@aikami/constants';
import type { EngineBridge, GameWorld } from '@aikami/frontend/engine';
import { createLpcPipeline, projectLpcCatalog } from '@aikami/frontend/engine/content';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { Campaign, PersonaData } from '@aikami/types';
import { isTauri } from '$lib/views/utils/is_tauri';
import { authService, equipmentService } from '$services';
import type { GameBootInput, GameBootProgress, GameBootResult, GameBootStage } from '$types';
import { transition } from '../campaign/boot_state_machine.ts';
import { campaignService } from '../campaign/campaign_service.svelte';
import { personaService } from '../persona/persona_service.svelte';
import { gameEngineService } from './game_engine_service.svelte';

/** Ordered pipeline stages that execute sequentially during a boot attempt. */
const bootStageOrder: readonly GameBootStage[] = [
  'loading_campaign',
  'validating_save',
  'initializing_asset_registry',
  'prefetching_starter_content',
  'warming_cache',
  'preloading_content',
  'creating_engine',
  'hydrating_snapshot',
  'spawning_entities',
];

/** Maximum time a single boot stage may take before timing out (ms). */
const STAGE_TIMEOUT_MS = 30_000;

/** Stage labels for the loading UI — displayed during each stage. */
const bootStageLabels: Record<GameBootStage, string> = {
  idle: 'Preparing...',
  loading_campaign: 'Loading campaign...',
  validating_save: 'Validating save...',
  initializing_asset_registry: 'Preparing assets...',
  prefetching_starter_content: 'Downloading starter content...',
  warming_cache: 'Finalizing...',
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

  /** Generation token for the current boot attempt — incremented on each new boot. */
  private _bootGeneration = 0;

  /** The current boot input — valid only during a boot attempt. */
  private _input: GameBootInput | undefined;

  /** Engine resources owned by the current boot attempt. */
  private _bridge: EngineBridge | undefined;
  private _gameWorld: GameWorld | undefined;
  private _clearContentPackCache: (() => void) | undefined;

  /** Registry-backed tag resolver (C-434). */
  private _resolveTag: ((tag: string) => string | null) | undefined;
  /** Blob URL release function (C-434). */
  private _releaseUrl: ((url: string) => void) | undefined;

  /**
   * Content-pack prop frame resolver (C-375 AC-1) — built + preloaded in
   * the preload stage, passed into GameWorld at engine creation.
   */
  private _propFrameResolverHandle:
    | import('@aikami/frontend/engine').PropFrameResolverHandle
    | undefined;
  private _resizeCleanup: (() => void) | undefined;

  /** Chosen renderer (set during creating_engine stage). */
  private _renderer: 'webgpu' | 'webgl' = 'webgl';

  /** Resolved campaign during loading_campaign stage. */
  private _campaign: Campaign | undefined;

  /** Resolved persona data during loading_campaign stage. */
  private _persona: PersonaData | undefined;

  /**
   * The effective LPC recipe (base + persona overrides) computed by
   * {@link _buildPlayerData}. Persisted so the base outfit can be re-seeded
   * AFTER save hydration — otherwise an empty equipment snapshot in the
   * restored save clobbers the freshly-seeded chainmail/boots base outfit
   * (C-417 / C-374 regression).
   */
  private _effectiveRecipe: Record<string, string> | undefined;

  // ── Public API ──

  /** @inheritdoc */
  async boot(input: GameBootInput): Promise<GameBootResult> {
    if (this.isBooting) {
      this.debug('boot:already-booting');
      return { outcome: 'cancelled' };
    }

    this.isBooting = true;
    this._cancelled = false;
    this._bootGeneration++;
    this._input = input;
    this._resetProgress();
    // Clear the previous boot's recipe so _seedBaseOutfit can never reuse it
    // (C-374/C-417): each boot attempt must derive its own base outfit.
    this._effectiveRecipe = undefined;

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
        await this._runStageWithTimeout(stage);

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
          const { canTransition, transition: transitionFn } = await import(
            '../campaign/boot_state_machine.ts'
          );
          if (canTransition(this._campaign.state, { type: 'LOAD_FAILED', error: message })) {
            try {
              const failedState = transitionFn(this._campaign.state, {
                type: 'LOAD_FAILED',
                error: message,
              });
              const { campaignStorage } = await import('../campaign/campaign_storage.svelte');
              const updated = {
                ...this._campaign,
                state: failedState,
                updatedAt: new Date().toISOString(),
              };
              await campaignStorage.update(updated);
              this._campaign = updated;
            } catch (transitionError) {
              this.warn('boot:campaign-fail-transition', { error: String(transitionError) });
            }
          } else {
            this.debug('boot:campaign-fail-transition:skipped', {
              state: this._campaign.state,
            });
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

    // Drive campaign state machine to playing (loading → playing via LOAD_COMPLETE).
    // Skip if campaign is already playing (e.g., new game via completeSetup, or
    // loadCampaign which also transitions to playing immediately).
    if (this._campaign && this._campaign.state !== 'playing') {
      try {
        const playingState = transition(this._campaign.state, { type: 'LOAD_COMPLETE' });
        const { campaignStorage } = await import('../campaign/campaign_storage.svelte');
        const updated = {
          ...this._campaign,
          state: playingState,
          updatedAt: new Date().toISOString(),
        };
        await campaignStorage.update(updated);
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
    this._effectiveRecipe = undefined;
  }

  // ── Stage runners ──

  /**
   * Runs a stage with a timeout. If the stage doesn't complete within
   * {@link STAGE_TIMEOUT_MS}, rejects with a descriptive error so the
   * boot pipeline doesn't hang forever.
   */
  private async _runStageWithTimeout(stage: GameBootStage): Promise<void> {
    // Capture the current boot generation to detect stale operations
    const generation = this._bootGeneration;

    return new Promise<void>((resolve, reject) => {
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        reject(
          new Error(
            `Boot stage "${stage}" timed out after ${STAGE_TIMEOUT_MS / 1000}s — the stage never completed`,
          ),
        );
      }, STAGE_TIMEOUT_MS);

      this._runStage(stage, generation).then(
        () => {
          clearTimeout(timeout);
          // Only resolve if timeout hasn't fired and generation is still current
          if (!timedOut && generation === this._bootGeneration) {
            resolve();
          }
        },
        (err) => {
          clearTimeout(timeout);
          // Always propagate errors if generation is current
          if (generation === this._bootGeneration) {
            reject(err);
          }
        },
      );
    });
  }

  /** Executes a single pipeline stage. */
  private async _runStage(stage: GameBootStage, generation: number): Promise<void> {
    const input = this._input;
    if (!input) {
      throw new Error('Boot input not set');
    }

    switch (stage) {
      case 'loading_campaign':
        await this._stageLoadCampaign(input, generation);
        break;
      case 'validating_save':
        await this._stageValidateSave(input, generation);
        break;
      case 'initializing_asset_registry':
        await this._stageInitializeAssetRegistry(generation);
        break;
      case 'prefetching_starter_content':
        await this._stagePrefetchStarterContent(generation);
        break;
      case 'warming_cache':
        await this._stageWarmingCache(generation);
        break;
      case 'preloading_content':
        await this._stagePreloadContent(input, generation);
        break;
      case 'creating_engine':
        await this._stageCreateEngine(input, generation);
        break;
      case 'hydrating_snapshot':
        await this._stageHydrateSnapshot(input, generation);
        break;
      case 'spawning_entities':
        await this._stageSpawnEntities(generation);
        break;
    }
  }

  /** Stage: resolve campaign + persona. */
  private async _stageLoadCampaign(input: GameBootInput, generation: number): Promise<void> {
    const t0 = performance.now();

    // Resolve campaign
    let campaign: Campaign | undefined;
    if (input.campaignId) {
      // Load specific campaign via repository
      const { campaignStorage } = await import('../campaign/campaign_storage.svelte');
      campaign = await campaignStorage.getById(input.campaignId);
    }

    // Check generation after async operation
    if (generation !== this._bootGeneration) {
      return;
    }

    if (!campaign) {
      // Fallback: latest campaign or default transient
      const latest = campaignService.getLatestCampaign();
      if (latest) {
        campaign = latest;
        this.debug('stage:loading_campaign:latest-campaign', { campaignId: latest.id });
      } else {
        // No campaign exists (e.g. straight to /game without setup) — create
        // the default Emberwatch campaign so save/continue work end-to-end.
        campaign = await campaignService.ensureDefaultCampaign();
        this.debug('stage:loading_campaign:default-created', { campaignId: campaign.id });
      }
    }

    // Drive state machine: LOAD_REQUESTED → loading
    // Skip if campaign is already playing (e.g., new game via completeSetup)
    if (campaign) {
      if (campaign.state === 'playing') {
        this.debug('stage:loading_campaign:already-playing');
        // Only mutate if generation is current
        if (generation === this._bootGeneration) {
          this._campaign = campaign;
        }
      } else if (campaign.state === 'creating') {
        // Campaign is still in setup — auto-complete to playing so the boot
        // pipeline can proceed. This happens when the user navigates to /game
        // without finishing the persona creation flow (C-435 regression).
        this.debug('stage:loading_campaign:auto-completing-setup');
        try {
          const playingState = transition(campaign.state, { type: 'SETUP_COMPLETE' });
          const { campaignStorage } = await import('../campaign/campaign_storage.svelte');
          campaign = { ...campaign, state: playingState, updatedAt: new Date().toISOString() };
          await campaignStorage.update(campaign);
          if (generation === this._bootGeneration) {
            this._campaign = campaign;
          }
          this.debug('stage:loading_campaign:setup-completed', { campaignId: campaign.id });
        } catch (error) {
          this.warn('stage:loading_campaign:auto-setup-failed', {
            currentState: campaign.state,
            error: String(error),
          });
          if (generation === this._bootGeneration) {
            this._campaign = campaign;
          }
        }
      } else {
        try {
          // Validate transition is legal from current state
          const loadingState = transition(campaign.state, {
            type: 'LOAD_REQUESTED',
            campaignId: campaign.id,
          });
          // Persist the loading state
          const { campaignStorage } = await import('../campaign/campaign_storage.svelte');
          campaign = { ...campaign, state: loadingState, updatedAt: new Date().toISOString() };
          await campaignStorage.update(campaign);
          // Only mutate if generation is still current after await
          if (generation === this._bootGeneration) {
            this._campaign = campaign;
          }
        } catch (error) {
          this.warn('stage:loading_campaign:transition-failed', {
            currentState: campaign.state,
            error: String(error),
          });
          if (generation === this._bootGeneration) {
            this._campaign = campaign;
          }
        }
      }
    }

    // Resolve persona — prefer campaign.personaId, then active persona, then localStorage
    const persona = await this._resolvePersona(campaign);
    // Check generation after async operation
    if (generation !== this._bootGeneration) {
      return;
    }
    this._persona = persona;
    if (persona) {
      this.debug('stage:loading_campaign:persona-resolved', { personaId: persona.id });
    }

    // Override content pack ID from campaign if available
    if (campaign?.contentPackId && campaign.contentPackId !== input.contentPackId) {
      if (generation === this._bootGeneration) {
        this._input = { ...input, contentPackId: campaign.contentPackId };
      }
      this.debug('stage:loading_campaign:contentPackId-override', {
        from: input.contentPackId,
        to: campaign.contentPackId,
      });
    }

    const elapsed = performance.now() - t0;
    this.debug('stage:loading_campaign:complete', { elapsedMs: elapsed });
  }

  /** Stage: validate/migrate pending save. */
  private async _stageValidateSave(input: GameBootInput, generation: number): Promise<void> {
    const t0 = performance.now();

    // If a payload is already provided (e.g., from main menu), validate it
    if (input.pendingSavePayload) {
      this.debug('stage:validating_save:payload-provided');

      // C-334 AC-4: Validate checksum for v2+ payloads
      const { parseSavePayloadEnvelope, validateEnvelopeChecksum } = await import(
        './game_save_service.svelte.ts'
      );
      // Check generation after async import
      if (generation !== this._bootGeneration) {
        return;
      }
      const { ecsSnapshot, serviceSnapshots, version, storedChecksum, map } =
        parseSavePayloadEnvelope(input.pendingSavePayload);

      if (version && version >= 2 && storedChecksum) {
        const valid = await validateEnvelopeChecksum({
          ecsSnapshot,
          serviceSnapshots,
          map,
          storedChecksum,
          version,
        });
        // Check generation after async validation
        if (generation !== this._bootGeneration) {
          return;
        }
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
      // Check generation after async import
      if (generation !== this._bootGeneration) {
        return;
      }
      // Raw envelope — hydration stage splits it into ECS + service snapshots (C-331)
      const payload = await gameSaveService.getRawSavePayload(slotId);
      // Check generation after async load
      if (generation !== this._bootGeneration) {
        return;
      }

      // C-334 AC-4: Validate checksum for v2+ payloads
      const { ecsSnapshot, serviceSnapshots, version, storedChecksum, map } =
        parseSavePayloadEnvelope(payload);

      if (version && version >= 2 && storedChecksum) {
        const valid = await validateEnvelopeChecksum({
          ecsSnapshot,
          serviceSnapshots,
          map,
          storedChecksum,
          version,
        });
        // Check generation after async validation
        if (generation !== this._bootGeneration) {
          return;
        }
        if (!valid) {
          // Attempt recovery: find previous valid save for this campaign
          const recoverySlotId = await this._findRecoverySave();
          // Check generation after async recovery search
          if (generation !== this._bootGeneration) {
            return;
          }
          if (recoverySlotId) {
            this.warn('stage:validating_save:corrupt-recovered', {
              corruptSlot: slotId,
              recoverySlot: recoverySlotId,
            });
            const recoveryPayload = await gameSaveService.getRawSavePayload(recoverySlotId);
            // Check generation before mutating input
            if (generation !== this._bootGeneration) {
              return;
            }
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
      // Check generation before mutating input
      if (generation === this._bootGeneration) {
        input.pendingSavePayload = payload;
        this._input = input;
      }
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

  /**
   * Stage: ensure the shared {@link assetPrefetchService} has opened the
   * local DB, seeded the asset registry, and initialized the cache backend
   * (C-373 AC-1/AC-3, C-435 AC-5/AC-6). Delegated so the start-menu screen
   * and the boot pipeline share one registry-init pass instead of each
   * running their own (C-448 background downloading). Never blocks boot —
   * any failure degrades to online mode and seeding retries on the next boot.
   */
  private async _stageInitializeAssetRegistry(generation: number): Promise<void> {
    const t0 = performance.now();

    try {
      const { assetPrefetchService } = await import(
        '$lib/services/assets/asset_prefetch_service.svelte'
      );
      const { seed } = await assetPrefetchService.ensureRegistryReady({
        onSeedProgress: ({ chunk, totalChunks }) => {
          if (generation === this._bootGeneration) {
            this.bootProgress.detail = `Seeding assets… chunk ${chunk}/${totalChunks}`;
          }
        },
      });
      if (generation !== this._bootGeneration) {
        return;
      }

      if (!seed) {
        // No usable catalog — everything is de-bundled, so without the seed
        // no asset can resolve. On a fresh install (no cached rows) this is
        // fatal; on an upgrade the prior session's cache still serves.
        this.warn('stage:initializing_asset_registry:no-seed', {
          hint: 'Set PUBLIC_ASSETS_BASE_URL or check network connectivity.',
        });
      }

      const elapsed = performance.now() - t0;
      this.debug('stage:initializing_asset_registry:complete', {
        elapsedMs: Math.round(elapsed),
      });
    } catch (error) {
      // Non-fatal: continue in online mode; seeding retries on next boot.
      this.warn('stage:initializing_asset_registry:degraded', { error: String(error) });
    }
  }

  /**
   * Stage: prefetch the starter content pack tags declared in offline_core.json,
   * via the shared {@link assetPrefetchService} (C-448 background downloading —
   * the start-menu screen may already have this in flight or finished, in
   * which case this resolves immediately). On a fresh install with no
   * network, this fails with an actionable message.
   */
  private _stagePrefetchStarterContent = async (generation: number): Promise<void> => {
    const t0 = performance.now();

    const { assetPrefetchService } = await import(
      '$lib/services/assets/asset_prefetch_service.svelte'
    );
    if (generation !== this._bootGeneration) {
      return;
    }

    const result = await assetPrefetchService.prefetchCore((progress) => {
      if (generation === this._bootGeneration) {
        this.bootProgress.detail = `Downloading starter content — ${progress.done}/${progress.total}`;
      }
    });
    if (generation !== this._bootGeneration) {
      return;
    }

    const elapsed = performance.now() - t0;

    if (result.requested === 0) {
      this.debug('stage:prefetching_starter_content:no-core-tags');
      return;
    }

    if (result.failedTags.length > 0 && result.fetched === 0 && result.alreadyCached === 0) {
      // Fresh install with no network — all tags failed
      const message =
        'Aikami needs to download starter content the first time you play. ' +
        'Connect to the internet and try again.';
      this.warn('stage:prefetching_starter_content:all-failed', {
        failedTags: result.failedTags,
        elapsedMs: Math.round(elapsed),
      });
      throw new Error(message);
    }

    if (result.failedTags.length > 0) {
      // Partial failure — some tags failed but we have enough to proceed
      this.warn('stage:prefetching_starter_content:partial-failure', {
        failedTags: result.failedTags,
        fetched: result.fetched,
        alreadyCached: result.alreadyCached,
        elapsedMs: Math.round(elapsed),
      });
    } else {
      this.debug('stage:prefetching_starter_content:complete', {
        fetched: result.fetched,
        alreadyCached: result.alreadyCached,
        elapsedMs: Math.round(elapsed),
      });
    }
  };

  /**
   * Stage: deliberate no-op, kept in the pipeline for stage-numbering
   * stability. Full-catalog warming ({@link
   * assetPrefetchService.warmRemaining}) is opt-in only — a player action
   * (e.g. "download all for offline") must trigger it explicitly. Boot never
   * starts it on its own: on-demand, per-asset fetches already cover
   * whatever the player encounters while playing on the offline core.
   */
  private async _stageWarmingCache(_generation: number): Promise<void> {
    return;
  }

  /** Stage: preload content pack manifest + asset bundles. */
  private async _stagePreloadContent(input: GameBootInput, generation: number): Promise<void> {
    const t0 = performance.now();

    const { loadContentPack, clearContentPackCache } = await import('@aikami/frontend/engine');
    const { assetTagResolver } = await import('$lib/services/assets/registry_resolver');
    const { assetManager } = await import('$lib/services/assets/asset_manager.svelte');
    // Check generation after async import
    if (generation !== this._bootGeneration) {
      return;
    }

    // C-434: store the registry-backed tag resolver for GameWorld.
    this._releaseUrl = (url: string) => assetManager.releaseUrl(url);
    this._resolveTag = assetTagResolver;

    // AC-5: Clear stale pack cache before loading a new pack to prevent
    // asset/state leakage when switching between campaigns with different packs.
    clearContentPackCache();

    const pack = await loadContentPack({
      packId: input.contentPackId,
      resolveTag: this._resolveTag,
      releaseUrl: this._releaseUrl,
    });
    // Check generation after async load
    if (generation !== this._bootGeneration) {
      return;
    }
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
    // Check generation after async preload
    if (generation !== this._bootGeneration) {
      return;
    }

    // Preload the tileset spritesheet (atlas.json) so named frames like
    // "well.png" are registered in the Pixi TextureCache. Props reference
    // these frames via their spawn `frame` property; without this preload
    // Texture.from(frame) returns a 1×1 white texture (white-square bug).
    const spritesheetUrl = pack.manifest.atlas?.spritesheetUrl;
    if (spritesheetUrl) {
      await this._preloadAsset(spritesheetUrl);
      // Check generation after async preload
      if (generation !== this._bootGeneration) {
        return;
      }
    }

    // C-375 AC-1: build + preload the deterministic prop frame resolver
    // from the pack manifest (atlas + fallbackTile). It must be ready
    // before the first ENTITY_CREATED swaps prop placeholders.
    const { buildPropFrameResolver } = await import('./prop_frame_resolver');
    const propFrameHandle = await buildPropFrameResolver({
      manifest: pack.manifest,
      resolveTag: this._resolveTag,
    });
    // Check generation immediately after the await and BEFORE mutating
    // _propFrameResolverHandle — a stale boot must never clobber the
    // resolver of the current boot.
    if (generation !== this._bootGeneration) {
      propFrameHandle.clearCache();
      return;
    }
    this._propFrameResolverHandle = propFrameHandle;

    const elapsed = performance.now() - t0;
    this.debug('stage:preloading_content:complete', {
      elapsedMs: elapsed,
      packId: input.contentPackId,
      atlasSpritesheet: spritesheetUrl,
    });
  }

  /** Stage: create PixiJS engine + ECS world. */
  private async _stageCreateEngine(input: GameBootInput, generation: number): Promise<void> {
    const t0 = performance.now();

    const {
      createEngineBridge,
      GameWorld: EngineGameWorld,
      TextureManager,
    } = await import('@aikami/frontend/engine');
    // Check generation after async import
    if (generation !== this._bootGeneration) {
      return;
    }

    this._bridge = createEngineBridge();
    const textureManager = new TextureManager();

    // Build LPC pipeline
    const { getLpcAssetPath, wireLpcUrlResolver } = await import('$lib/data/lpc_asset_catalog');
    // C-372: ensure the manifest-backed LPC resolver is wired and the manifest
    // is loaded before the engine boots (idempotent — catalog module scope
    // also wires it).
    await wireLpcUrlResolver();
    const { getLpcCatalog } = await import('$lib/data/lpc_asset_catalog');
    const lpcCatalog = getLpcCatalog();
    // Check generation after async imports
    if (generation !== this._bootGeneration) {
      return;
    }

    const pipeline = this._buildLpcPipeline(lpcCatalog.slots, (slot, assetId, state) =>
      getLpcAssetPath(slot, assetId, state as unknown as number),
    );

    this._gameWorld = (EngineGameWorld.create as (opts: Record<string, unknown>) => GameWorld)({
      className: 'GameWorld',
      bridge: this._bridge,
      recipeResolver: pipeline.recipeResolver,
      assetUrlResolver: pipeline.assetUrlResolver,
      // C-400: forward the projected catalog so the worker resolves the
      // same slot/assetId sequences as the main-thread resolver.
      lpcCatalog: pipeline.catalog,
      // C-374: merge equipped items onto the player's base LPC render
      equipmentRecipeProvider: () => equipmentService.buildLpcRecipes(),
      textureManager,
      // C-375 AC-1: deterministic prop frame resolution (spritesheet-based,
      // fallbackTile on miss) — never the global Texture.from cache.
      propFrameResolver: this._propFrameResolverHandle?.resolver,
      // C-434: registry-backed tag resolver for maps and tilesets.
      resolveTag: this._resolveTag,
      releaseUrl: this._releaseUrl,
    });

    // Build player init data from resolved persona
    const playerData = this._buildPlayerData();

    // Determine renderer preference — default 'webgl', boot may override
    this.bootProgress.detail = `Initializing renderer...`;

    // Tauri/WebKitGTK is known to report garbage from
    // window.innerWidth/innerHeight/devicePixelRatio and even
    // document.documentElement.clientWidth/clientHeight on some hosts (seen
    // as negative or billions-scale values). GameWorld.initialize() defaults
    // to Pixi's resizeTo:window, which multiplies those into a canvas area
    // WebKit silently refuses to render — a fully blank screen with no
    // error. Source real dimensions from Tauri's native window API instead,
    // and pass `resizeTo: undefined` (an explicit own-property, distinct
    // from omitting it) so GameWorld doesn't fall back to resizeTo:window.
    const viewportSize = isTauri()
      ? await this._resolveTauriViewportSize(input.canvas)
      : { width: input.canvas.clientWidth, height: input.canvas.clientHeight };

    await this._gameWorld.initialize({
      canvas: input.canvas,
      width: viewportSize.width,
      height: viewportSize.height,
      resizeTo: isTauri() ? undefined : window,
      initialPayload: undefined,
      playerData,
      rendererPreference: input.rendererPreference,
    });
    // Check generation after async initialization
    if (generation !== this._bootGeneration) {
      // Clean up world that was created by a timed-out stage
      this._gameWorld.destroy();
      this._gameWorld = undefined;
      return;
    }

    // ── C-332: Bind GameWorld to GameEngineService so pauseEngine/resumeEngine
    // reach the worker. Without this, all overlay close/resume calls silently
    // no-op with :no-world log. ──
    // Only register if generation is still current
    if (generation === this._bootGeneration) {
      gameEngineService.registerWorld(this._gameWorld);
    }

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
  private async _stageHydrateSnapshot(input: GameBootInput, generation: number): Promise<void> {
    if (!this._gameWorld) {
      throw new Error('Engine not initialized');
    }

    const t0 = performance.now();

    if (input.pendingSavePayload) {
      // Restore from save snapshot — the payload may be a full envelope
      // ({ ecsSnapshot, serviceSnapshots, map }) or a plain ECS snapshot.
      this.bootProgress.detail = 'Restoring saved world...';
      const { parseSavePayloadEnvelope } = await import('./game_save_service.svelte.ts');
      const { hydrateAllServices } = await import('./serializable_service');
      // Check generation after async imports
      if (generation !== this._bootGeneration) {
        return;
      }
      const { ecsSnapshot, serviceSnapshots, version, map } = parseSavePayloadEnvelope(
        input.pendingSavePayload,
      );

      // Hydrate domain services FIRST so world flags (collected pickups,
      // loot-granted encounters) are in place before any map load (C-331).
      if (serviceSnapshots) {
        hydrateAllServices(serviceSnapshots);
        this.debug('stage:hydrating_snapshot:services-hydrated', {
          snapshotCount: serviceSnapshots.length,
        });
      }

      // Re-seed the base outfit AFTER hydration so an empty equipment
      // snapshot in the restored save cannot clobber the character's default
      // chainmail/boots (C-374/C-417). seedBaseOutfit only fills empty
      // body/feet slots, so real saved gear is preserved.
      this._seedBaseOutfit();

      if (map?.mapId && map.packId) {
        // ── Map-authoritative restore (v3+ envelope) ──
        // The map file is the source of truth for the world: rebuild the
        // saved map (tilemap, collision, NPCs, props, portals) at the saved
        // coordinates, then overlay the player-scoped ECS snapshot. This
        // replaces the old LOAD_GAME full-world rebuild, which could never
        // reconstruct map-derived entities from a 4-component snapshot.
        this.bootProgress.detail = `Loading map: ${map.mapId}`;
        const { loadContentPack } = await import('@aikami/frontend/engine');
        const pack = await loadContentPack({ packId: map.packId, resolveTag: this._resolveTag });
        const { worldStateService } = await import('./world_state_service.svelte');
        // Check generation after async imports
        if (generation !== this._bootGeneration) {
          return;
        }

        await gameEngineService.loadMap({
          mapUrl: pack.resolveMapUrl(map.mapId),
          targetX: map.playerX,
          targetY: map.playerY,
          defeatedEnemies: [...worldStateService.defeatedEnemies],
          collectedPickups: [...worldStateService.collectedPickups],
          interactableStates: { ...worldStateService.interactableStates },
          // The saved map may belong to a different pack than the engine's
          // boot default — loadMap resolves its manifest by this packId.
          packId: map.packId,
        });
        // Check generation after map load
        if (generation !== this._bootGeneration) {
          return;
        }

        // Overlay the player's saved appearance/combat stats/position.
        await gameEngineService.restorePlayer(ecsSnapshot);
        // Check generation after async restore
        if (generation !== this._bootGeneration) {
          return;
        }
        this.debug('stage:hydrating_snapshot:map-restored', {
          mapId: map.mapId,
          playerX: map.playerX,
          playerY: map.playerY,
          bytes: input.pendingSavePayload.length,
        });
      } else if (version !== undefined && version >= 3) {
        // ── v3+ envelope WITHOUT a usable map block ──
        // The save was written by the world-scope fallback (map routing
        // unavailable at save time — early-boot race or after a corrupt
        // restore). Restoring it legacy-style floods the world with wall
        // entities and never loads a tilemap (C-378): the scene becomes a
        // bare debug grid with every wall rendered as a sprite, and the
        // cascade repeats forever because no map ever loads. Recover by
        // starting fresh on the pack's starting map — the next auto-save
        // writes a proper v3 envelope with map routing.
        this.warn('stage:hydrating_snapshot:v3-without-map-routing', {
          version,
          bytes: input.pendingSavePayload.length,
          hint: 'Save carries no map block — starting fresh on the starting map.',
        });
        await this._spawnFreshStart(input, generation);
        // Check generation after fresh spawn
        if (generation !== this._bootGeneration) {
          return;
        }
        // Preserve the player's ECS state (appearance, combat stats) while
        // the fresh starting map governs the position: RESTORE_PLAYER runs
        // AFTER the map is spawned so its spawn-clamping applies against the
        // freshly loaded collision grid — a stale saved position is clamped
        // onto a walkable tile of the starting map instead of freezing the
        // player on a solid cell (C-378). The next auto-save then writes a
        // proper v3 envelope with map routing.
        await gameEngineService.restorePlayer(ecsSnapshot);
        // Check generation after async restore
        if (generation !== this._bootGeneration) {
          return;
        }
        this.debug('stage:hydrating_snapshot:v3-without-map-restored', {
          bytes: input.pendingSavePayload.length,
        });
      } else {
        // ── Legacy v2/pre-v2 save without map routing ──
        // Best-effort full-world restore (no tilemap/collision/portals can
        // be reconstructed — the envelope has no map identity).
        await this._gameWorld.restoreWorld(ecsSnapshot);
        // Check generation after async restore
        if (generation !== this._bootGeneration) {
          return;
        }
        this.debug('stage:hydrating_snapshot:legacy-restored', {
          bytes: input.pendingSavePayload.length,
        });
      }
    } else {
      // Fresh spawn — load the pack's declared starting map
      await this._spawnFreshStart(input, generation);
    }

    // Re-lock input after hydration completes
    this._gameWorld.setInputLocked(true);

    const elapsed = performance.now() - t0;
    this.debug('stage:hydrating_snapshot:complete', { elapsedMs: elapsed });
  }

  /**
   * Spawns a fresh game on the pack's declared starting map.
   *
   * Shared by the no-save boot path and the v3-without-map-routing recovery
   * (C-378): both need a working tilemap/collision world, and the fresh
   * spawn guarantees the next auto-save carries a proper map block.
   */
  private async _spawnFreshStart(input: GameBootInput, generation: number): Promise<void> {
    const packId = input.contentPackId;
    const { loadContentPack } = await import('@aikami/frontend/engine');
    // Check generation after async import
    if (generation !== this._bootGeneration) {
      return;
    }
    const pack = await loadContentPack({ packId, resolveTag: this._resolveTag });
    // Check generation after async load
    if (generation !== this._bootGeneration) {
      return;
    }
    const startingMap = pack.getStartingMap();

    if (startingMap.defaultX === undefined || startingMap.defaultY === undefined) {
      throw new Error(
        'Starting map is missing spawn coordinates — this should have been caught in preloading_content',
      );
    }

    this.bootProgress.detail = `Loading map: ${pack.manifest.startingMapId}`;

    const { worldStateService } = await import('./world_state_service.svelte');
    // Check generation after async import
    if (generation !== this._bootGeneration) {
      return;
    }
    await gameEngineService.loadMap({
      mapUrl: pack.resolveMapUrl(pack.manifest.startingMapId),
      targetX: startingMap.defaultX,
      targetY: startingMap.defaultY,
      defeatedEnemies: [...worldStateService.defeatedEnemies],
      collectedPickups: [...worldStateService.collectedPickups],
    });
    // Check generation after async loadMap
    if (generation !== this._bootGeneration) {
      return;
    }

    this.debug('stage:hydrating_snapshot:fresh', {
      mapId: pack.manifest.startingMapId,
      spawnX: startingMap.defaultX,
      spawnY: startingMap.defaultY,
    });
  }

  /** Stage: unlock input, finalize. */
  private async _stageSpawnEntities(generation: number): Promise<void> {
    if (!this._gameWorld) {
      throw new Error('Engine not initialized');
    }

    // Check generation before final mutations
    if (generation !== this._bootGeneration) {
      return;
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
    getLpcAssetPath: (_slot: string, assetId: string, state: string) => string | null,
  ) {
    // C-400: single source of truth — the engine's shared createLpcPipeline
    // (projected catalog + pure resolver + asset URL resolver). This is the
    // resolver the production /game route uses (gameBootService.boot →
    // GameWorld.create).
    this._cachedLpcSlots = generatedLpcSlots;
    return createLpcPipeline({
      catalog: projectLpcCatalog(generatedLpcSlots),
      getLpcAssetPath,
    });
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

    const { generatedLpcSlots } = this._getLpcCatalogSync();
    if (!generatedLpcSlots) {
      this.warn('lpc.boot.noCatalog', { personaId: this._persona.id });
      // No catalog — no recipe to persist; drop any stale one from a prior boot.
      this._effectiveRecipe = undefined;
      return playerData;
    }

    // Build slot → catalog index lookup first
    const slotIndexMap = new Map<string, number>();
    for (let i = 0; i < generatedLpcSlots.length; i++) {
      const entry = generatedLpcSlots[i];
      if (!entry) {
        continue;
      }
      slotIndexMap.set(entry.slot, i);
    }

    // Use DEFAULT_LPC_RECIPE as the base. The persona's lpcRecipe
    // may contain AI-generated assets that don't render well.
    // Only override slots where the persona's recipe explicitly
    // provides a VALID asset ID that exists in the catalog.
    const effectiveRecipe: Record<string, string> = { ...DEFAULT_LPC_RECIPE };
    if (lpcRecipe) {
      for (const [slot, assetId] of Object.entries(lpcRecipe)) {
        const catalogIdx = slotIndexMap.get(slot);
        if (catalogIdx !== undefined) {
          const slotDef = generatedLpcSlots[catalogIdx];
          const found = slotDef?.variants.some((v) => v.assetId === assetId);
          if (found) {
            effectiveRecipe[slot] = assetId;
          }
        }
      }
    }

    this.debug('lpc.boot.PlayerData', {
      personaId: this._persona.id,
      personaName: this._persona.name,
      hasRecipe: !!lpcRecipe,
      recipeSlots: lpcRecipe ? Object.keys(lpcRecipe).join(',') : 'none',
      recipeRaw: lpcRecipe ? JSON.stringify(lpcRecipe) : 'none',
      effectiveRecipe: JSON.stringify(effectiveRecipe),
    });

    const EngineSlots = ['body', 'hair', 'torso', 'legs', 'feet', 'head'] as const;

    // Map effective recipe to engine variant indices.
    // Fallback per-slot values produce a good-looking male character
    // (bodies_male=3, bangs=3, pants=22, head=95). Torso (chainmail) and
    // feet (boots) are equipment-owned (C-374) — they are excluded from the
    // base appearance so unequipping reveals the bare body, and the base
    // outfit is seeded into the equipment service instead.
    const SLOT_FALLBACKS: Record<string, number> = {
      body: 3,
      hair: 3,
      torso: 0,
      legs: 22,
      feet: 0,
      head: 95,
    };

    const appearanceLayers: number[] = [];
    for (const slotName of EngineSlots) {
      const assetId = effectiveRecipe[slotName];
      if (!assetId) {
        appearanceLayers.push(SLOT_FALLBACKS[slotName] ?? 1);
        continue;
      }
      const catalogIdx = slotIndexMap.get(slotName);
      if (catalogIdx === undefined) {
        appearanceLayers.push(SLOT_FALLBACKS[slotName] ?? 1);
        continue;
      }
      const slotDef = generatedLpcSlots[catalogIdx];
      if (!slotDef) {
        appearanceLayers.push(SLOT_FALLBACKS[slotName] ?? 1);
        continue;
      }
      const variantIdx = slotDef.variants.findIndex((v) => v.assetId === assetId);
      appearanceLayers.push(variantIdx >= 0 ? variantIdx + 1 : (SLOT_FALLBACKS[slotName] ?? 1));
    }

    // C-430: zeroEquipmentOwnedAppearanceSlots removed — variable-length slots
    // replace the fixed six-slot ceiling. Equipment adds its own layers.
    playerData.appearanceLayers = appearanceLayers;

    // Persist the effective recipe so the base outfit can be re-seeded after
    // save hydration (see {@link _seedBaseOutfit}).
    this._effectiveRecipe = effectiveRecipe;

    // C-374: seed the base outfit (chainmail + boots by default) into the
    // equipment service so the paperdoll reflects what the character wears.
    // Only fills empty body/feet slots — saved gear is never clobbered.
    this._seedBaseOutfit();

    this.debug('lpc.boot.appearanceLayers', { appearanceLayers: JSON.stringify(appearanceLayers) });

    return playerData;
  }

  /**
   * Seeds the base outfit (chainmail + boots by default) into the equipment
   * service so the paperdoll reflects the character's base LPC clothing.
   *
   * Only fills empty body/feet slots — saved gear is never clobbered. Called
   * once during {@link _buildPlayerData} (engine creation) and again AFTER
   * save hydration, because restoring a save with an empty equipment snapshot
   * would otherwise wipe the freshly-seeded base outfit, leaving the
   * character rendering chainmail while the Body slot sits empty (C-374/C-417).
   */
  private _seedBaseOutfit(): void {
    if (!this._effectiveRecipe) {
      return;
    }
    equipmentService.seedBaseOutfit(this._effectiveRecipe);
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

  /**
   * Preloads a single PixiJS asset by URL. Cancellation-safe.
   *
   * `url` may be a logical content-pack path (e.g. "emberwatch/maps/village.json")
   * rather than something directly fetchable — the same registry resolution
   * loadTilemap/loadJtonMap perform internally (see map_loader.ts) must run
   * here too, or the raw logical path gets handed straight to Assets.load()
   * and fails against the real asset store / CDN.
   *
   * JSON assets (maps) skip Pixi's Assets/Loader system entirely: the
   * registry resolver returns extension-less blob: URLs, so Pixi's
   * extension-sniffing parser selection (checkExtension in loadJson) can't
   * recognize them as JSON and falls through to the image parser instead,
   * failing with "Cannot decode the data in the argument to
   * createImageBitmap". This is harmless to skip — nothing downstream reads
   * map JSON from Pixi's cache; loadTilemap/loadJtonMap do their own fetch +
   * `_mapCache` when the real map load happens — so a plain fetch is enough
   * to warm it and surface fetch failures early.
   */
  private async _preloadAsset(url: string): Promise<void> {
    if (this._cancelled) {
      return;
    }
    const resolvedUrl = this._resolveTag ? (this._resolveTag(url) ?? url) : url;
    try {
      if (url.split('?')[0]?.toLowerCase().endsWith('.json')) {
        await fetch(resolvedUrl);
      } else {
        const { Assets } = await import('pixi.js');
        await Assets.load(resolvedUrl);
      }
    } catch (error) {
      this.warn('_preloadAsset:failed', { url, resolvedUrl, error: String(error) });
      // Non-fatal — the map loader will retry on first load
    }
  }

  // ── Resize handler ──

  /**
   * Resolves the real viewport size via Tauri's native window API. The DOM
   * viewport-measurement APIs (window.innerWidth/innerHeight,
   * document.documentElement.clientWidth/clientHeight) are unreliable on
   * some WebKitGTK hosts — seen returning negative or billions-scale
   * garbage in this webview. Falls back to the canvas's own box size if the
   * Tauri call fails for any reason.
   */
  private async _resolveTauriViewportSize(
    canvas: HTMLCanvasElement,
  ): Promise<{ width: number; height: number }> {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const size = await getCurrentWindow().innerSize();
      return { width: size.width, height: size.height };
    } catch (error) {
      this.warn('_resolveTauriViewportSize:failed', { error: String(error) });
      return { width: canvas.clientWidth, height: canvas.clientHeight };
    }
  }

  private _registerResizeHandler(canvas: HTMLCanvasElement): void {
    if (isTauri()) {
      this._registerTauriResizeHandler();
      return;
    }
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

  /**
   * Tauri variant: listens to the native window's resize event (physical
   * pixel size from Tauri's Rust side) instead of the DOM `resize` event +
   * canvas.clientWidth/clientHeight, which are unreliable in this webview
   * (see _resolveTauriViewportSize).
   */
  private _registerTauriResizeHandler(): void {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async (): Promise<void> => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const registered = await getCurrentWindow().onResized(({ payload }) => {
          this._gameWorld?.resize(payload.width, payload.height);
        });
        if (cancelled) {
          registered();
          return;
        }
        unlisten = registered;
      } catch (error) {
        this.warn('_registerTauriResizeHandler:failed', { error: String(error) });
      }
    })();

    this._resizeCleanup = (): void => {
      cancelled = true;
      unlisten?.();
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
          const { ecsSnapshot, serviceSnapshots, version, storedChecksum, map } =
            parseSavePayloadEnvelope(payload);

          if (version && version >= 2 && storedChecksum) {
            const valid = await validateEnvelopeChecksum({
              ecsSnapshot,
              serviceSnapshots,
              map,
              storedChecksum,
              version,
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

    // C-375: drop the prop frame resolver handle (drops memoized frames;
    // the atlas itself is ref-counted by Pixi's Assets cache).
    this._propFrameResolverHandle?.clearCache();
    this._propFrameResolverHandle = undefined;

    // ── C-332: Unbind from GameEngineService so stale reference doesn't
    // survive teardown. Next boot will re-register via registerWorld(). ──
    gameEngineService.registerWorld(undefined as unknown as GameWorld);
    gameEngineService.currentMapId = '';
    gameEngineService.playerScene = 'unknown';

    this._bridge = undefined;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const gameBootService: GameBootServiceInterface = GameBootService.create({
  className: 'GameBootService',
});
