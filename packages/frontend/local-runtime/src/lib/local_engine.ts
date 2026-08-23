// packages/frontend/local-runtime/src/lib/local_engine.ts
//
// Layer 2 — LocalEngine: modality-agnostic engine wrapper.
// Loads model files from cache, runs inference via a caller-supplied
// loader function, and manages the lifecycle (load / unload / reload).

import type { LocalModelBundle } from '@aikami/constants';
import type { EngineBackend, LocalModelState } from '@aikami/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Signature for a caller-supplied loader that receives cached file bytes. */
export type EngineLoader = (
  files: ReadonlyArray<{ path: string; data: ArrayBuffer }>,
  signal: AbortSignal,
) => Promise<EngineBackend>;

export type LocalEngineOptions = {
  bundle: LocalModelBundle;
  loader: EngineLoader;
};

// ---------------------------------------------------------------------------
// LocalEngine
// ---------------------------------------------------------------------------

export class LocalEngine {
  private readonly _bundle: LocalModelBundle;
  private readonly _loader: EngineLoader;
  private _backend: EngineBackend | null = null;
  private _state: LocalModelState;

  constructor(options: LocalEngineOptions) {
    this._bundle = options.bundle;
    this._loader = options.loader;
    this._state = { status: 'not-downloaded', bytes: this._totalBytes() };
  }

  // ── Public accessors ──────────────────────────────────────────────────────

  get bundle(): LocalModelBundle {
    return this._bundle;
  }

  get state(): LocalModelState {
    return this._state;
  }

  get backend(): EngineBackend | null {
    return this._backend;
  }

  get isLoaded(): boolean {
    return this._backend !== null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Load the model from the browser Cache Storage, then invoke the loader
   * to create an EngineBackend. Idempotent — safe to call multiple times.
   */
  async load(signal?: AbortSignal): Promise<LocalModelState> {
    if (this._backend) {
      return this._state;
    }

    const ctrl = new AbortController();
    const effectiveSignal = signal ?? ctrl.signal;

    try {
      this._state = { status: 'loading' };

      const files = await this._readFromCache(effectiveSignal);

      if (effectiveSignal.aborted) {
        this._state = { status: 'not-downloaded', bytes: this._totalBytes() };
        return this._state;
      }

      this._state = { status: 'loading' };
      this._backend = await this._loader(files, effectiveSignal);

      this._state = { status: 'ready' };
      return this._state;
    } catch (error) {
      if ((error as Error)?.name === 'AbortError' || effectiveSignal.aborted) {
        this._state = { status: 'not-downloaded', bytes: this._totalBytes() };
      } else {
        const message =
          error instanceof Error ? error.message : `Load failed for ${this._bundle.id}`;
        this._state = { status: 'error', message, retryable: true };
      }
      return this._state;
    }
  }

  /**
   * Unload the engine backend and release resources.
   */
  async unload(): Promise<void> {
    if (this._backend) {
      try {
        await this._backend.dispose();
      } catch (_error) {}
      this._backend = null;
    }
    this._state = { status: 'not-downloaded', bytes: this._totalBytes() };
  }

  /**
   * Reload: unload then load again.
   */
  async reload(signal?: AbortSignal): Promise<LocalModelState> {
    await this.unload();
    return await this.load(signal);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _totalBytes(): number {
    return this._bundle.assets.reduce((sum, a) => sum + a.bytes, 0);
  }

  private async _readFromCache(
    signal: AbortSignal,
  ): Promise<Array<{ path: string; data: ArrayBuffer }>> {
    if (typeof caches === 'undefined') {
      throw new Error('Cache Storage API not available');
    }

    const results: Array<{ path: string; data: ArrayBuffer }> = [];

    for (const asset of this._bundle.assets) {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      const cache = await caches.open(asset.cache);
      const response = await cache.match(asset.key);

      if (!response) {
        throw new Error(`Asset not in cache: ${asset.path}`);
      }

      // Clone to avoid consuming the cached Response (reload-safe)
      const buffer = await response.clone().arrayBuffer();

      if (buffer.byteLength !== asset.bytes) {
        throw new Error(
          `Cached size mismatch for ${asset.path}: expected ${asset.bytes}, got ${buffer.byteLength}`,
        );
      }

      results.push({ path: asset.path, data: buffer });
    }

    return results;
  }
}
