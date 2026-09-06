// packages/frontend/local-runtime/src/lib/model_asset_store.ts
//
// Layer 1 — ModelAssetStore: modality-agnostic asset lifecycle manager.
// Lifts the download/verify/cache logic from voice_model_service.svelte.ts
// into a reusable store with two transports (Browser + Tauri).
//
// Preserves every C-389 CR hardening: size enforced while streaming,
// checksum before cache write, manifest versioning, abort between files
// on the Tauri path, listener registered before invoke.

import type { LocalModelAsset, LocalModelBundle } from '@aikami/constants';
import type { LocalModelState } from '@aikami/types';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// Transport interface
// ---------------------------------------------------------------------------

export type ProgressCallback = (receivedBytes: number, totalBytes: number) => void;

export type AssetTransport = {
  /** Download a single asset, verify it, write to cache. */
  downloadAsset(
    bundle: LocalModelBundle,
    asset: LocalModelAsset,
    options: { signal: AbortSignal; onProgress: ProgressCallback },
  ): Promise<void>;

  /** Remove a single asset from cache and disk. */
  removeAsset(bundle: LocalModelBundle, asset: LocalModelAsset): Promise<void>;
};

// ---------------------------------------------------------------------------
// SHA-256 helper
// ---------------------------------------------------------------------------

const sha256Hex = async (buffer: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

// ---------------------------------------------------------------------------
// Browser transport
// ---------------------------------------------------------------------------

const isTauriRuntime = (): boolean =>
  typeof window !== 'undefined' &&
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ !== undefined; // guard-ignore lint/type-safety/casting: custom window property for Tauri detection

const tauriInvoke = (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
  const internals = (
    window as unknown as {
      // guard-ignore lint/type-safety/casting: window global for model asset store registration
      // biome-ignore lint/style/useNamingConvention: Tauri global API name
      __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> };
    }
  ).__TAURI_INTERNALS__;
  return internals.invoke(cmd, args);
};

