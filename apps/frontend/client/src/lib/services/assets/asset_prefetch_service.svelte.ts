// apps/frontend/client/src/lib/services/assets/asset_prefetch_service.svelte.ts
//
// AssetPrefetchService — single shared owner of the "download the game's
// content" pipeline: opens the asset registry and prefetches the tags
// required to play (offline core). Warming the rest of the catalog is opt-in
// only — {@link AssetPrefetchServiceInterface.warmRemaining} must be called
// explicitly (e.g. a "download all for offline" action) — the pipeline never
// starts it on its own. Both the start-menu screen and the /game boot
// pipeline call into this same singleton, so a download already running is
// never started twice — every stage is memoized here rather than duplicated
// per caller.
//
// Contract: C-448 (background downloading, start-menu entry point)

import { BaseFrontendClass, type BaseFrontendClassOptions } from '@aikami/frontend/services';
import type { AssetRegistryRepository as AssetRegistryRepositoryClass } from '@aikami/frontend/storage';
import type { AssetPrefetchPhase, AssetSeedDocument } from '@aikami/types';
import { withStepTimeout } from '$lib/utils/step_timeout';
import type { AssetCacheBackend } from './cache_backend.ts';

/** Options used to construct the shared asset-prefetch service. */
export type AssetPrefetchServiceOptions = BaseFrontendClassOptions;
/** Concurrent fetches during the background warm pass — see game_boot_service. */
const WARM_CONCURRENCY = 8;

/** Result of a starter-content prefetch pass. */
type CorePrefetchResult = {
  readonly requested: number;
  readonly fetched: number;
  readonly alreadyCached: number;
  readonly failedTags: readonly string[];
};

type RegistryHandle = {
  readonly registry: AssetRegistryRepositoryClass;
  readonly backend: AssetCacheBackend;
  readonly seed: AssetSeedDocument | null;
};

export type AssetPrefetchServiceInterface = {
  /** Current phase of the shared pipeline — drives the start-menu indicator. */
  readonly phase: AssetPrefetchPhase;
  /** Progress over the offline-core (required-to-play) tag set. */
  readonly coreProgress: { readonly done: number; readonly total: number } | null;
  /** Progress over the full-catalog background warm pass. */
  readonly warmProgress: { readonly done: number; readonly total: number } | null;
  /** Set when the pipeline degraded (network/storage failure) — non-fatal. */
  readonly errorMessage: string | undefined;

  /** Whether {@link warmRemaining} has been triggered this session. */
  readonly warmStarted: boolean;

  /**
   * Starts the required-to-play pipeline (registry init → core prefetch) if
   * it hasn't started yet this session. Fire-and-forget — safe to call from
   * multiple mount points (start menu, boot pipeline); later calls observe
   * the same run via the reactive fields above. Does NOT start warming the
   * rest of the catalog — call {@link warmRemaining} explicitly for that.
   */
  ensureStarted(): void;

  /**
   * Ensures the registry + cache backend are open and the catalog seeded.
   * Memoized for the session — every caller after the first awaits the same
   * setup instead of repeating it. `onSeedProgress` only fires for whichever
   * caller triggers the actual (one-time) seeding pass.
   */
  ensureRegistryReady(options?: {
    onSeedProgress?: (progress: { chunk: number; totalChunks: number }) => void;
  }): Promise<RegistryHandle>;

  /**
   * Prefetches every offline-core tag not already cached. Memoized — runs
   * once per session; later calls return the same result. Callers decide
   * their own failure policy from the returned counts (the boot pipeline
   * fails hard on total failure; the start menu just shows an indicator).
   */
  prefetchCore(
    onProgress?: (progress: { done: number; total: number }) => void,
  ): Promise<CorePrefetchResult>;

  /**
   * Starts warming every not-yet-cached catalog tag in the background. This
   * is the only entry point for a full-catalog download — nothing calls it
   * automatically. Fire-and-forget and memoized — calling it again while a
   * warm pass is already running (or after one finished) is a no-op.
   */
  warmRemaining(onProgress?: (progress: { done: number; total: number }) => void): void;
};