export class BrowserAssetTransport implements AssetTransport {
  async downloadAsset(
    bundle: LocalModelBundle,
    asset: LocalModelAsset,
    options: { signal: AbortSignal; onProgress: ProgressCallback },
  ): Promise<void> {
    const { signal, onProgress } = options;
    const origin = 'https://huggingface.co';
    const url = `${origin}/${bundle.repo}/resolve/${bundle.revision}/${asset.path}`;

    const response = await fetch(url, { signal });
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download ${asset.path} (HTTP ${response.status})`);
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let downloaded = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      downloaded += value.byteLength;
      // C-389 CR: enforce the expected size while streaming
      if (downloaded > asset.bytes) {
        throw new Error(`Download exceeded expected size for ${asset.path} (${asset.bytes} bytes)`);
      }
      chunks.push(value);
      onProgress(downloaded, asset.bytes);
    }

    const buffer = new Uint8Array(downloaded);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }

    if (downloaded !== asset.bytes) {
      throw new Error(
        `Size mismatch for ${asset.path}: expected ${asset.bytes}, got ${downloaded}`,
      );
    }

    const hash = await sha256Hex(buffer.buffer as ArrayBuffer);
    if (hash !== asset.sha256) {
      throw new Error(`Checksum mismatch for ${asset.path}: expected ${asset.sha256}, got ${hash}`);
    }

    const cache = await caches.open(asset.cache);
    await cache.put(
      asset.key,
      new Response(buffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(downloaded),
        },
      }),
    );
  }

  async removeAsset(_bundle: LocalModelBundle, asset: LocalModelAsset): Promise<void> {
    if (typeof caches === 'undefined') {
      return;
    }
    const cache = await caches.open(asset.cache);
    await cache.delete(asset.key);
  }
}

// ---------------------------------------------------------------------------
// Tauri transport
// ---------------------------------------------------------------------------

export class TauriAssetTransport implements AssetTransport {
  async downloadAsset(
    bundle: LocalModelBundle,
    asset: LocalModelAsset,
    options: { signal: AbortSignal; onProgress: ProgressCallback },
  ): Promise<void> {
    const { signal, onProgress } = options;
    const origin = 'https://huggingface.co';
    const url = `${origin}/${bundle.repo}/resolve/${bundle.revision}/${asset.path}`;

    // C-389 CR: cancellation takes effect between files
    if (signal.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const unlisten = await this._listenTauriProgress(asset.path, (receivedBytes) => {
      onProgress(receivedBytes, asset.bytes);
    });

    try {
      await tauriInvoke('download_model_file', {
        url,
        checksum: asset.sha256,
        fileName: asset.path,
        expectedSize: asset.bytes,
      });
    } finally {
      unlisten();
    }

    // Read the verified bytes back so the worker can load from cache
    const buffer = (await tauriInvoke('read_model_file', {
      fileName: asset.path,
    })) as ArrayBuffer;

    if (buffer.byteLength !== asset.bytes) {
      throw new Error(`Size mismatch for ${asset.path} after Rust download`);
    }

    if (typeof caches === 'undefined') {
      throw new Error('Cache Storage API not available');
    }
    const cache = await caches.open(asset.cache);
    await cache.put(
      asset.key,
      new Response(buffer, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(buffer.byteLength),
        },
      }),
    );
  }

  async removeAsset(_bundle: LocalModelBundle, asset: LocalModelAsset): Promise<void> {
    // Remove from cache first
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(asset.cache);
      await cache.delete(asset.key);
    }

    // Best-effort Tauri file removal
    try {
      await tauriInvoke('delete_model_files', {
        files: [asset.path],
      });
    } catch {
      // Best-effort — cache removal is authoritative
    }
  }

  private async _listenTauriProgress(
    fileName: string,
    onProgress: (receivedBytes: number) => void,
  ): Promise<() => void> {
    const eventApi = (
      window as unknown as {
        // guard-ignore lint/type-safety/casting: window global for model asset store registration
        // biome-ignore lint/style/useNamingConvention: Tauri global event API name
        __TAURI_EVENT__?: {
          listen: (
            event: string,
            handler: (e: { payload: unknown }) => void,
          ) => Promise<() => void>;
        };
      }
    ).__TAURI_EVENT__;
    if (!eventApi?.listen) {
      return () => {};
    }
    try {
      return await eventApi.listen('model-download-progress', (event) => {
        const payload = event.payload as { file?: string; receivedBytes?: number };
        if (payload.file === fileName && payload.receivedBytes !== undefined) {
          onProgress(payload.receivedBytes);
        }
      });
    } catch {
      return () => {};
    }
  }
}

// ---------------------------------------------------------------------------
// ModelAssetStore
// ---------------------------------------------------------------------------

export type ModelAssetStoreOptions = {
  bundles: Readonly<Record<string, LocalModelBundle>>;
};

export type ModelAssetStoreInterface = {
  readonly states: Readonly<Record<string, LocalModelState>>;
  totalBytes(bundleId: string): number;
  status(bundleId: string): Promise<LocalModelState>;
  download(bundleId: string): Promise<LocalModelState>;
  cancel(bundleId: string): void;
  remove(bundleId: string): Promise<void>;
  /**
   * Subscribes to state changes for a bundle (status transitions and
   * download progress). `states` is a plain object mutated in place, so
   * a framework's reactivity system won't see those writes on its own —
   * consumers that need to re-render (e.g. a Svelte service wrapping this
   * store) should mirror updates from this callback into their own
   * reactive state. Returns an unsubscribe function.
   */
  subscribe(bundleId: string, listener: (state: LocalModelState) => void): () => void;
};

export class ModelAssetStore implements ModelAssetStoreInterface {
  private readonly _bundles: Readonly<Record<string, LocalModelBundle>>;
  private readonly _transport: AssetTransport;
  private readonly _states: Record<string, LocalModelState>;
  private readonly _inflight: Map<string, Promise<LocalModelState>>;
  private readonly _abortControllers: Map<string, AbortController>;
  private readonly _listeners: Map<string, Set<(state: LocalModelState) => void>>;

  constructor(options: ModelAssetStoreOptions) {
    this._bundles = options.bundles;
    this._transport = isTauriRuntime() ? new TauriAssetTransport() : new BrowserAssetTransport();
    this._states = {};
    this._inflight = new Map();
    this._abortControllers = new Map();
    this._listeners = new Map();

    // Initialize states
    for (const bundleId of Object.keys(this._bundles)) {
      this._states[bundleId] = { status: 'not-downloaded', bytes: this.totalBytes(bundleId) };
    }
  }

  get states(): Readonly<Record<string, LocalModelState>> {
    return this._states;
  }

  subscribe(bundleId: string, listener: (state: LocalModelState) => void): () => void {
    let listeners = this._listeners.get(bundleId);
    if (!listeners) {
      listeners = new Set();
      this._listeners.set(bundleId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
    };
  }

  private _setState(bundleId: string, state: LocalModelState): void {
    this._states[bundleId] = state;
    for (const listener of this._listeners.get(bundleId) ?? []) {
      try {
        listener(state);
      } catch (error) {
        logger.error('ModelAssetStore:subscriber-failed', { bundleId, error });
      }
    }
  }

  totalBytes(bundleId: string): number {
    const bundle = this._bundles[bundleId];
    if (!bundle) {
      return 0;
    }
    return bundle.assets.reduce((sum, a) => sum + a.bytes, 0);
  }

  async status(bundleId: string): Promise<LocalModelState> {
    const bundle = this._bundles[bundleId];
    if (!bundle) {
      return { status: 'error', message: `Unknown bundle: ${bundleId}`, retryable: false };
    }

    try {
      if (typeof caches === 'undefined') {
        this._setState(bundleId, { status: 'not-downloaded', bytes: this.totalBytes(bundleId) });
        return this._states[bundleId];
      }

      const cache = await caches.open(bundle.assets[0]?.cache ?? 'transformers-cache');
      const manifest = await cache.match(bundle.manifestKey);
      if (!manifest) {
        this._setState(bundleId, { status: 'not-downloaded', bytes: this.totalBytes(bundleId) });
        return this._states[bundleId];
      }

      const meta = (await manifest.json()) as {
        files?: Array<{ cache?: string; key?: string }>;
        version?: number;
      };

      if ((meta.version ?? 1) < bundle.manifestVersion) {
        this._setState(bundleId, { status: 'not-downloaded', bytes: this.totalBytes(bundleId) });
        return this._states[bundleId];
      }

      const entries = (meta.files ?? []).map((entry) => ({
        cache: entry.cache ?? bundle.assets[0]?.cache ?? 'transformers-cache',
        key: entry.key ?? '',
      }));

      const allPresent = (
        await Promise.all(
          entries.map(async (entry) => {
            const entryCache = await caches.open(entry.cache);
            return (await entryCache.match(entry.key)) !== undefined;
          }),
        )
      ).every(Boolean);

      if (allPresent && entries.length > 0) {
        this._setState(bundleId, { status: 'ready' });
      } else {
        this._setState(bundleId, { status: 'not-downloaded', bytes: this.totalBytes(bundleId) });
      }

      return this._states[bundleId];
    } catch (_error) {
      this._setState(bundleId, { status: 'not-downloaded', bytes: this.totalBytes(bundleId) });
      return this._states[bundleId];
    }
  }

  async download(bundleId: string): Promise<LocalModelState> {
    const bundle = this._bundles[bundleId];
    if (!bundle) {
      return { status: 'error', message: `Unknown bundle: ${bundleId}`, retryable: false };
    }

    if (this._states[bundleId]?.status === 'ready') {
      return this._states[bundleId];
    }

    // Idempotent join
    const existing = this._inflight.get(bundleId);
    if (existing) {
      return await existing;
    }

    const promise = this._runDownload(bundle);
    this._inflight.set(bundleId, promise);

    try {
      return await promise;
    } finally {
      this._inflight.delete(bundleId);
    }
  }

  private async _runDownload(bundle: LocalModelBundle): Promise<LocalModelState> {
    const controller = new AbortController();
    this._abortControllers.set(bundle.id, controller);
    const total = this.totalBytes(bundle.id);

    this._setState(bundle.id, { status: 'downloading', receivedBytes: 0, totalBytes: total });

    try {
      let cumulativeBytes = 0;

      for (const asset of bundle.assets) {
        if (controller.signal.aborted) {
          this._setState(bundle.id, { status: 'not-downloaded', bytes: total });
          return this._states[bundle.id];
        }

        await this._transport.downloadAsset(bundle, asset, {
          signal: controller.signal,
          onProgress: (receivedBytes) => {
            this._setState(bundle.id, {
              status: 'downloading',
              receivedBytes: cumulativeBytes + receivedBytes,
              totalBytes: total,
            });
          },
        });

        cumulativeBytes += asset.bytes;
        this._setState(bundle.id, {
          status: 'downloading',
          receivedBytes: cumulativeBytes,
          totalBytes: total,
        });
      }

      if (controller.signal.aborted) {
        this._setState(bundle.id, { status: 'not-downloaded', bytes: total });
        return this._states[bundle.id];
      }

      this._setState(bundle.id, { status: 'verifying' });

      // Write manifest
      const cache = await caches.open(bundle.assets[0]?.cache ?? 'transformers-cache');
      const files = bundle.assets.map((a) => ({ cache: a.cache, key: a.key }));
      await cache.put(
        bundle.manifestKey,
        new Response(JSON.stringify({ files, version: bundle.manifestVersion }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      );

      this._setState(bundle.id, { status: 'ready' });
      return this._states[bundle.id];
    } catch (error) {
      const aborted = controller.signal.aborted || (error as Error)?.name === 'AbortError';
      if (aborted) {
        this._setState(bundle.id, { status: 'not-downloaded', bytes: total });
      } else {
        const message = error instanceof Error ? error.message : `Download failed for ${bundle.id}`;
        this._setState(bundle.id, { status: 'error', message, retryable: true });
      }
      return this._states[bundle.id];
    } finally {
      this._abortControllers.delete(bundle.id);
    }
  }

  cancel(bundleId: string): void {
    this._abortControllers.get(bundleId)?.abort();
    this._abortControllers.delete(bundleId);
  }

  /** @internal Reset in-memory state for a bundle (testing only). */
  _reset(bundleId: string): void {
    const bundle = this._bundles[bundleId];
    if (!bundle) {
      return;
    }
    this._abortControllers.get(bundleId)?.abort();
    this._abortControllers.delete(bundleId);
    this._inflight.delete(bundleId);
    this._setState(bundleId, { status: 'not-downloaded', bytes: this.totalBytes(bundleId) });
  }

  async remove(bundleId: string): Promise<void> {
    const bundle = this._bundles[bundleId];
    if (!bundle) {
      return;
    }

    try {
      // Cancel any in-flight download
      this.cancel(bundleId);

      // Remove all assets
      await Promise.all(bundle.assets.map((asset) => this._transport.removeAsset(bundle, asset)));

      // Remove manifest
      if (typeof caches !== 'undefined') {
        const cache = await caches.open(bundle.assets[0]?.cache ?? 'transformers-cache');
        await cache.delete(bundle.manifestKey);
      }

      this._setState(bundleId, { status: 'not-downloaded', bytes: this.totalBytes(bundleId) });
    } catch (error) {
      this._setState(bundleId, { status: 'error', message: 'Remove failed', retryable: true });
      throw error;
    }
  }
}