class AssetPrefetchService
  extends BaseFrontendClass<AssetPrefetchServiceOptions>
  implements AssetPrefetchServiceInterface
{
  phase = $state<AssetPrefetchPhase>('idle');
  coreProgress = $state<{ done: number; total: number } | null>(null);
  warmProgress = $state<{ done: number; total: number } | null>(null);
  errorMessage = $state<string | undefined>(undefined);

  /**
   * Per-step ceiling for registry init. Below the boot pipeline's 30s stage
   * timeout so the named step error wins the race and reaches the log.
   */
  private static readonly _stepTimeoutMs = 20_000;

  private _registryReadyPromise: Promise<RegistryHandle> | undefined;
  private _corePrefetchPromise: Promise<CorePrefetchResult> | undefined;
  private _warmStarted = false;

  /** @inheritdoc */
  get warmStarted(): boolean {
    return this._warmStarted;
  }

  ensureStarted(): void {
    void this._runPipeline();
  }

  private async _runPipeline(): Promise<void> {
    try {
      this.phase = this.phase === 'idle' ? 'preparing' : this.phase;
      const { seed } = await this.ensureRegistryReady();
      if (!seed) {
        this.phase = 'degraded';
        return;
      }

      this.phase = 'prefetching-core';
      const result = await this.prefetchCore((progress) => {
        this.coreProgress = progress;
      });

      if (result.failedTags.length > 0 && result.fetched === 0 && result.alreadyCached === 0) {
        this.phase = 'degraded';
        this.errorMessage = 'Unable to download starter content — check your connection.';
        return;
      }

      // Required-to-play content is in. Warming the rest of the catalog is
      // opt-in only — see warmRemaining, called explicitly by the caller.
      this.phase = 'ready';
    } catch (err) {
      this.phase = 'degraded';
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.warn('assetPrefetchService:pipeline-degraded', { error: this.errorMessage });
    }
  }

  ensureRegistryReady(options?: {
    onSeedProgress?: (progress: { chunk: number; totalChunks: number }) => void;
  }): Promise<RegistryHandle> {
    this._registryReadyPromise ??= this._initRegistry(options?.onSeedProgress).catch(
      (error: unknown) => {
        // Never cache a failure. Both the boot pipeline and the start menu
        // await this one promise, so a memoized rejection wedges the whole
        // session with no way back — clearing it lets the next caller retry.
        this._registryReadyPromise = undefined;
        throw error;
      },
    );
    return this._registryReadyPromise;
  }

  private async _initRegistry(
    onSeedProgress?: (progress: { chunk: number; totalChunks: number }) => void,
  ): Promise<RegistryHandle> {
    const { publicEnv } = await import('@aikami/frontend/configs');
    const { getLocalDatabase, AssetRegistryRepository } = await import('@aikami/frontend/storage');
    const { assetManager, createPlatformCacheBackend } = await import('./asset_manager.svelte.ts');
    const { assetStore } = await import('./asset_store.svelte.ts');

    const step = <T>(name: string, run: () => Promise<T>): Promise<T> =>
      withStepTimeout({ name, timeoutMs: AssetPrefetchService._stepTimeoutMs, run });

    const db = await step('getLocalDatabase', () => getLocalDatabase());
    const registry = new AssetRegistryRepository(db);

    await step('fetchManifest', () => assetStore.fetchManifest());
    const seed = assetStore.seed;

    if (!seed) {
      this.warn('assetPrefetchService:no-seed', {
        error: assetStore.error,
        hint: 'Set PUBLIC_ASSETS_BASE_URL or check network connectivity.',
      });
    } else if (await step('isSeeded', () => registry.isSeeded(seed.generatedAt))) {
      this.debug('assetPrefetchService:already-seeded');
    } else {
      // C-381 AC-7: Lazy seeding — only seed the core/offline tags upfront.
      // The remaining 12,000+ tags register on first request via
      // assetManager.warm() / assetManager.acquireUrl().
      const coreTags = [...assetStore.coreTags];
      const coreSeedRows = seed.rows.filter((row) => coreTags.includes(row.tag));
      const lazySeedRows = seed.rows.filter((row) => !coreTags.includes(row.tag));

      await registry.seedFromCompactSeed({
        seed: { ...seed, rows: coreSeedRows },
        r2BaseUrl: publicEnv.PUBLIC_ASSETS_BASE_URL,
        bundledTags: coreTags,
        onProgress: onSeedProgress,
      });
      this.debug('assetPrefetchService:seeded-core', {
        coreCount: coreSeedRows.length,
        lazyCount: lazySeedRows.length,
      });
    }

    const backend = createPlatformCacheBackend();
    await step('backend.init', () => backend.init());
    await step('backend.requestPersistence', () => backend.requestPersistence());

    await step('assetManager.initialize', () =>
      assetManager.initialize({ registry, backend, coreTags: assetStore.coreTags }),
    );
    await step('assetManager.reconcile', () => assetManager.reconcile());

    return { registry, backend, seed };
  }

  prefetchCore(
    onProgress?: (progress: { done: number; total: number }) => void,
  ): Promise<CorePrefetchResult> {
    this._corePrefetchPromise ??= this._doPrefetchCore(onProgress);
    return this._corePrefetchPromise;
  }

  private async _doPrefetchCore(
    onProgress?: (progress: { done: number; total: number }) => void,
  ): Promise<CorePrefetchResult> {
    await this.ensureRegistryReady();

    const { assetManager } = await import('./asset_manager.svelte.ts');
    const { assetStore } = await import('./asset_store.svelte.ts');

    const coreTags = [...assetStore.coreTags];
    if (coreTags.length === 0) {
      return { requested: 0, fetched: 0, alreadyCached: 0, failedTags: [] };
    }

    let fetched = 0;
    let alreadyCached = 0;
    const failedTags: string[] = [];

    for (let i = 0; i < coreTags.length; i++) {
      const tag = coreTags[i];
      if (!tag) {
        continue;
      }

      onProgress?.({ done: i, total: coreTags.length });

      const cachedUrl = assetManager.acquireUrl(tag);
      if (cachedUrl) {
        alreadyCached += 1;
        continue;
      }

      try {
        const url = await assetManager.warm(tag);
        if (url !== null) {
          fetched += 1;
        } else {
          failedTags.push(tag);
        }
      } catch {
        failedTags.push(tag);
      }
    }

    onProgress?.({ done: coreTags.length, total: coreTags.length });

    return { requested: coreTags.length, fetched, alreadyCached, failedTags };
  }

  warmRemaining(onProgress?: (progress: { done: number; total: number }) => void): void {
    if (this._warmStarted) {
      return;
    }
    this._warmStarted = true;
    void this._warmInBackground(onProgress);
  }

  private async _warmInBackground(
    onProgress?: (progress: { done: number; total: number }) => void,
  ): Promise<void> {
    const t0 = performance.now();

    try {
      const { assetManager } = await import('./asset_manager.svelte.ts');
      const { registry, seed } = await this.ensureRegistryReady();
      if (!seed) {
        this.phase = 'degraded';
        return;
      }

      const installStates = await registry.listInstallStates();
      const cachedTags = new Set(
        installStates.filter((state) => state.status === 'cached').map((state) => state.assetId),
      );
      const toWarm = seed.rows.filter((row) => !cachedTags.has(row.tag));

      if (toWarm.length === 0) {
        this.phase = 'ready';
        this.debug('assetPrefetchService:warm:all-cached');
        return;
      }

      this.phase = 'warming';
      let warmed = 0;
      let failed = 0;
      let cursor = 0;
      this.warmProgress = { done: 0, total: toWarm.length };

      const runWorker = async (): Promise<void> => {
        for (;;) {
          const row = toWarm[cursor++];
          if (!row) {
            return;
          }
          try {
            await assetManager.warm(row.tag);
            warmed += 1;
          } catch {
            failed += 1;
          }
          const progress = { done: warmed + failed, total: toWarm.length };
          this.warmProgress = progress;
          onProgress?.(progress);
        }
      };

      await Promise.all(Array.from({ length: WARM_CONCURRENCY }, runWorker));

      this.phase = 'ready';
      this.debug('assetPrefetchService:warm:complete', {
        elapsedMs: Math.round(performance.now() - t0),
        warmed,
        failed,
        total: toWarm.length,
      });
    } catch (err) {
      this.phase = 'degraded';
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.warn('assetPrefetchService:warm-degraded', { error: this.errorMessage });
    }
  }
}

/** Shared singleton — the start menu and the boot pipeline both call into this. */
export const assetPrefetchService: AssetPrefetchServiceInterface = AssetPrefetchService.create({
  className: 'AssetPrefetchService',
});
